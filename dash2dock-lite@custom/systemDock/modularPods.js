'use strict';

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AttachedDockCanvas } from '../attachedBackground.js';
import {getAttachedPodPickBoxes, LEFT_MODULAR_WIDTH} from '../attachedGeometry.js';
import {PodElevation} from './podElevation.js';
import {unifiedAppearance} from '../unifiedDock.js';
import {resourceScale, alignPixel} from '../rendering.js';
import {
  NetworkItem, BluetoothItem, AudioItem, BatteryItem, InputSourceItem, ModularClockItem, DynamicIndicatorItem,
} from './systemDockItems.js';

const isFullscreenObscured = monitor => !!monitor?.inFullscreen &&
  ((typeof global !== 'undefined' ? global.window_group?.visible : undefined) ?? !Main.overview?.visible);

// The root reserves the information reveal but is never reactive. Only
// these boxes, entirely inside the painted contour, participate in picking.
const PodSurface = GObject.registerClass(
  class PodSurface extends St.Button {
    _init() {
      super._init({reactive: true, can_focus: true, track_hover: true,
        style_class: 'modular-pod-surface'});
      this.boxes = [];
    }

    vfunc_pick(context) {
      if (!this.should_pick(context)) return;
      for (const box of this.boxes)
        this.pick_box(context, new Clutter.ActorBox(box));
    }
  }
);

