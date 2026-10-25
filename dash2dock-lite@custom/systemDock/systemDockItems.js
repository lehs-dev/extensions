'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ButtonBase = St.Button;
const WidgetBase = St.Widget;

export const SystemDockSeparator = GObject.registerClass(
  {},
  class SystemDockSeparator extends WidgetBase {
    _init(params = {}) {
      if (this._initialized) return;
      this._initialized = true;

      const alignCenter = Clutter.ActorAlign?.CENTER ?? 2;
      if (typeof super._init === 'function') {
        super._init({
          style_class: 'system-dock-separator',
          reactive: false,
          can_focus: false,
          x_align: alignCenter,
        });
      } else {
        this.style_class = 'system-dock-separator';
        this.reactive = false;
        this.can_focus = false;
        this.x_align = alignCenter;
      }
      this.visible = true;
      if (typeof this.show === 'function') this.show();
    }
  }
);

export const SystemDockButton = GObject.registerClass(
  {},
  class SystemDockButton extends ButtonBase {
    _init(params = {}) {
      if (this._initialized) return;
      this._initialized = true;

      const accessibleName = params?.accessibleName;
      const alignCenter = Clutter.ActorAlign?.CENTER ?? 2;

      if (typeof super._init === 'function') {
        super._init({
          style_class: 'system-dock-button',
          can_focus: true,
          reactive: true,
          track_hover: true,
          x_align: alignCenter,
        });
      } else {
        this.style_class = 'system-dock-button';
        this.can_focus = true;
        this.reactive = true;
        this.track_hover = true;
        this.x_align = alignCenter;
      }

      this.side = params.side ?? St.Side.RIGHT;
      this.visible = true;
      if (typeof this.show === 'function') this.show();

      if (accessibleName && this.accessible_name !== undefined) {
        this.accessible_name = accessibleName;
      }

      this.connect('destroy', () => {
        if (this._stateListener) this.systemState?.removeListener(this._stateListener);
        this._stateListener = null;
      });

      this.connect('clicked', () => {
        if (typeof this._onActivate === 'function') {
          this._onActivate();
        }
      });
    }

    _onActivate() {
      // Subclasses override
    }
  }
);

export const DynamicIndicatorItem = GObject.registerClass(
  class DynamicIndicatorItem extends SystemDockButton {
    _init(params = {}) {
      super._init({accessibleName: 'System status', side: params.side});
      this.systemState = params.systemState;
      this.systemMenus = params.systemMenus;
      this._icon = new St.Icon({icon_size: params.iconSize ?? 16, style_class: 'system-dock-icon'});
      this.set_child(this._icon);
    }

    updateIndicator(indicator) {
      this.indicator = indicator;
      this.accessible_name = indicator.accessibleName;
      if (indicator.gicon) this._icon.gicon = indicator.gicon;
      else if (this._icon.icon_name !== indicator.iconName) this._icon.icon_name = indicator.iconName;
    }

    setIconSize(size) { this._icon.icon_size = size; }

    _onActivate() {
      if (this.indicator?.kind === 'recording' || this.indicator?.kind === 'sharing') {
        // A stale stop button must never turn into an unrelated menu toggle.
        this.systemState.activateDynamicIndicator?.(this.indicator);
        return;
      }
      if (!this.systemState.activateDynamicIndicator?.(this.indicator))
        this.systemMenus?.toggleQuickSettings(this, null, {side: this.side});
    }
  }
);

