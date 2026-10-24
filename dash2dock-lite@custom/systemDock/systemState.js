'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const status = () => Main.panel?.statusArea;
const volumeIndicator = () => status()?.quickSettings?._volumeOutput ||
  status()?.quickSettings?._volumeOutputIndicator || status()?.quickSettings?._volume;
const volumeSlider = () => volumeIndicator()?._output || volumeIndicator();

/** One shared, signal-driven view of Shell's existing providers. No duplicate DBus clients. */
export class SystemState {
  constructor() {
    this._listeners = new Set();
    this._signals = [];
    this._groups = new Map();
    this._clockTimeoutId = null;
    this._destroyed = false;
    this.time = {};
    this.network = {available: false, connected: false, iconName: 'network-offline-symbolic'};
    this.bluetooth = {available: false, enabled: false, iconName: 'bluetooth-disabled-symbolic'};
    this.audio = {available: false, volume: null, muted: false, iconName: 'audio-volume-muted-symbolic'};
    this.battery = {present: false, percentage: null, charging: false, iconName: 'battery-missing-symbolic'};
    this.notifications = {unreadCount: 0, dnd: false, iconName: 'preferences-system-notifications-symbolic'};
    this.inputSource = {available: false, shortName: '', displayName: '', provider: null};
    try {
      this._initSettings();
      this._initClock();
      this._initNetwork();
      this._initBluetooth();
      this._initAudio();
      this._initBattery();
      this._initNotifications();
      this._initInputSource();
      this._connectSafe(Main.extensionManager, 'extension-state-changed', () => this._initInputSource());
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  addListener(callback) { if (typeof callback === 'function') this._listeners.add(callback); }
  removeListener(callback) { this._listeners.delete(callback); }
  _emit(event, data) {
    if (this._destroyed) return;
    for (const listener of this._listeners) {
      try { listener(event, data); }
      catch (error) { console.error(`dash2dock-lite: ${event} listener failed`, error); }
    }
  }

  _connectSafe(obj, signal, callback, list = this._signals) {
    if (!obj?.connect) return;
    try { list.push({obj, id: obj.connect(signal, callback)}); }
    catch (error) {
      // Feature-tested optional Shell versions may not expose every signal.
      console.debug?.(`dash2dock-lite: optional signal ${signal} unavailable: ${error.message}`);
    }
  }

  _disconnect(list) {
    for (const {obj, id} of list) {
      try { obj.disconnect(id); }
      catch (error) { console.debug?.('dash2dock-lite: provider already disposed', error.message); }
    }
    list.length = 0;
  }

  _watch(key, obj, signals, callback) {
    const old = this._groups.get(key);
    if (old?.obj === obj) return;
    if (old) this._disconnect(old.signals);
    const group = {obj, signals: []};
    this._groups.set(key, group);
    for (const signal of signals) this._connectSafe(obj, signal, callback, group.signals);
  }

  _initSettings() {
    try {
      this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
      this._connectSafe(this._interfaceSettings, 'changed::clock-format', () => this._updateClock());
      this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
      this._connectSafe(this._notificationSettings, 'changed::show-banners', () => this._updateNotifications());
    } catch (error) {
      console.error('dash2dock-lite: system settings unavailable', error);
    }
  }

  _initClock() {
    this._updateClock();
    // Shell's WallClock handles timezone, wall-time and locale changes. Reuse it
    // rather than creating a competing recurring source in the normal session.
    const clock = status()?.dateMenu?._clock;
    if (clock?.connect) {
      this._connectSafe(clock, 'notify::clock', () => this._updateClock());
      this._connectSafe(clock, 'notify::timezone', () => this._updateClock());
      return;
    }
    const schedule = () => {
      if (this._destroyed) return;
      const seconds = GLib.DateTime.new_now_local().get_seconds();
      this._clockTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
        Math.max(1, 60 - seconds), () => {
          this._clockTimeoutId = null;
          this._updateClock();
          schedule();
          return GLib.SOURCE_REMOVE;
        });
    };
    schedule();
  }

  _updateClock() {
    const now = GLib.DateTime.new_now_local();
    const hours24 = now.format('%H');
    const hours12 = now.format('%l')?.trim();
    const next = {
      is12h: this._interfaceSettings?.get_string('clock-format') === '12h',
      hours: this._interfaceSettings?.get_string('clock-format') === '12h' ? hours12 : hours24,
      hours24, hours12,
      minutes: now.format('%M'),
      dayPeriod: now.format('%p'),
      dayOfWeek: now.format('%a'),
      dayOfMonth: now.format('%e')?.trim(),
      month: now.format('%b'),
      accessible: now.format('%A %e %B %Y %H:%M'),
    };
    if (JSON.stringify(next) === JSON.stringify(this.time)) return;
    this.time = next;
    this._emit('clock-changed', this.time);
  }

  _initNetwork() {
    const indicator = status()?.quickSettings?._network;
    const icon = indicator?._primaryIndicator || indicator?._indicator;
    this._watch('network-icon', icon, ['notify::icon-name', 'notify::visible'], () => this._updateNetwork());
    this._updateNetwork();
  }

  _updateNetwork() {
    const indicator = status()?.quickSettings?._network;
    const icon = indicator?._primaryIndicator || indicator?._indicator;
    const client = indicator?._client;
    this._watch('network-client', client, ['notify::state', 'notify::connectivity'], () => this._updateNetwork());
    const iconName = icon?.icon_name || 'network-offline-symbolic';
    const connected = client?.get_state ? client.get_state() >= 50 :
      !!indicator && indicator.visible !== false && !/offline|disconnected|no-route/.test(iconName);
    this.network = {available: !!indicator, connected, iconName, state: connected ? 'connected' : 'disconnected'};
    this._emit('network-changed', this.network);
  }

  _initBluetooth() {
    const indicator = status()?.quickSettings?._bluetooth;
    this._watch('bluetooth-icon', indicator?._indicator, ['notify::icon-name', 'notify::visible'], () => this._updateBluetooth());
    this._watch('bluetooth-client', indicator?._client,
      ['notify::available', 'notify::active', 'notify::adapter-state', 'devices-changed'], () => this._updateBluetooth());
    this._updateBluetooth();
  }

  _updateBluetooth() {
    const indicator = status()?.quickSettings?._bluetooth;
    const client = indicator?._client;
    const available = client ? !!client.available : !!indicator;
    const enabled = client ? !!client.active : indicator?.visible !== false && !!indicator;
    this.bluetooth = {available, enabled,
      iconName: enabled ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic'};
    this._emit('bluetooth-changed', this.bluetooth);
  }

  _initAudio() {
    const indicator = volumeIndicator();
    this._watch('audio-icon', indicator?._indicator, ['notify::icon-name'], () => this._updateAudio());
    this._watch('audio-output', indicator?._output, ['stream-updated'], () => this._updateAudio());
    this._updateAudio();
  }

  _updateAudio() {
    const indicator = volumeIndicator();
    const slider = volumeSlider();
    const stream = slider?.stream || slider?._stream;
    this._watch('audio-stream', stream, ['notify::volume', 'notify::is-muted'], () => this._updateAudio());
    const norm = (slider?._control || indicator?._control)?.get_vol_max_norm?.() || 65536;
    const volume = stream ? stream.volume / norm : null;
    const muted = !!stream?.is_muted;
    const iconName = muted || volume === 0 ? 'audio-volume-muted-symbolic' :
      indicator?._indicator?.icon_name || slider?.getIcon?.() || 'audio-volume-muted-symbolic';
    this.audio = {available: !!stream, volume, muted, iconName};
    this._emit('audio-changed', this.audio);
  }

  adjustVolume(delta) {
    const indicator = volumeIndicator();
    const slider = volumeSlider();
    const stream = slider?.stream || slider?._stream;
    if (!stream || !Number.isFinite(delta)) return false;
    const norm = (slider?._control || indicator?._control)?.get_vol_max_norm?.() || 65536;
    const volume = Math.round(Math.max(0, Math.min(norm, stream.volume + delta * norm)));
    if (stream.set_volume) stream.set_volume(volume);
    else stream.volume = volume;
    stream.change_is_muted?.(volume === 0);
    stream.push_volume();
    this._updateAudio();
    return true;
  }

  toggleMute() {
    const stream = volumeSlider()?.stream || volumeSlider()?._stream;
    if (!stream) return false;
    stream.change_is_muted(!stream.is_muted);
    this._updateAudio();
    return true;
  }

  _initBattery() {
    const indicator = status()?.quickSettings?._system;
    const toggle = indicator?._systemItem?.powerToggle;
    this._watch('battery-toggle', toggle, ['notify::visible', 'notify::gicon', 'notify::title'], () => this._updateBattery());
    this._watch('battery-proxy', toggle?._proxy, ['g-properties-changed'], () => this._updateBattery());
    this._watch('battery-icon', indicator?._indicator, ['notify::icon-name', 'notify::gicon'], () => this._updateBattery());
    this._updateBattery();
  }

  _updateBattery() {
    const indicator = status()?.quickSettings?._system;
    const toggle = indicator?._systemItem?.powerToggle;
    const proxy = toggle?._proxy;
    const icon = indicator?._indicator;
    const iconName = icon?.icon_name || toggle?.fallback_icon_name || 'battery-missing-symbolic';
    const present = proxy ? !!proxy.IsPresent : toggle ? !!toggle.visible :
      !!indicator && indicator.visible !== false && iconName.startsWith('battery');
    this.battery = {present,
      percentage: present && Number.isFinite(proxy?.Percentage) ? proxy.Percentage : null,
      charging: proxy ? proxy.State === 1 : iconName.includes('charging'),
      iconName, gicon: toggle?.gicon || icon?.gicon || null};
    this._emit('battery-changed', this.battery);
  }

  _initNotifications() {
    const indicator = status()?.dateMenu?._indicator;
    this._watch('notifications', indicator, ['notify::visible'], () => this._updateNotifications());
    this._watch('message-tray', Main.messageTray, ['source-added', 'source-removed', 'queue-changed'], () => this._updateNotifications());
    this._notificationSources = new Set();
    this._updateNotifications();
  }

  _updateNotifications() {
    const sources = new Set(Main.messageTray?.getSources?.() || []);
    for (const source of this._notificationSources || []) {
      if (!sources.has(source)) {
        this._watch(source, null, [], null);
        this._groups.delete(source);
      }
    }
    for (const source of sources)
      this._watch(source, source, ['notify::count'], () => this._updateNotifications());
    this._notificationSources = sources;
    const indicator = status()?.dateMenu?._indicator;
    const dnd = this._notificationSettings?.get_boolean('show-banners') === false;
    this.notifications = {dnd, unreadCount: indicator?._count ?? (indicator?.visible ? 1 : 0),
      iconName: dnd ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic'};
    this._emit('notifications-changed', this.notifications);
  }

  _initInputSource() {
    const keyboard = status()?.keyboard;
    const kim = status()?.kimpanel;
    this._watch('input-manager', keyboard?._inputSourceManager,
      ['current-source-changed', 'sources-changed', 'keymap-changed'], () => this._updateInputSource());
    this._watch('input-keyboard', keyboard, ['notify::visible'], () => this._updateInputSource());
    this._watch('input-kimpanel', kim, ['notify::visible'], () => this._updateInputSource());
    this._watch('input-label', kim?.labelIcon, ['notify::text', 'notify::visible'], () => this._updateInputSource());
    this._watch('input-icon', kim?.mainIcon, ['notify::gicon', 'notify::visible'], () => this._updateInputSource());
    this._updateInputSource();
  }

  _updateInputSource() {
    const keyboard = status()?.keyboard;
    const kim = status()?.kimpanel;
    const source = keyboard?._getCurrentSource?.() || keyboard?._inputSourceManager?.currentSource || keyboard?._currentSource;
    const useKim = !!kim?.visible;
    const shortName = useKim ? (kim.labelIcon?.visible ? kim.labelIcon.text : '') :
      source?.shortName || keyboard?._indicatorLabel?.text || '';
    const available = useKim ? !!kim.menu : !!source && !!keyboard?.menu;
    this.inputSource = {available, shortName,
      displayName: useKim ? shortName || 'Input Method' : source?.displayName || shortName,
      provider: useKim ? 'kimpanel' : 'keyboard',
      gicon: useKim && kim.mainIcon?.visible ? kim.mainIcon.gicon : null,
      iconName: 'input-keyboard-symbolic'};
    this._emit('input-source-changed', this.inputSource);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._clockTimeoutId !== null) GLib.source_remove(this._clockTimeoutId);
    this._clockTimeoutId = null;
    this._disconnect(this._signals);
    for (const group of this._groups.values()) this._disconnect(group.signals);
    this._groups.clear();
    this._listeners.clear();
    this._interfaceSettings = this._notificationSettings = null;
  }
}
