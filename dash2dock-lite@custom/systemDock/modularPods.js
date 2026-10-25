'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AttachedDockCanvas } from '../attachedBackground.js';
import {getAttachedPodPickBoxes, LEFT_MODULAR_WIDTH} from '../attachedGeometry.js';
import {PodElevation} from './podElevation.js';
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
        iconSize: this.extension?.modular_indicator_icon_size ?? 16,
        side: St.Side.LEFT,
      });
      // Compact pod items allocate buttons inside the visible body
      item.set_style('min-width: 0; min-height: 0; padding: 2px 1px;');
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

    _activate() {}

    _syncPointerHover() {
      const stage = typeof global !== 'undefined' ? global.stage : null;
      const pointer = typeof global !== 'undefined' ? global.get_pointer?.() : null;
      const picked = pointer && stage?.get_actor_at_pos(Clutter.PickMode.REACTIVE, pointer[0], pointer[1]);
      // Crossing from the capsule button to its stop control can clear the old
      // hover flag before setting the new one. The current pick bridges that gap.
      this._pointerInside = picked ? this.contains(picked) :
        [this._surface, ...this._items.values()].some(actor => actor.visible && actor.reactive && actor.hover);
      this._syncElevation();
    }

    _menuOptions() { return {side: St.Side.LEFT, focusActor: this._surface}; }

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
      const natural = this._detailsBox.layout_manager?.get_preferred_width?.(this._detailsBox, -1)?.[1] ??
        Math.max(0, ...[...this._detailLabels.values()].map(label => label.get_preferred_width?.(-1)?.[1] ?? 0));
      const available = Math.max(0, (monitor?.width ?? 1920) - g.width - this._elevation.distance - 12);
      this._expansion = Math.min(320, available, Math.ceil(natural) + 18);
      const reserve = g.width + this._expansion + this._elevation.distance + 4;
      this.set_size(reserve, g.height);
      this._canvas.set_size(reserve, g.height);
      this._surface.set_size(reserve, g.height);
      this._detailsBox.set_position(g.width + 8, g.contentTop);
      this._detailsBox.set_size(Math.max(1, this._expansion - 16), g.contentHeight);
      this._applyElevation();
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
      const gw = Number.isFinite(geometry.width) && geometry.width > 0 ? Math.round(geometry.width) : LEFT_MODULAR_WIDTH;
      const gh = Number.isFinite(geometry.height) && geometry.height > 0 ? Math.round(geometry.height) : 60;

      this.set_position(gx, gy);
      this._elevation.configure(this.extension);
      this._canvas.set_position(0, 0);
      this._surface.set_position(0, 0);
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
      this._menuAnchor.set_position(gw - 1, gh / 2);
      this._geom = {...geometry, width: gw, height: gh, contentTop, contentHeight};
      this._sizeExpansion();
      const monitor = Main.layoutManager.findMonitorForActor?.(this) || Main.layoutManager.primaryMonitor;
      this.visible = geometry.visible !== false && !isFullscreenObscured(monitor);
      this._syncElevation();
      this._applyElevation();
    }

    _syncElevation(immediate = false) {
      if (this._destroyed) return;
      // Focus returning after a popup closes must not latch the capsule open.
      const active = this.visible && (this._pointerInside || this._menuOpen);
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
      const reveal = (this._expansion ?? 0) * this._elevation.progress;
      this._contentBox.translation_x = offset;
      this._detailsBox.translation_x = offset;
      this._detailsBox.opacity = Math.round(255 * this._elevation.progress);
      this._detailsBox.set_clip?.(0, 0, Math.max(0, reveal - 8), this._geom.contentHeight);
      this._surface.boxes = getAttachedPodPickBoxes({...this._geom,
        width: this._geom.width + reveal, bodyOffset: offset});
      this._surface.queue_redraw?.();
      this._menuAnchor.translation_x = reveal + offset;
      this.systemMenus?.updateAnchor?.(this);
      this.updateTheme();
    }

    updateTheme() {
      if (!this._geom) return;
      this._canvas.set_state({
        ...this._geom,
        width: this._geom.width + (this._expansion ?? 0) * this._elevation.progress,
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
      const iconSize = this.extension?.modular_indicator_icon_size ?? 16;
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
        this._clockItem.set_style('min-width: 0; min-height: 0; padding: 2px 0;');
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
      // A time-only compact clock still needs room for all three information
      // lines. Reserve it during placement, never during a hover frame.
      const details = [...this._detailLabels.values()].reduce((sum, label) =>
        sum + (label.get_preferred_height?.(-1)?.[1] || 16), 0) + 6;
      this._measuredHeight = Math.max(compact, Math.ceil(details));
      return this._measuredHeight;
    }

    _activate() {
      this.systemMenus.toggleDateMenu(this._menuAnchor, this._menuOptions());
    }
  }
);