/** Shared rendering/lifecycle only. Each instance owns a separate, content-sized hierarchy. */
const AttachedPod = GObject.registerClass(
  class AttachedPod extends St.Widget {
    _init(params = {}) {
      super._init({
        name: params.name,
        style_class: 'modular-pod-container',
        reactive: false,
        can_focus: false,
        track_hover: false,
      });
      this.extension = params.extension;
      this.systemMenus = params.systemMenus;
      this.systemState = params.systemState;
      this._onLayoutChanged = params.onLayoutChanged;
      this._dockPosition = 'left';
      this._edge = 'left';
      this._enabled = false;
      this._onChrome = false;
      this._geom = null;
      this._items = new Map();
      this._signals = [];
      this._pointerInside = this._menuOpen = false;
      try {
        this._elevation = new PodElevation(this, () => this._applyElevation());
        this._canvas = new AttachedDockCanvas();
        this._canvas.reactive = false;
        this.add_child(this._canvas);
        this._surface = new PodSurface();
        this._surface._systemPod = this;
        this._surface.side = St.Side.LEFT;
        this.add_child(this._surface);
        this._contentBox = new St.BoxLayout({
          style_class: 'modular-pod-box',
          orientation: Clutter.Orientation.VERTICAL,
          reactive: false,
          x_expand: false,
        });
        if (this._contentBox.layout_manager) {
          this._contentBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        }
        this.add_child(this._contentBox);
        this._detailsBox = new St.BoxLayout({style_class: 'modular-pod-details',
          orientation: Clutter.Orientation.VERTICAL, reactive: false});
        this.add_child(this._detailsBox);
        this._detailLabels = new Map();
        // A point on the moving contour anchors the native popup. Its focus
        // returns to the single shaped button, never to an invisible reserve.
        this._menuAnchor = new St.Widget({reactive: false});
        this._menuAnchor._systemPod = this;
        this._menuAnchor.set_size(1, 1);
        this.add_child(this._menuAnchor);
        this._destroyed = false;
        // St.Button handles crossing events itself. Observe its native hover
        // property: the passive root does not reliably receive those events.
        this._surface.connect('notify::hover', () => this._syncPointerHover());
        this._surface.connect('clicked', () => this._activate());
        this.connect('notify::visible', () => {
          if (!this.visible) this._resetInteraction();
        });
        const settings = St.Settings?.get();
        if (settings?.connect) {
          for (const signal of ['notify::reduced-motion', 'notify::enable-animations'])
            this._signals.push([settings, settings.connect(signal, () => this._syncElevation(true))]);
        }
      } catch (error) {
        this.destroy();
        throw error;
      }
    }

    _addItem(name, ItemClass, {nativeAction = false} = {}) {
      const item = new ItemClass({
        systemMenus: this.systemMenus,
        systemState: this.systemState,
        extension: this.extension,
        iconSize: unifiedAppearance(this.extension).iconSize,
        side: St.Side.LEFT,
      });
      // Compact pod items allocate buttons inside the visible body
      this._styleItem(item);
      item.x_expand = true;
      item.x_align = Clutter.ActorAlign.FILL;
      item._systemPod = this;
      // Regular status indicators share the capsule's button. Native stop
      // controls must keep their own action rather than opening Quick Settings.
      if (!nativeAction) item._onActivate = () => this._activate();
      item.reactive = item.can_focus = item.track_hover = nativeAction;
      if (nativeAction) item.connect('notify::hover', () => this._syncPointerHover());
      this._items.set(name, item);
      this._contentBox.add_child(item);
      return item;
    }

    _styleItem(item) {
      const a = unifiedAppearance(this.extension);
      item.set_style(`min-width: 0; min-height: 0; padding: ${2 * a.scale}px ${a.scale}px;`);
      item.setIconSize?.(a.iconSize);
      for (const label of [item._label, item._hourLabel, item._minLabel, item._dayLabel,
        item._dateLabel, item._monthLabel, item._periodLabel].filter(Boolean))
        label.set_style(`font-size: ${a.fontSize}px;`);
    }

    _syncAppearance() {
      const a = unifiedAppearance(this.extension);
      for (const item of this._items.values()) this._styleItem(item);
      for (const label of this._detailLabels.values()) {
        label.set_style(`font-size: ${a.detailFontSize}px;`);
        if (label.clutter_text) {
          label.clutter_text.line_wrap = this._horizontal;
          label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
          label.clutter_text.ellipsize = this._horizontal ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
        }
      }
      this._spacing = a.itemSpacing;
      this._contentBox.set_style(`spacing: ${a.itemSpacing}px;`);
      this._detailsBox.set_style(`spacing: ${a.itemSpacing}px;`);
    }

    _activate() {}

    setEdge(edge) {
      this.dockPosition = this.edge = edge;
      this._right = edge === 'right';
      this._horizontal = edge === 'top' || edge === 'bottom';
      this._endAnchored = this._right || edge === 'bottom';
      this._side = St.Side[edge.toUpperCase()];
      this._surface.side = this._menuAnchor.side = this._side;
      const orientation = this._horizontal ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL;
      this._contentBox.orientation = orientation;
      if (this._contentBox.layout_manager) this._contentBox.layout_manager.orientation = orientation;
      for (const item of this._items.values()) item.side = this._side;
      const clockBox = this._clockItem?.get_child?.() ?? this._clockItem?.get_children?.()[0];
      if (clockBox?.layout_manager) {
        clockBox.orientation = orientation;
        clockBox.layout_manager.orientation = orientation;
        clockBox.set_style(`spacing: ${this._horizontal ? unifiedAppearance(this.extension).itemSpacing : 0}px;`);
      }
    }

    _containsPointer(pointer) {
      if (!pointer || !this._geom || !this.visible) return false;
      const [x, y] = this.get_transformed_position();
      return this._surface.boxes.some(b => pointer[0] >= x + b.x1 && pointer[0] < x + b.x2 &&
        pointer[1] >= y + b.y1 && pointer[1] < y + b.y2);
    }

    _syncPointerHover(pointer = null) {
      if (this._destroyed) return;
      const stage = typeof global !== 'undefined' ? global.stage : null;
      pointer ??= typeof global !== 'undefined' ? global.get_pointer?.() : null;
      const picked = pointer && stage?.get_actor_at_pos(Clutter.PickMode.REACTIVE, pointer[0], pointer[1]);
      // Geometry is authoritative even when a moving pick region leaves St's
      // hover flag or the stage's previous pick stale for a crossing event.
      this._pointerInside = pointer ? this._containsPointer(pointer) && (!picked || this.contains(picked)) :
        [this._surface, ...this._items.values()].some(actor => actor.visible && actor.reactive && actor.hover);
      this._syncElevation();
    }

    _updatePointerWatch() {
      const stage = typeof global !== 'undefined' ? global.stage : null;
      const active = !this._destroyed && this.visible && this._elevation.enabled &&
        (this._pointerInside || this._menuOpen || this._elevation.progress > 0);
      if (active && !this._pointerSignal && stage?.connect) {
        this._pointerStage = stage;
        this._pointerSignal = stage.connect('captured-event', (_stage, event) => {
          const type = event.type?.();
          if ([Clutter.EventType.MOTION, Clutter.EventType.ENTER, Clutter.EventType.LEAVE].includes(type))
            this._syncPointerHover(event.get_coords?.());
          return Clutter.EVENT_PROPAGATE;
        });
      }
      if (active && !this._pointerCheckId) {
        // Native application surfaces/grabs can take motion without sending
        // another crossing event through Shell's stage. Reconcile the global
        // pointer only while this pod is raised or returning to rest.
        this._pointerCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
          if (this._destroyed || !this.visible) {
            this._stopPointerWatch();
            return GLib.SOURCE_REMOVE;
          }
          this._syncPointerHover();
          return this._pointerCheckId ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._pointerCheckId, '[dash2dock-lite] pod pointer');
      }
      if (!active) this._stopPointerWatch();
    }

    _stopPointerWatch() {
      if (this._pointerSignal) this._pointerStage.disconnect(this._pointerSignal);
      this._pointerSignal = this._pointerStage = null;
      if (this._pointerCheckId) GLib.source_remove(this._pointerCheckId);
      this._pointerCheckId = 0;
    }

    _menuOptions() { return {side: this._side, focusActor: this._surface}; }

    get popupBounds() {
      if (!this._geom) return null;
      const g = this._geom;
      const expansion = (this._expansion ?? 0) + this._elevation.distance;
      return {left: g.x - (this._right ? expansion : 0),
        right: g.x + g.width + (this.edge === 'left' ? expansion : 0),
        top: g.y - (this.edge === 'bottom' ? expansion : 0),
        bottom: g.y + g.height + (this.edge === 'top' ? expansion : 0)};
    }

    _setDetails(entries) {
      let changed = false;
      const keys = new Set(entries.map(([key]) => key));
      for (const [key, label] of this._detailLabels) {
        if (keys.has(key)) continue;
        label.destroy();
        this._detailLabels.delete(key);
        changed = true;
      }
      for (const [key, text] of entries) {
        let label = this._detailLabels.get(key);
        if (!label) {
          label = new St.Label({style_class: 'modular-pod-detail-label', reactive: false,
            y_expand: true, y_align: Clutter.ActorAlign.CENTER});
          label.set_style(`font-size: ${unifiedAppearance(this.extension).detailFontSize}px;`);
          this._detailLabels.set(key, label);
          this._detailsBox.add_child(label);
          changed = true;
        }
        if (label.text !== text) { label.text = text; changed = true; }
      }
      this._surface.accessible_name = entries.map(([, text]) => text).join(', ') || this.name;
      // Provider changes can resize this pod's reserve, but never the desktop
      // geometry. Hover frames only update clip, opacity, translations and paint.
      if (changed && this._geom) this._sizeExpansion();
    }

    _sizeExpansion() {
      const g = this._geom;
      const monitor = Main.layoutManager.findMonitorForActor?.(this) || Main.layoutManager.primaryMonitor;
      const scale = unifiedAppearance(this.extension).scale;
      const natural = this._horizontal
        ? this._detailsBox.layout_manager?.get_preferred_height?.(this._detailsBox, g.contentWidth)?.[1] ??
          [...this._detailLabels.values()].reduce((sum, label) => sum + (label.get_preferred_height?.(g.contentWidth)?.[1] ?? 16 * scale), 0) +
            Math.max(0, this._detailLabels.size - 1) * 3 * scale
        : this._detailsBox.layout_manager?.get_preferred_width?.(this._detailsBox, -1)?.[1] ??
          Math.max(0, ...[...this._detailLabels.values()].map(label => label.get_preferred_width?.(-1)?.[1] ?? 0));
      const depth = this._horizontal ? g.height : g.width;
      const available = Math.max(0, (this._horizontal ? monitor?.height ?? 1080 : monitor?.width ?? 1920) - depth - this._elevation.distance - 12 * scale);
      this._expansion = Math.min(320 * scale, available, Math.ceil(natural) + 18 * scale);
      const reserve = depth + this._expansion + this._elevation.distance + 4 * scale;
      const near = this._endAnchored ? reserve - depth : 0;
      const size = this._horizontal ? [g.width, reserve] : [reserve, g.height];
      this.set_size(...size);
      this._canvas.set_size(...size);
      this._surface.set_size(...size);
      // Chrome is positioned directly in stage coordinates. Its transformed
      // position can be NaN until Clutter allocates it on the next frame.
      const rootX = g.x - (this._right ? reserve - depth : 0);
      const rootY = g.y - (this.edge === 'bottom' ? reserve - depth : 0);
      this.set_position(rootX, rootY);
      const pixels = resourceScale(this);
      const alignedX = value => alignPixel(rootX + value, pixels) - rootX;
      const alignedY = value => alignPixel(rootY + value, pixels) - rootY;
      this._contentBox.set_position(alignedX(g.contentLeft + (this._horizontal ? 0 : near)),
        alignedY(g.contentTop + (this._horizontal ? near : 0)));
      const anchorNormal = this._endAnchored ? near + 1 : depth - 1;
      this._menuAnchor.set_position(this._horizontal ? g.width / 2 : anchorNormal,
        this._horizontal ? anchorNormal : g.height / 2);
      const detailsNormal = this._endAnchored ? near - this._expansion + 8 * scale : depth + 8 * scale;
      this._detailsBox.set_position(alignedX(this._horizontal ? g.contentLeft : detailsNormal),
        alignedY(this._horizontal ? detailsNormal : g.contentTop));
      this._detailsBox.set_size(this._horizontal ? g.contentWidth : Math.max(1, this._expansion - 16 * scale),
        this._horizontal ? Math.max(1, this._expansion - 16 * scale) : g.contentHeight);
      this._applyElevation();
      this._syncPointerHover();
    }

    enable() {
      if (this._enabled) return;
      try {
        Main.layoutManager.addChrome(this, {affectsStruts: false, trackFullscreen: true});
        this._onChrome = true;
        this._enabled = true;
        this.updateLayout();
      } catch (error) {
        this.destroy();
        throw error;
      }
    }

    get dockPosition() {
      return this._dockPosition ?? 'left';
    }

    set dockPosition(val) {
      this._dockPosition = val;
    }

    get edge() {
      return this._edge ?? 'left';
    }

    set edge(val) {
      this._edge = val;
    }

    getMeasuredContentHeight() {
      this._syncAppearance();
      this._refreshContent();
      const [, natural] = this._contentBox.layout_manager?.get_preferred_height?.(this._contentBox, -1) ??
        this._contentBox.get_preferred_height?.(-1) ?? [0, 0];
      if (Number.isFinite(natural) && natural > 0) {
        this._measuredHeight = Math.ceil(natural);
        return this._measuredHeight;
      }
      const visibleItems = [...this._items.values()].filter(item => item.visible);
      let total = 0;
      for (const item of visibleItems) {
        const preferred = item.get_preferred_height?.(-1) ?? [0, 0];
        total += preferred[1] > 0 ? preferred[1] : (unifiedAppearance(this.extension).iconSize) + 4 * unifiedAppearance(this.extension).scale;
      }
      const spacing = this._spacing ?? (unifiedAppearance(this.extension).itemSpacing);
      total += Math.max(0, visibleItems.length - 1) * spacing;
      this._measuredHeight = Math.ceil(total > 0 ? total : 60);
      return this._measuredHeight;
    }

    getMeasuredContentWidth() {
      this._syncAppearance();
      const preferred = this._contentBox.layout_manager?.get_preferred_width?.(this._contentBox, -1) ??
        this._contentBox.get_preferred_width?.(-1);
      const natural = preferred?.[1];
      const val = Number.isFinite(natural) && natural > 0
        ? natural
        : (unifiedAppearance(this.extension).iconSize) + 2;
      this._measuredWidth = Math.ceil(val);
      return this._measuredWidth;
    }

    updateLayout() {
      if (!this._enabled) return;
      this._refreshContent();
      this._onLayoutChanged?.();
    }

    place(geometry) {
      this._geom = geometry;
      if (!geometry) { this.hide(); return; }
      this.setEdge(geometry.position ?? 'left');
      this._syncAppearance();
      const gx = Number.isFinite(geometry.x) ? geometry.x : 0;
      const gy = Number.isFinite(geometry.y) ? geometry.y : 0;
      const gw = Number.isFinite(geometry.width) && geometry.width > 0 ? geometry.width : LEFT_MODULAR_WIDTH;
      const gh = Number.isFinite(geometry.height) && geometry.height > 0 ? geometry.height : 60;

      this.set_position(gx, gy);
      this._elevation.configure(this.extension);
      this._canvas.set_position(0, 0);
      this._surface.set_position(0, 0);
      const inset = geometry.contentLeft ?? 2;
      const safeInset = Number.isFinite(inset) ? inset : 2;
      const contentTop = Number.isFinite(geometry.contentTop) ? geometry.contentTop : 17;
      const contentWidth = Number.isFinite(geometry.contentWidth) && geometry.contentWidth > 0
        ? geometry.contentWidth
        : Math.max(1, gw - safeInset - 2);
      const contentHeight = Number.isFinite(geometry.contentHeight) && geometry.contentHeight > 0
        ? geometry.contentHeight
        : Math.max(1, gh - 2 * contentTop);
      this._contentBox.set_position(safeInset, contentTop);
      this._contentBox.set_size(contentWidth, contentHeight);
      this._menuAnchor.set_position(gw - 1, gh / 2);
      this._geom = {...geometry, x: gx, y: gy, width: gw, height: gh, contentLeft: safeInset, contentTop, contentHeight};
      this._sizeExpansion();
      const monitor = Main.layoutManager.findMonitorForActor?.(this) || Main.layoutManager.primaryMonitor;
      this.visible = geometry.visible !== false && !isFullscreenObscured(monitor);
      this._syncPointerHover();
      this._applyElevation();
    }

    _syncElevation(immediate = false) {
      if (this._destroyed) return;
      // Focus returning after a popup closes must not latch the capsule open.
      const active = this.visible && (this._pointerInside || this._menuOpen);
      this._elevation.setActive(active, immediate);
      this._updatePointerWatch();
    }

    onMenuStateChanged(open) {
      this._menuOpen = open;
      // Native grabs can suppress crossing events. Re-pick after dismissal
      // instead of retaining a stale pre-menu hover flag.
      if (!open) { this._syncPointerHover(); return; }
      this._syncElevation();
    }

    _resetInteraction() {
      if (this._destroyed) return;
      this._pointerInside = false;
      if (this._menuOpen) this.systemMenus?.closeAll();
      this._menuOpen = false;
      this._elevation.setActive(false, true);
      this._stopPointerWatch();
    }

    _applyElevation() {
      if (!this._geom || this._destroyed) return;
      const offset = this._elevation.progress * this._elevation.distance;
      const reveal = (this._expansion ?? 0) * this._elevation.progress;
      const scale = unifiedAppearance(this.extension).scale;
      const settled = this._elevation.progress === 0 || this._elevation.progress === 1;
      const pixels = resourceScale(this);
      const align = value => settled ? alignPixel(value, pixels) : value;
      const move = align(this._endAnchored ? -offset : offset);
      const detailsMove = align(this._endAnchored ? (this._expansion ?? 0) - reveal - offset : offset);
      this._contentBox.translation_x = this._horizontal ? 0 : move;
      this._contentBox.translation_y = this._horizontal ? move : 0;
      this._detailsBox.translation_x = this._horizontal ? 0 : detailsMove;
      this._detailsBox.translation_y = this._horizontal ? detailsMove : 0;
      this._detailsBox.opacity = Math.round(255 * this._elevation.progress);
      const clip = Math.max(0, reveal - 8 * scale);
      this._detailsBox.set_clip?.(0, 0, this._horizontal ? this._geom.contentWidth : clip,
        this._horizontal ? clip : this._geom.contentHeight);
      const width = this._geom.width + (this._horizontal ? 0 : reveal);
      const height = this._geom.height + (this._horizontal ? reveal : 0);
      const originX = this._right ? this.width - width - offset : 0;
      const originY = this.edge === 'bottom' ? this.height - height - offset : 0;
      this._surface.boxes = getAttachedPodPickBoxes({...this._geom, width, height, bodyOffset: offset})
        .map(b => ({x1: b.x1 + originX, x2: b.x2 + originX, y1: b.y1 + originY, y2: b.y2 + originY}));
      this._surface.queue_redraw?.();
      const anchorMove = (this._endAnchored ? -1 : 1) * (reveal + offset);
      this._menuAnchor.translation_x = this._horizontal ? 0 : anchorMove;
      this._menuAnchor.translation_y = this._horizontal ? anchorMove : 0;
      this.systemMenus?.updateAnchor?.(this);
      this.updateTheme();
      this._updatePointerWatch();
    }

    updateTheme() {
      if (!this._geom) return;
      this._canvas.set_state({
        ...this._geom,
        width: this._geom.width + (this._horizontal ? 0 : (this._expansion ?? 0) * this._elevation.progress),
        height: this._geom.height + (this._horizontal ? (this._expansion ?? 0) * this._elevation.progress : 0),
        // Geometry is already in Shell's logical coordinate space.
        scaleFactor: 1,
        position: this.dockPosition,
        alignEnd: this._endAnchored,
        bodyOffset: this._elevation.progress * this._elevation.distance,
        elevationProgress: this._elevation.progress,
        backgroundColor: this.extension?._dockColors?.['background-color'] || [0.08, 0.08, 0.09, 0.72],
        borderColor: this.extension?._dockColors?.['border-color'] || [1, 1, 1, 0.25],
        borderThickness: unifiedAppearance(this.extension).borderThickness,
      });
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._enabled = false;
      if (this._menuOpen) this.systemMenus?.closeAll();
      this._stopPointerWatch();
      this._elevation?.destroy();
      for (const [object, id] of this._signals) object.disconnect(id);
      this._signals = [];
      if (this._stateListener) this.systemState?.removeListener(this._stateListener);
      this._stateListener = null;
      if (this._onChrome) Main.layoutManager.removeChrome(this);
      this._onChrome = false;
      // Clutter owns descendants. Destroy exactly once so their provider listeners disconnect.
      super.destroy();
      this._items.clear();
      this._canvas = this._contentBox = null;
    }
  }
);

