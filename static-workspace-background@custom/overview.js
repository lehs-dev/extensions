import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {computeOverviewLayout} from './overviewLayout.js';
import {alignMinimizedWindowPreviews} from './minimizedWindowPreviews.js';

const APP_GRID = 2;
const WINDOW_PICKER = 1;

function actorBox(rect) {
  return new Clutter.ActorBox({
    x1: rect.x, y1: rect.y,
    x2: rect.x + rect.width, y2: rect.y + rect.height,
  });
}

export class MissionControlOverview {
  constructor() {
    this._active = false;
    this._patches = [];
    this._signals = [];
    this._backgrounds = new Map();
    this._workspaceOpacities = new Map();
    this._wallpapers = [];
    this._dashHeight = 0;
    this._workspacesHiddenFromPick = false;
  }

  enable() {
    if (this._active)
      return;
    this._controls = Main.overview._overview.controls;
    this._layout = this._controls.layout_manager;
    this._adjustment = this._controls._stateAdjustment;
    this._thumbnails = this._controls._thumbnailsBox;
    this._active = true;
    const controller = this;
    this._patch(this._controls, '_getThumbnailsBoxParams', original => function (...args) {
      const [opacity, scale, translationY] = original.apply(this, args);
      return [
        opacity * controller._workspaceRevealProgress(),
        scale,
        translationY + controller._workspaceSlideOffset(),
      ];
    });
    this._showWorkspaceThumbnails();
    this._patch(this._thumbnails, 'allocate', original => function (box, ...args) {
      // ControlsManagerLayout already allocates this actor. Supply our box at
      // that call, so ThumbnailsBox computes its target scale only once. A
      // second allocation in _runPostAllocation can alternate target scales
      // on a crowded strip and repeatedly queue native scale animations.
      if (this.get_parent() !== controller._controls)
        return original.call(this, box, ...args);
      // Shell allocates the dash immediately before thumbnails, while its
      // workspace-box helpers (which cache dashHeight) run afterward.
      const rect = controller._getLayout(controller._layout._dash.height).workspaces;
      controller._updateThumbnailScale(rect);
      return original.call(this, actorBox(rect), ...args);
    });

    this._card = new St.Widget({
      style_class: 'mission-control-app-grid',
      reactive: false,
      visible: false,
    });
    this._controls.insert_child_at_index(this._card, 0);
    this._workspaceStrip = new St.Widget({
      style_class: 'mission-control-workspace-strip',
      reactive: false,
      visible: false,
    });
    this._controls.insert_child_at_index(this._workspaceStrip, 0);

    // Virtual methods need a GJS vfunc hook; assigning the JS property alone
    // does not intercept allocations performed by Clutter.
    this._injections = new InjectionManager();
    const allocationPatch = {active: true};
    this._allocationPatch = allocationPatch;
    this._injections.overrideMethod(Workspace.WorkspaceLayout.prototype, 'vfunc_allocate',
      original => function (container, box) {
        const result = original.call(this, container, box);
        if (controller._active && allocationPatch.active)
          alignMinimizedWindowPreviews(this, box);
        return result;
      });
    this._patch(Workspace.WorkspaceBackground.prototype, '_init', original => function (...args) {
      const result = original.apply(this, args);
      controller._trackBackground(this);
      return result;
    });
    const workspaces = this._controls._workspacesDisplay;
    this._primaryWorkspaceRequested = workspaces._primaryVisible;
    this._patch(workspaces, 'setPrimaryWorkspaceVisible', original => function (visible) {
      controller._primaryWorkspaceRequested = visible;
      return original.call(this, visible && controller._adjustment.value < APP_GRID);
    });
    this._installWorkspacePreviews();
    this._installWorkspaceLayout();
    this._patch(this._layout, '_getAppDisplayBoxForState', original => function (...args) {
      const box = original.apply(this, args);
      if (args[0] !== APP_GRID)
        return box;
      return actorBox(controller._getLayout(args[3]).apps);
    });
    this._patch(this._layout, '_runPostAllocation', original => function (...args) {
      // Settings extensions may replace the workspace method while enabled.
      if (controller._layout._computeWorkspacesBoxForState !== controller._workspaceLayout.wrapper) {
        controller._workspaceLayout.active = false;
        controller._installWorkspaceLayout();
        controller._layout.layout_changed();
      }
      const result = original.apply(this, args);
      // Native allocation callbacks may disable extensions or finish hiding
      // Overview synchronously. Do not touch actors released by disable().
      if (!controller._active)
        return result;
      const layout = controller._getLayout();
      controller._card.allocate(actorBox(layout.card));
      controller._workspaceStrip.allocate(actorBox(layout.workspaceStrip));
      controller._updateThumbnailScale(layout.workspaces);
      // A scale or monitor change can reallocate a paused gesture without
      // changing its adjustment value. Recompute the same reveal position.
      if (controller._workspaceRevealProgress() < 1 &&
          !controller._controls._searchController.searchActive)
        controller._thumbnails.translation_y = controller._controls._getThumbnailsBoxParams()[2];
      controller._syncWorkspaceStrip();
      return result;
    });

    this._connect(this._adjustment, 'notify::value', () => this._syncState());
    this._connect(this._controls._appDisplay, 'notify::opacity', () => this._syncState());
    this._connect(this._controls._appDisplay, 'notify::visible', () => this._syncState());
    this._connect(this._thumbnails, 'notify::opacity', () => this._syncWorkspaceStrip());
    this._connect(this._thumbnails, 'notify::visible', () => this._syncWorkspaceStrip());
    this._connect(Main.overview, 'showing', () => {
      this._scanBackgrounds(Main.layoutManager.overviewGroup);
      this._syncState();
    });
    // Views already open when enabled retain their originally bound handlers.
    // Refresh after those handlers as well as patching future view instances.
    for (const signal of ['window-drag-begin', 'window-drag-end'])
      this._connect(Main.overview, signal, () => this._refreshWorkspaceVisibility());
    this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuildWallpapers());
    this._rebuildWallpapers();
    this._scanBackgrounds(Main.layoutManager.overviewGroup);
    this._refreshWorkspaceViews();
    this._syncState();
    this._layout.layout_changed();
  }

  _connect(object, signal, callback) {
    const signals = this._signals;
    signals.push([object, object.connect(signal, (...args) => {
      // Keep retained callbacks from an old enable cycle inert, including
      // after a later re-enable.
      if (this._active && this._signals === signals)
        callback(...args);
    })]);
  }

  _patch(object, name, createOverride) {
    const record = {
      object, name, original: object[name],
      own: Object.hasOwn(object, name), active: true,
    };
    const override = createOverride(record.original);
    const controller = this;
    record.wrapper = function (...args) {
      if (!controller._active || !record.active)
        return record.original.apply(this, args);
      return override.apply(this, args);
    };
    object[name] = record.wrapper;
    this._patches.push(record);
    return record;
  }

  _installWorkspaceLayout() {
    const controller = this;
    this._workspaceLayout = this._patch(this._layout, '_computeWorkspacesBoxForState',
      original => function (...args) {
        const box = original.apply(this, args);
        if (args[0] !== WINDOW_PICKER && args[0] !== APP_GRID)
          return box;
        const layout = controller._getLayout(args[3]);
        // Keep the picker allocation throughout the app-grid fade. A small
        // app-grid allocation pulls every preview up into the thumbnail strip.
        return actorBox(layout.picker);
      });
  }

  _installWorkspacePreviews() {
    const controller = this;
    this._patch(this._controls, '_getFitModeForState', original => function (state, ...args) {
      return original.call(this, state === APP_GRID ? WINDOW_PICKER : state, ...args);
    });
    const prototype = WorkspacesView.WorkspacesView.prototype;
    for (const method of ['_getFitModeForState', '_getWorkspaceModeForOverviewState']) {
      this._patch(prototype, method, original => function (state, ...args) {
        const primary = this._monitorIndex === Main.layoutManager.primaryIndex;
        return original.call(this, primary && state === APP_GRID ? WINDOW_PICKER : state, ...args);
      });
    }
    this._patch(prototype, '_updateWorkspacesState', original => function (...args) {
      const result = original.apply(this, args);
      controller._syncWorkspacePreviews(this);
      return result;
    });
    this._patch(prototype, '_updateVisibility', original => function (...args) {
      const result = original.apply(this, args);
      if (!this._animating && !this._gestureActive && !this._inDrag &&
          this._fitModeAdjustment.value === WorkspacesView.FitMode.SINGLE) {
        const active = this.getActiveWorkspace();
        for (const workspace of this._workspaces)
          workspace.visible = workspace === active;
      }
      return result;
    });
    for (const method of ['_dragBegin', '_dragEnd']) {
      this._patch(prototype, method, original => function (...args) {
        const wasDragging = this._inDrag;
        const result = original.apply(this, args);
        if (this._inDrag !== wasDragging && this.mapped)
          this._updateVisibility();
        return result;
      });
    }
  }

  _syncWorkspacePreviews(view) {
    if (!view)
      return;
    const primary = view._monitorIndex === Main.layoutManager.primaryIndex;
    const opacity = primary ? 1 - this._gridProgress() : 1;
    for (const workspace of view._workspaces) {
      let record = this._workspaceOpacities.get(workspace);
      if (!record) {
        if (!primary)
          continue;
        record = {opacity: workspace.opacity};
        record.destroyId = workspace.connect('destroy', () => this._workspaceOpacities.delete(workspace));
        this._workspaceOpacities.set(workspace, record);
      }
      // Search opacity belongs to the native parent binding. Fade its child
      // workspace instead, so search and the app-grid fade compose naturally.
      workspace.opacity = Math.round(record.opacity * opacity);
    }
  }

  _refreshWorkspaceViews() {
    this._controls._update();
    for (const display of this._controls._workspacesDisplay._workspacesViews) {
      const view = display._workspacesView ?? display;
      view._updateWorkspacesState?.();
      view._updateVisibility?.();
      view.queue_relayout();
    }
  }

  _refreshWorkspaceVisibility() {
    for (const display of this._controls._workspacesDisplay._workspacesViews)
      (display._workspacesView ?? display)._updateVisibility?.();
  }

  _showWorkspaceThumbnails() {
    const thumbnails = this._thumbnails;
    const descriptor = Object.getOwnPropertyDescriptor(thumbnails, '_shouldShow');
    const state = {
      descriptor,
      requested: thumbnails._shouldShow,
      maxScale: thumbnails._maxThumbnailScale,
      clip: thumbnails.has_clip ? thumbnails.get_clip() : null,
    };
    this._thumbnailState = state;
    // Keep native click, drag-and-drop, and search/overview animations. Settings
    // extensions can still request visibility changes; restore their last value.
    Object.defineProperty(thumbnails, '_shouldShow', {
      configurable: true,
      get: () => true,
      set: value => { state.requested = value; },
    });
    this._controls._updateThumbnailsBox();
  }

  _updateThumbnailScale(rect) {
    const thumbnails = this._thumbnails;
    const {width, height} = thumbnails._porthole;
    const themeNode = thumbnails.get_theme_node();
    const contentBox = themeNode.get_content_box(actorBox(rect));
    const count = Math.max(1, thumbnails._thumbnails.length);
    const spacing = themeNode.get_length('spacing') * (count - 1);
    // Native allocation centers smaller thumbnails against this maximum.
    // Cap it by the actual strip width too, or crowded workspaces retain a
    // centering offset for thumbnails that no longer fit and overflow right.
    const scale = width > 0 && height > 0
      ? Math.max(0, Math.min(rect.height / height,
        (contentBox.get_width() - spacing) / (count * width)))
      : 0;
    if (thumbnails._maxThumbnailScale !== scale) {
      thumbnails._maxThumbnailScale = scale;
      thumbnails.queue_relayout();
    }
  }

  _restoreWorkspaceThumbnails() {
    const thumbnails = this._thumbnails;
    const state = this._thumbnailState;
    this._restoreThumbnailRevealClip();
    if (state.descriptor) {
      const descriptor = {...state.descriptor};
      if ('value' in descriptor)
        descriptor.value = state.requested;
      Object.defineProperty(thumbnails, '_shouldShow', descriptor);
    } else {
      delete thumbnails._shouldShow;
    }
    thumbnails._maxThumbnailScale = state.maxScale;
    thumbnails._updateShouldShow();
    thumbnails.queue_relayout();
    // Search fades can leave translation untouched; remove our reveal offset
    // even when disabling midway through a gesture with search active.
    thumbnails.remove_transition('translation-y');
    thumbnails.translation_y = this._controls._getThumbnailsBoxParams()[2];
    this._controls._updateThumbnailsBox();
    this._thumbnailState = null;
  }

  _getLayout(dashHeight = this._dashHeight) {
    this._dashHeight = dashHeight;
    const box = this._layout._workAreaBox;
    const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
    const area = {
      x: box.x1, y: box.y1,
      width: box.get_width(), height: box.get_height(),
    };
    const options = {scale: scaleFactor, dashHeight};
    const layout = computeOverviewLayout(area, options);
    const thumbnails = this._thumbnails;
    const {width, height} = thumbnails._porthole;
    const count = thumbnails._thumbnails.length;
    const themeNode = thumbnails.get_theme_node();
    // Request the usual thumbnail size before constraining a crowded strip.
    // Match native pixel rounding so adding a workspace grows both edges
    // evenly, while the picker below retains its full allocation.
    const thumbnailWidth = height > 0
      ? Math.max(layout.workspaces.height * width / height,
        Math.round(Math.round(layout.workspaces.height) * width / height))
      : 0;
    const spacing = themeNode.get_length('spacing');
    const naturalWidth = thumbnails._thumbnails.reduce((total, thumbnail, index) => {
      const adjacentSpacing = (index > 0 ? spacing / 2 : 0) +
        (index < count - 1 ? spacing / 2 : 0);
      // Follow Shell's add/remove animation instead of jumping the backdrop
      // straight to its final width when a thumbnail starts expanding.
      return total + (thumbnailWidth + adjacentSpacing) * (1 - thumbnail.collapse_fraction);
    }, 0);
    const [, workspaceNaturalWidth] = themeNode.adjust_preferred_width(0, naturalWidth);
    return computeOverviewLayout(area, {...options, workspaceNaturalWidth});
  }

  _trackBackground(actor) {
    if (!this._active || this._backgrounds.has(actor))
      return;
    const record = {opacity: actor.opacity};
    record.destroyId = actor.connect('destroy', () => this._backgrounds.delete(actor));
    this._backgrounds.set(actor, record);
    actor.opacity = 0;
  }

  _scanBackgrounds(actor) {
    if (actor instanceof Workspace.WorkspaceBackground)
      this._trackBackground(actor);
    for (const child of actor.get_children())
      this._scanBackgrounds(child);
  }

  _gridProgress() {
    return Math.max(0, Math.min(1, this._adjustment.value - 1));
  }

  _setWorkspacesHiddenFromPick(hidden) {
    if (this._workspacesHiddenFromPick === hidden)
      return;
    const workspaces = this._controls._workspacesDisplay;
    // The enlarged display stacks above apps. Hiding its primary view or
    // fading windows leaves reactive parents/children in Clutter's pick tree.
    // Suppress the whole subtree while apps overlap it, including DND picks.
    Shell.util_set_hidden_from_pick(workspaces, hidden);
    this._workspacesHiddenFromPick = hidden;
    workspaces.queue_redraw();
  }

  _syncState() {
    const progress = this._gridProgress();
    this._setWorkspacesHiddenFromPick(progress > 0);
    for (const actor of this._backgrounds.keys())
      actor.opacity = 0;
    this._controls._workspacesDisplay.setPrimaryWorkspaceVisible(this._primaryWorkspaceRequested);
    this._syncWorkspacePreviews(this._controls._workspacesDisplay._getPrimaryView());
    const apps = this._controls._appDisplay;
    this._card.visible = progress > 0 && apps.visible;
    this._card.opacity = Math.round(apps.opacity * progress);
    this._syncWorkspaceStrip();
  }

  _syncWorkspaceStrip() {
    this._workspaceStrip.visible = this._thumbnails.visible;
    this._workspaceStrip.opacity = this._thumbnails.opacity;
    const offset = this._workspaceSlideOffset();
    this._workspaceStrip.translation_y = offset;
    if (offset < 0) {
      const strip = this._workspaceStrip;
      strip.set_clip(0, -offset, strip.width, Math.max(0, strip.height + offset));
      const panelEdge = this._getLayout().workspaceStrip.y;
      const clipTop = Math.max(0,
        panelEdge - this._thumbnails.y - this._thumbnails.translation_y);
      if (clipTop > 0) {
        const previous = this._thumbnailState.clip;
        const x = previous?.[0] ?? 0;
        const y = Math.max(clipTop, previous?.[1] ?? 0);
        const width = previous?.[2] ?? this._thumbnails.width;
        const bottom = previous ? previous[1] + previous[3] : this._thumbnails.height;
        this._thumbnails.set_clip(x, y, width, Math.max(0, bottom - y));
        this._thumbnailRevealClipped = true;
      } else {
        this._restoreThumbnailRevealClip();
      }
    } else {
      this._workspaceStrip.remove_clip();
      this._restoreThumbnailRevealClip();
    }
  }

  _workspaceRevealProgress() {
    return Math.max(0, Math.min(1, this._adjustment.value));
  }

  _workspaceSlideOffset() {
    return -this._getLayout().workspaceStrip.height * (1 - this._workspaceRevealProgress());
  }

  _restoreThumbnailRevealClip() {
    if (!this._thumbnailRevealClipped)
      return;
    const clip = this._thumbnailState.clip;
    if (clip)
      this._thumbnails.set_clip(...clip);
    else
      this._thumbnails.remove_clip();
    this._thumbnailRevealClipped = false;
  }

  _rebuildWallpapers() {
    this._destroyWallpapers();
    for (const monitor of Main.layoutManager.monitors) {
      const container = new Meta.BackgroundGroup({
        layout_manager: new Clutter.BinLayout(),
        x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
      });
      const manager = new Background.BackgroundManager({
        container, monitorIndex: monitor.index, controlPosition: false,
        useContentSize: false,
      });
      Main.layoutManager.overviewGroup.insert_child_at_index(container, 0);
      this._wallpapers.push({container, manager});
    }
  }

  _destroyWallpapers() {
    for (const {container, manager} of this._wallpapers) {
      manager.destroy();
      container.destroy();
    }
    this._wallpapers = [];
  }

  disable() {
    if (!this._active)
      return;
    this._active = false;
    this._allocationPatch.active = false;
    this._injections.clear();
    this._injections = null;
    for (const [object, id] of this._signals)
      object.disconnect(id);
    this._signals = [];
    for (const record of this._patches.reverse()) {
      record.active = false;
      if (record.object[record.name] !== record.wrapper)
        continue;
      if (record.own)
        record.object[record.name] = record.original;
      else
        delete record.object[record.name];
    }
    this._patches = [];
    for (const [actor, record] of this._backgrounds) {
      actor.disconnect(record.destroyId);
      actor.opacity = record.opacity;
    }
    this._backgrounds.clear();
    for (const [workspace, record] of this._workspaceOpacities) {
      workspace.disconnect(record.destroyId);
      workspace.opacity = record.opacity;
    }
    this._workspaceOpacities.clear();
    this._setWorkspacesHiddenFromPick(false);
    this._controls._workspacesDisplay.setPrimaryWorkspaceVisible(this._primaryWorkspaceRequested);
    this._refreshWorkspaceViews();
    this._restoreWorkspaceThumbnails();
    this._destroyWallpapers();
    this._card.destroy();
    this._card = null;
    this._workspaceStrip.destroy();
    this._workspaceStrip = null;
    this._layout.layout_changed();
  }
}
