'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AttachedDockCanvas } from '../attachedBackground.js';
import {getAttachedPodPickBoxes} from '../attachedGeometry.js';
import {PodElevation} from './podElevation.js';
import {
  NetworkItem, BluetoothItem, AudioItem, BatteryItem, InputSourceItem, ModularClockItem, DynamicIndicatorItem,
} from './systemDockItems.js';

const isFullscreenObscured = monitor => !!monitor?.inFullscreen &&
  ((typeof global !== 'undefined' ? global.window_group?.visible : undefined) ?? !Main.overview?.visible);

// The root reserves the small animation extent but is never reactive. Only
// these boxes, entirely inside the painted contour, participate in picking.
const PodSurface = GObject.registerClass(
  class PodSurface extends St.Widget {
    _init() {
      super._init({reactive: true, can_focus: false});
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
        this.add_child(this._surface);
        this._contentBox = new St.BoxLayout({
          style_class: 'modular-pod-box',
          orientation: Clutter.Orientation.VERTICAL,
          reactive: true,
          x_expand: false,
        });
        if (this._contentBox.layout_manager) {
          this._contentBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        }
        this.add_child(this._contentBox);
        this._destroyed = false;
        this.connect('enter-event', (_actor, event) => {
          const related = event.get_related();
          if (!related || !this.contains(related)) {
            this._pointerInside = true;
            this._syncElevation();
          }
          return Clutter.EVENT_PROPAGATE;
        });
        this.connect('leave-event', (_actor, event) => {
          const related = event.get_related();
          if (!related || !this.contains(related)) {
            this._pointerInside = false;
            this._syncElevation();
          }
          return Clutter.EVENT_PROPAGATE;
        });
        this._surface.connect('button-release-event', (_actor, event) => {
          if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
          if (this._items.size === 1) {
            const item = [...this._items.values()].find(button => button.visible);
            item?._onActivate();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        });
        this.connect('notify::visible', () => {
          if (!this.visible) this._resetInteraction();
        });
        const stage = typeof global !== 'undefined' ? global.stage : null;
        if (stage?.connect)
          this._signals.push([stage, stage.connect('notify::key-focus', () => this._syncElevation())]);
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

    _addItem(name, ItemClass) {
      const item = new ItemClass({
        systemMenus: this.systemMenus,
        systemState: this.systemState,
        extension: this.extension,
        iconSize: this.extension?.modular_indicator_icon_size ?? 16,
        side: St.Side.LEFT,
      });
      // Compact pod items allocate buttons inside the visible body
      item.set_style('min-width: 0; min-height: 0; padding: 2px 1px;');
      item.x_expand = true;
      item.x_align = Clutter.ActorAlign.FILL;
      item._systemPod = this;
      this._items.set(name, item);
      this._contentBox.add_child(item);
      return item;
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
        total += preferred[1] > 0 ? preferred[1] : (this.extension?.modular_indicator_icon_size ?? 16) + 4;
      }
      const spacing = this._spacing ?? (this.extension?.modular_indicator_spacing ?? 3);
      total += Math.max(0, visibleItems.length - 1) * spacing;
      this._measuredHeight = Math.ceil(total > 0 ? total : 60);
      return this._measuredHeight;
    }

    getMeasuredContentWidth() {
      const preferred = this._contentBox.layout_manager?.get_preferred_width?.(this._contentBox, -1) ??
        this._contentBox.get_preferred_width?.(-1);
      const natural = preferred?.[1];
      const val = Number.isFinite(natural) && natural > 0
        ? natural
        : (this.extension?.modular_indicator_icon_size ?? 16) + 2;
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
      const gx = Number.isFinite(geometry.x) ? Math.round(geometry.x) : 0;
      const gy = Number.isFinite(geometry.y) ? Math.round(geometry.y) : 0;
      const gw = Number.isFinite(geometry.width) && geometry.width > 0 ? Math.round(geometry.width) : 24;
      const gh = Number.isFinite(geometry.height) && geometry.height > 0 ? Math.round(geometry.height) : 60;

      this.set_position(gx, gy);
      this._elevation.configure(this.extension);
      const dist = Number.isFinite(this._elevation.distance) ? this._elevation.distance : 3;
      const reserve = dist + 4;
      const totalWidth = gw + reserve;
      this.set_size(totalWidth, gh);
      this._canvas.set_position(0, 0);
      this._canvas.set_size(totalWidth, gh);
      this._surface.set_position(0, 0);
      this._surface.set_size(totalWidth, gh);
      const inset = geometry.contentLeft ?? 2;
      const safeInset = Number.isFinite(inset) ? Math.round(inset) : 2;
      const contentTop = Number.isFinite(geometry.contentTop) ? Math.round(geometry.contentTop) : 17;
      const contentWidth = Number.isFinite(geometry.contentWidth) && geometry.contentWidth > 0
        ? Math.round(geometry.contentWidth)
        : Math.max(1, gw - safeInset - 2);
      const contentHeight = Number.isFinite(geometry.contentHeight) && geometry.contentHeight > 0
        ? Math.round(geometry.contentHeight)
        : Math.max(1, gh - 2 * contentTop);
      this._contentBox.set_position(safeInset, contentTop);
      this._contentBox.set_size(contentWidth, contentHeight);
      const monitor = Main.layoutManager.findMonitorForActor?.(this) || Main.layoutManager.primaryMonitor;
      this.visible = geometry.visible !== false && !isFullscreenObscured(monitor);
      this._syncElevation();
      this._applyElevation();
    }

    _syncElevation(immediate = false) {
      if (this._destroyed) return;
      const focus = typeof global !== 'undefined' ? global.stage?.get_key_focus() : null;
      const active = this.visible && (this._pointerInside || this._menuOpen || (!!focus && this.contains(focus)));
      this._elevation.setActive(active, immediate);
    }

    onMenuStateChanged(open) {
      this._menuOpen = open;
      // Native grabs can suppress crossing events. Re-pick after dismissal
      // instead of retaining a stale pre-menu hover flag.
      if (!open) {
        const stage = typeof global !== 'undefined' ? global.stage : null;
        const pointer = typeof global !== 'undefined' ? global.get_pointer?.() : null;
        const actor = pointer && stage?.get_actor_at_pos(Clutter.PickMode.REACTIVE, pointer[0], pointer[1]);
        this._pointerInside = !!actor && this.contains(actor);
      }
      this._syncElevation();
    }

    _resetInteraction() {
      if (this._destroyed) return;
      this._pointerInside = false;
      if (this._menuOpen) this.systemMenus?.closeAll();
      this._menuOpen = false;
      this._elevation.setActive(false, true);
    }

    _applyElevation() {
      if (!this._geom || this._destroyed) return;
      const offset = this._elevation.progress * this._elevation.distance;
      this._contentBox.translation_x = offset;
      this._surface.boxes = getAttachedPodPickBoxes({...this._geom, bodyOffset: offset});
      this._surface.queue_redraw?.();
      this.systemMenus?.updateAnchor?.(this);
      this.updateTheme();
    }

    updateTheme() {
      if (!this._geom) return;
      this._canvas.set_state({
        ...this._geom,
        // Geometry is already in Shell's logical coordinate space.
        scaleFactor: 1,
        position: 'left',
        bodyOffset: this._elevation.progress * this._elevation.distance,
        elevationProgress: this._elevation.progress,
        backgroundColor: this.extension?._dockColors?.['background-color'] || [0.08, 0.08, 0.09, 0.72],
        borderColor: this.extension?._dockColors?.['border-color'] || [1, 1, 1, 0.25],
        borderThickness: this.extension?.border_thickness ?? 0,
      });
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._enabled = false;
      if (this._menuOpen) this.systemMenus?.closeAll();
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
        this._addItem('input-source', InputSourceItem);
        this._stateListener = event => {
          if (['network-changed', 'bluetooth-changed', 'battery-changed', 'audio-changed', 'input-source-changed', 'indicators-changed'].includes(event)) {
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
          this._addItem(name, DynamicIndicatorItem);
          changed = true;
        }
        this._items.get(name).updateIndicator(indicator);
      }
      const available = {
        network: state.network.available !== false,
        bluetooth: !!state.bluetooth.available,
        battery: !!state.battery.present,
        volume: state.audio.available !== false,
        'input-source': !!state.inputSource.available,
      };
      const iconSize = this.extension?.modular_indicator_icon_size ?? 16;
      for (const [name, item] of this._items) {
        const key = `modular_show_${name.replaceAll('-', '_')}`;
        const visible = name.startsWith('dynamic-') || ((this.extension?.[key] ?? true) && available[name]);
        changed ||= item.visible !== visible;
        item.visible = visible;
        if (item._icon?.icon_size !== iconSize) item.setIconSize?.(iconSize);
      }
      const spacing = this.extension?.modular_indicator_spacing ?? 3;
      if (this._spacing !== spacing) {
        this._spacing = spacing;
        this._contentBox.set_style(`spacing: ${spacing}px;`);
      }
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
        this._clockItem.set_style('min-width: 0; min-height: 0; padding: 2px 0;');
        this._stateListener = event => {
          if (event === 'clock-changed') {
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
    }
  }
);