export const QuickSettingsPod = GObject.registerClass(
  class QuickSettingsPod extends AttachedPod {
    _init(params = {}) {
      super._init({...params, name: 'QuickSettingsPod'});
      try {
        this._addItem('network', NetworkItem);
        this._addItem('bluetooth', BluetoothItem);
        this._addItem('volume', AudioItem);
        this._addItem('battery', BatteryItem);
        this._stateListener = event => {
          if (['network-changed', 'bluetooth-changed', 'battery-changed', 'audio-changed', 'indicators-changed'].includes(event)) {
            const previousWidth = this._measuredWidth;
            const changed = this._refreshContent();
            if (changed || this.getMeasuredContentWidth() !== previousWidth) this.updateLayout();
          }
        };
        this.systemState.addListener(this._stateListener);
        this._refreshContent();
      } catch (error) { this.destroy(); throw error; }
    }

    get hasUsableControls() {
      return [...this._items.values()].some(item => item.visible);
    }

    _activate() {
      this.systemMenus.toggleQuickSettings(this._menuAnchor, null, this._menuOptions());
    }

    _refreshContent() {
      const state = this.systemState;
      const dynamic = new Map((state.dynamicIndicators ?? []).map(item => [`dynamic-${item.id}`, item]));
      let changed = false;
      for (const [name, item] of this._items) {
        if (!name.startsWith('dynamic-') || dynamic.has(name)) continue;
        this._contentBox.remove_child(item);
        this._items.delete(name);
        item.destroy();
        changed = true;
      }
      for (const [name, indicator] of dynamic) {
        if (!this._items.has(name)) {
          this._addItem(name, DynamicIndicatorItem,
            {nativeAction: indicator.kind === 'recording' || indicator.kind === 'sharing'});
          changed = true;
        }
        this._items.get(name).updateIndicator(indicator);
      }
      const available = {
        network: state.network.available !== false,
        bluetooth: !!state.bluetooth.available,
        battery: !!state.battery.present,
        volume: state.audio.available !== false,
      };
      const iconSize = unifiedAppearance(this.extension).iconSize;
      for (const [name, item] of this._items) {
        const key = `modular_show_${name.replaceAll('-', '_')}`;
        const visible = name.startsWith('dynamic-') || ((this.extension?.[key] ?? true) && available[name]);
        changed ||= item.visible !== visible;
        item.visible = visible;
        if (item._icon?.icon_size !== iconSize) item.setIconSize?.(iconSize);
      }
      const spacing = unifiedAppearance(this.extension).itemSpacing;
      if (this._spacing !== spacing) {
        this._spacing = spacing;
        this._contentBox.set_style(`spacing: ${spacing}px;`);
        this._detailsBox.set_style(`spacing: ${spacing}px;`);
      }
      const details = {
        network: state.network.name || (state.network.connected ? 'Network connected' : 'Network disconnected'),
        bluetooth: `Bluetooth: ${state.bluetooth.enabled ? 'On' : 'Off'}`,
        volume: state.audio.muted ? 'Volume: Muted' : Number.isFinite(state.audio.volume)
          ? `Volume: ${Math.round(state.audio.volume * 100)}%` : 'Volume',
        battery: Number.isFinite(state.battery.percentage)
          ? `Battery: ${Math.round(state.battery.percentage)}%${state.battery.charging ? ' · Charging' : ''}` : 'Battery',
      };
      this._setDetails([...this._items].filter(([, item]) => item.visible).map(([name, item]) =>
        [name, details[name] || item.indicator?.accessibleName || 'System status']));
      return changed;
    }
  }
);