export const ClockItem = GObject.registerClass(
  {},
  class ClockItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Clock and Calendar', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;

      const box = new St.BoxLayout({
        style_class: 'system-dock-clock-box',
        orientation: Clutter.Orientation.VERTICAL,
      });
      if (box.layout_manager) {
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
      }
      this.set_child ? this.set_child(box) : this.add_child(box);

      this._hourLabel = new St.Label({
        style_class: 'system-dock-clock-label',
        text: '00',
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._minLabel = new St.Label({
        style_class: 'system-dock-clock-label',
        text: '00',
        x_align: Clutter.ActorAlign.CENTER,
      });

      box.add_child(this._hourLabel);
      box.add_child(this._minLabel);

      this._stateListener = (event, data) => {
        if (event === 'clock-changed') {
          this.updateTime(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateTime(this.systemState.time);
      }
    }

    updateTime(time) {
      if (!time) return;
      if (this._hourLabel) this._hourLabel.text = time.hours;
      if (this._minLabel) this._minLabel.text = time.minutes;
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleDateMenu(this, {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const NetworkItem = GObject.registerClass(
  {},
  class NetworkItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Network Settings', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      const iconSize = params?.iconSize || 18;

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'network-wireless-symbolic',
        icon_size: iconSize,
      });
      this.set_child ? this.set_child(this._icon) : this.add_child(this._icon);

      this._stateListener = (event, data) => {
        if (event === 'network-changed') {
          this.updateNetwork(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateNetwork(this.systemState.network);
      }
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    updateNetwork(net) {
      if (!net || !this._icon) return;
      this._icon.icon_name = net.iconName;
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleQuickSettings(this, 'network', {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const BluetoothItem = GObject.registerClass(
  {},
  class BluetoothItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Bluetooth Settings', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      const iconSize = params?.iconSize || 18;

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'bluetooth-active-symbolic',
        icon_size: iconSize,
      });
      this.set_child ? this.set_child(this._icon) : this.add_child(this._icon);

      this._stateListener = (event, data) => {
        if (event === 'bluetooth-changed') {
          this.updateBluetooth(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateBluetooth(this.systemState.bluetooth);
      }
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    updateBluetooth(bt) {
      if (!bt || !this._icon) return;
      this._icon.icon_name = bt.iconName;

    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleQuickSettings(this, 'bluetooth', {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const AudioItem = GObject.registerClass(
  {},
  class AudioItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Audio Volume', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      const iconSize = params?.iconSize || 18;

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'audio-volume-high-symbolic',
        icon_size: iconSize,
      });
      this.set_child ? this.set_child(this._icon) : this.add_child(this._icon);

      this.connect('scroll-event', (actor, event) => {
        const direction = typeof event?.get_scroll_direction === 'function' ? event.get_scroll_direction() : event?.direction;
        if (direction === Clutter.ScrollDirection.UP || direction === 0) {
          this.systemState?.adjustVolume(0.05);
          return Clutter.EVENT_STOP;
        } else if (direction === Clutter.ScrollDirection.DOWN || direction === 1) {
          this.systemState?.adjustVolume(-0.05);
          return Clutter.EVENT_STOP;
        } else if (direction === Clutter.ScrollDirection.SMOOTH || direction === 4) {
          const delta = typeof event?.get_scroll_delta === 'function' ? event.get_scroll_delta()[1] : 0;
          if (delta < 0) {
            this.systemState?.adjustVolume(0.05);
          } else if (delta > 0) {
            this.systemState?.adjustVolume(-0.05);
          }
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });

      this._stateListener = (event, data) => {
        if (event === 'audio-changed') {
          this.updateAudio(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateAudio(this.systemState.audio);
      }
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    updateAudio(audio) {
      if (!audio || !this._icon) return;
      this._icon.icon_name = audio.iconName;
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleQuickSettings(this, 'audio', {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const BatteryItem = GObject.registerClass(
  {},
  class BatteryItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Battery Status', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      const iconSize = params?.iconSize || 18;

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'battery-level-100-symbolic',
        icon_size: iconSize,
      });
      this.set_child ? this.set_child(this._icon) : this.add_child(this._icon);

      this._stateListener = (event, data) => {
        if (event === 'battery-changed') {
          this.updateBattery(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateBattery(this.systemState.battery);
      }
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    updateBattery(bat) {
      if (!bat || !this._icon) return;
      this._icon.icon_name = bat.iconName;
      // Handle desktops without batteries gracefully by hiding the indicator
      if (bat.gicon) this._icon.gicon = bat.gicon;
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleQuickSettings(this, 'power', {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const NotificationItem = GObject.registerClass(
  {},
  class NotificationItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Notifications', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      const iconSize = params?.iconSize || 18;

      const container = new St.Widget({
        style_class: 'system-dock-notif-container',
      });
      if (Clutter?.BinLayout) {
        container.layout_manager = new Clutter.BinLayout();
      }
      this.set_child ? this.set_child(container) : this.add_child(container);

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'preferences-system-notifications-symbolic',
        icon_size: iconSize,
      });
      container.add_child(this._icon);

      this._badge = new St.Widget({
        style_class: 'system-dock-badge',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        visible: false,
      });
      container.add_child(this._badge);

      this._stateListener = (event, data) => {
        if (event === 'notifications-changed') {
          this.updateNotifications(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this.updateNotifications(this.systemState.notifications);
      }
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    updateNotifications(notif) {
      if (!notif || !this._icon) return;
      this._icon.icon_name = notif.iconName;
      if (this._badge) {
        this._badge.visible = !notif.dnd && notif.unreadCount > 0;
      }
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleDateMenu(this, {side: this.side});
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const PowerItem = GObject.registerClass(
  {},
  class PowerItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Power & Session Options', side: params.side });

      this.systemMenus = params?.systemMenus;
      const iconSize = params?.iconSize || 18;

      this._icon = new St.Icon({
        style_class: 'system-dock-icon',
        icon_name: 'system-shutdown-symbolic',
        icon_size: iconSize,
      });
      this.set_child ? this.set_child(this._icon) : this.add_child(this._icon);
    }

    setIconSize(size) {
      if (this._icon) {
        this._icon.icon_size = size;
        this._icon.set_style?.(`icon-size: ${size}px;`);
      }
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.togglePowerMenu(this, {side: this.side});
      }
    }
  }
);

export const ModularClockItem = GObject.registerClass(
  {},
  class ModularClockItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Clock and Calendar', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      this.extension = params.extension;
      this.side = params?.side ?? (St?.Side?.LEFT ?? 3);

      const box = new St.BoxLayout({
        style_class: 'modular-clock-box',
        orientation: Clutter.Orientation.VERTICAL,
      });
      if (box.layout_manager) {
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
      }
      this.set_child ? this.set_child(box) : this.add_child(box);

      this._hourLabel = new St.Label({
        style_class: 'modular-clock-label modular-clock-time',
        text: '00',
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._minLabel = new St.Label({
        style_class: 'modular-clock-label modular-clock-time',
        text: '00',
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._dayLabel = new St.Label({
        style_class: 'modular-clock-label modular-clock-day',
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._dateLabel = new St.Label({
        style_class: 'modular-clock-label modular-clock-date',
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
      });

      this._monthLabel = new St.Label({
        style_class: 'modular-clock-label modular-clock-month',
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
      });

      box.add_child(this._hourLabel);
      box.add_child(this._minLabel);
      this._periodLabel = new St.Label({style_class: 'modular-clock-label modular-clock-day', text: '', x_align: Clutter.ActorAlign.CENTER});
      box.add_child(this._periodLabel);
      box.add_child(this._dayLabel);
      box.add_child(this._dateLabel);
      box.add_child(this._monthLabel);

      this._stateListener = (event, data) => {
        if (event === 'clock-changed' && data) {
          this._updateLabels(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this._updateLabels(this.systemState.time);
      }
    }

    updatePreferences() {
      this._dayLabel.visible = this.extension?.modular_clock_show_weekday ?? true;
      this._dateLabel.visible = this._monthLabel.visible = this.extension?.modular_clock_show_date ?? true;
      this._updateLabels(this.systemState?.time);
    }

    _updateLabels(time) {
      if (!time) return;
      const format = this.extension?.modular_clock_format ?? 0;
      if (this._hourLabel) this._hourLabel.text = (format === 1 ? time.hours24 : format === 2 ? time.hours12 : time.hours) || '';
      this.accessible_name = time.accessible || 'Clock and Calendar';
      this._periodLabel.text = time.dayPeriod || '';
      this._periodLabel.visible = format === 2 || (format === 0 && !!time.is12h);
      if (this._minLabel) this._minLabel.text = time.minutes || '00';
      if (this._dayLabel) this._dayLabel.text = time.dayOfWeek || '';
      if (this._dateLabel) this._dateLabel.text = time.dayOfMonth || '';
      if (this._monthLabel) this._monthLabel.text = time.month || '';
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleDateMenu(this, { side: this.side });
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);

export const InputSourceItem = GObject.registerClass(
  {},
  class InputSourceItem extends SystemDockButton {
    _init(params = {}) {
      if (this._initialized) return;
      super._init({ accessibleName: 'Input Method & Keyboard Layout', side: params.side });

      this.systemMenus = params?.systemMenus;
      this.systemState = params?.systemState;
      this.extension = params.extension;
      this.side = params?.side ?? (St?.Side?.LEFT ?? 3);

      this._label = new St.Label({
        style_class: 'system-dock-input-label',
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
      });
      const box = new St.BoxLayout({reactive: false});
      this._sourceIcon = new St.Icon({icon_name: 'input-keyboard-symbolic', icon_size: params.iconSize ?? 18});
      box.add_child(this._label);
      box.add_child(this._sourceIcon);
      this.set_child(box);

      this._stateListener = (event, data) => {
        if (event === 'input-source-changed' && data) {
          this._updateLabel(data);
        }
      };

      if (this.systemState) {
        this.systemState.addListener(this._stateListener);
        this._updateLabel(this.systemState.inputSource);
      }
    }

    setIconSize(size) {
      this._sourceIcon.icon_size = size;
    }

    _updateLabel(source) {
      if (!source) return;
      if (this._label) {
        this._label.text = source.shortName || '';
        this._label.visible = !!source.shortName;
        this._sourceIcon.visible = !source.shortName;
        this._sourceIcon.gicon = source.gicon || null;
        if (!source.gicon) this._sourceIcon.icon_name = source.iconName;
        this.accessible_name = source.displayName;
      }
    }

    _onActivate() {
      if (this.systemMenus) {
        this.systemMenus.toggleKeyboardMenu(this, { side: this.side });
      }
    }

    destroy() {
      if (this.systemState && this._stateListener) {
        this.systemState.removeListener(this._stateListener);
        this._stateListener = null;
      }
      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);