export const InputMethodPod = GObject.registerClass(
  class InputMethodPod extends AttachedPod {
    _init(params = {}) {
      super._init({...params, name: 'InputMethodPod'});
      try {
        this._addItem('input-source', InputSourceItem);
        this._stateListener = event => {
          if (event !== 'input-source-changed') return;
          const previousWidth = this._measuredWidth;
          const changed = this._refreshContent();
          if (changed || this.getMeasuredContentWidth() !== previousWidth) this.updateLayout();
        };
        this.systemState.addListener(this._stateListener);
        this._refreshContent();
      } catch (error) { this.destroy(); throw error; }
    }

    get hasUsableControls() { return !!this._items.get('input-source')?.visible; }

    _activate() {
      this.systemMenus.toggleKeyboardMenu(this._menuAnchor, this._menuOptions());
    }

    _refreshContent() {
      const state = this.systemState.inputSource;
      const item = this._items.get('input-source');
      const visible = !!state.available && this.extension?.modular_show_input_source !== false;
      const changed = item.visible !== visible;
      item.visible = visible;
      const iconSize = unifiedAppearance(this.extension).iconSize;
      if (item._sourceIcon?.icon_size !== iconSize) item.setIconSize?.(iconSize);
      this._setDetails([['input-source', [...new Set([state.displayName, state.mode, state.shortName].filter(Boolean))].join(' · ') || 'Input Method']]);
      return changed;
    }
  }
);

export const ClockPod = GObject.registerClass(
  class ClockPod extends AttachedPod {
    _init(params = {}) {
      super._init({...params, name: 'ClockPod'});
      try {
        this._clockItem = this._addItem('clock', ModularClockItem);
        this._styleItem(this._clockItem);
        this._stateListener = event => {
          if (event === 'clock-changed') {
            this._refreshContent();
            const previous = this._measuredHeight;
            const previousWidth = this._measuredWidth;
            const height = this.getMeasuredContentHeight();
            const width = this.getMeasuredContentWidth();
            if (height !== previous || width !== previousWidth) this.updateLayout();
          }
        };
        this.systemState.addListener(this._stateListener);
        this._refreshContent();
      } catch (error) { this.destroy(); throw error; }
    }

    _refreshContent() {
      this._clockItem?.updatePreferences();
      const time = this.systemState.time;
      const format = this.extension?.modular_clock_format ?? 0;
      const is12h = format === 2 || (format === 0 && time.is12h);
      const hours = format === 1 ? time.hours24 : format === 2 ? time.hours12 : time.hours;
      this._setDetails([
        ['time', `${hours || '00'}:${time.minutes || '00'}${is12h && time.dayPeriod ? ` ${time.dayPeriod}` : ''}`],
        ['weekday', time.fullWeekday || time.dayOfWeek || ''],
        ['date', time.fullDate || [time.dayOfMonth, time.month].filter(Boolean).join(' ')],
      ]);
    }

    getMeasuredContentHeight() {
      const compact = super.getMeasuredContentHeight();
      if (this._horizontal) return compact;
      // A time-only compact clock still needs room for all three information
      // lines. Reserve it during placement, never during a hover frame.
      const details = [...this._detailLabels.values()].reduce((sum, label) =>
        sum + (label.get_preferred_height?.(-1)?.[1] || 16 * unifiedAppearance(this.extension).scale), 0) + 6 * unifiedAppearance(this.extension).scale;
      this._measuredHeight = Math.max(compact, Math.ceil(details));
      return this._measuredHeight;
    }

    _activate() {
      this.systemMenus.toggleDateMenu(this._menuAnchor, this._menuOptions());
    }
  }
);
