'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SystemDock} from './systemDock/systemDock.js';
import {QuickSettingsPod, ClockPod} from './systemDock/modularPods.js';
import {SystemState} from './systemDock/systemState.js';
import {SystemMenus} from './systemDock/systemMenus.js';
import {computeLeftModularGeometry} from './systemDock/systemDockLayout.js';

export const LayoutMode = {DUAL_EDGE: 0, LEFT_MODULAR: 1};

// One owner for state, menus, pod geometry and panel visibility. A mode is only
// published after every requested actor has been initialized and positioned.
export class DesktopLayoutManager {
  constructor({extension} = {}) {
    this.extension = extension;
    this._enabled = false;
    this._activeMode = null;
    this._signals = [];
    this._geometry = null;
    this._dockConstraints = new WeakMap();
    this.systemDock = this.quickSettingsPod = this.clockPod = null;
  }

  get mode() { return this._activeMode ?? LayoutMode.DUAL_EDGE; }

  enable() {
    if (this._enabled) return;
    try {
      this.state = new SystemState();
      this.menus = new SystemMenus({state: this.state});
      this._enabled = true;
      this._connect(Main.layoutManager, 'monitors-changed', () => this.updateLayout());
      this._connect(Main.layoutManager.panelBox, 'notify::visible', () => {
        if (!this._changingPanelVisibility) this._syncTopBar();
      });
      this._connect(Main.extensionManager, 'extension-state-changed', () => {
        this._watchPanelOwner();
        this._syncTopBar();
      });
      this._watchPanelOwner();
      this._applyMode(this.extension?.desktop_layout ?? LayoutMode.DUAL_EDGE);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  _connect(object, name, callback) {
    if (object?.connect) this._signals.push([object, object.connect(name, callback)]);
  }

  _actors() { return [this.systemDock, this.quickSettingsPod, this.clockPod].filter(Boolean); }

  _dispose(actors) {
    for (const actor of actors) {
      try { actor.destroy(); }
      catch (error) { console.error('dash2dock-lite: layout actor cleanup failed', error); }
    }
  }

  _computeGeometry(quickSettingsPod = this.quickSettingsPod, clockPod = this.clockPod) {
    const ext = this.extension;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) throw new Error('Left Modular requires an active primary monitor');
    return computeLeftModularGeometry({
      monitor,
      frameThickness: ext.enable_screen_frame ? ext.screen_frame_thickness : 0,
      frameRadius: ext.enable_screen_frame ? ext.screen_frame_corner_radius : 0,
      upperPodOffset: ext.modular_upper_pod_offset,
      lowerPodOffset: ext.modular_lower_pod_offset,
      minSpacing: ext.modular_min_spacing,
      flareWidth: ext.flare_width,
      footDepth: ext.foot_depth,
      cornerRadius: ext.attached_corner_radius,
      quickSettingsWidth: ext.modular_quicksettings_width,
      clockWidth: ext.modular_clock_width,
      quickSettingsContentWidth: quickSettingsPod?.getMeasuredContentWidth?.() ?? 0,
      clockContentWidth: clockPod?.getMeasuredContentWidth?.() ?? 0,
      iconSpacing: ext.modular_indicator_spacing,
      quickSettingsContentHeight: quickSettingsPod?.getMeasuredContentHeight() ?? 0,
      clockContentHeight: clockPod?.getMeasuredContentHeight() ?? 0,
      showQuickSettings: !!quickSettingsPod,
      showClock: !!clockPod,
      showAppDock: ext.modular_show_appdock !== false,
      minimumAppDockHeight: 2 * (ext.flare_width ?? 14) + Math.max(24, ...(ext.docks ?? []).map(dock => dock._preferredIconSize?.() ?? 48)) *
        (1 + 1.8 * Math.max(0, ext.animation_magnify ?? 0)),
    });
  }

  _applyMode(mode) {
    if (this._transitioning) return;
    this._transitioning = true;
    const pending = [];
    const oldActors = this._actors();
    try {
      this.menus.closeAll();
      let systemDock = null, quickSettingsPod = null, clockPod = null;
      if (mode === LayoutMode.LEFT_MODULAR) {
        const params = {extension: this.extension, systemMenus: this.menus,
          systemState: this.state, onLayoutChanged: () => this.updateLayout()};
        if (this.extension.modular_show_quicksettings !== false) {
          quickSettingsPod = new QuickSettingsPod(params);
          pending.push(quickSettingsPod);
          quickSettingsPod.enable();
        }
        if (this.extension.modular_show_clock !== false) {
          clockPod = new ClockPod(params);
          pending.push(clockPod);
          clockPod.enable();
        }
        const geometry = this._computeGeometry(quickSettingsPod, clockPod);
        if (!geometry.fits) throw new Error('Left Modular pods exceed the available monitor height');
        quickSettingsPod?.place(geometry.quickSettings);
        clockPod?.place(geometry.clock);
        this._geometry = geometry;
      } else if (this.extension.enable_system_dock !== false) {
        systemDock = new SystemDock({extension: this.extension, state: this.state, menus: this.menus});
        pending.push(systemDock);
        systemDock.enable();
      }
      // Commit the transition only once all requested components are usable.
      this.systemDock = systemDock;
      this.quickSettingsPod = quickSettingsPod;
      this.clockPod = clockPod;
      this._activeMode = mode;
      this._layoutHealthy = true;
      if (mode !== LayoutMode.LEFT_MODULAR) this._geometry = null;
      this.menus.systemDock = systemDock;
      this.extension.systemDock = systemDock;
      this._dispose(oldActors);
      this.extension._updateStyle?.();
      this.updateLayout();
      this._syncTopBar();
    } catch (error) {
      this._dispose(pending);
      console.error(`dash2dock-lite: layout ${mode} initialization failed; retaining previous layout`, error);
      if (this._activeMode === null) throw error;
      if (this.extension.desktop_layout !== this._activeMode) {
        this._syncingSetting = true;
        try {
          this.extension.desktop_layout = this._activeMode;
          this.extension._settings?.set_int('desktop-layout', this._activeMode);
        } finally {
          this._syncingSetting = false;
        }
      }
    } finally {
      this._transitioning = false;
    }
  }

  get applicationDock() {
    const docks = this.extension.docks ?? [];
    return docks.find(dock => dock._monitorIndex === Main.layoutManager.primaryIndex) ?? docks[0] ?? null;
  }

  getModularConstraints(monitor) {
    if (this.mode !== LayoutMode.LEFT_MODULAR) return null;
    if (monitor.index !== undefined && monitor.index !== Main.layoutManager.primaryIndex) return null;
    if (monitor.x !== Main.layoutManager.primaryMonitor?.x || monitor.y !== Main.layoutManager.primaryMonitor?.y) return null;
    return this._geometry?.appDock ?? null;
  }

  updateApplicationDockConstraints() {
    const key = JSON.stringify([this.mode, this._geometry?.appDock,
      Main.layoutManager.monitors?.map(m => [m.x, m.y, m.width, m.height, m.geometry_scale, m.inFullscreen]),
      this.extension.modular_show_appdock]);
    for (const dock of this.extension.docks ?? []) {
      if (this.mode === LayoutMode.LEFT_MODULAR && this._dockConstraints.get(dock) === key && !dock._layoutDirty) continue;
      const before = [dock.x, dock.y, dock.width, dock.height];
      dock.layout();
      this._dockConstraints.set(dock, key);
      if ([dock.x, dock.y, dock.width, dock.height].some((value, i) => value !== before[i])) {
        dock._beginAnimation?.();
        dock._debounceEndAnimation?.();
      }
    }
  }

  updateLayout() {
    if (!this._enabled || this._transitioning || this._updating) return;
    this._updating = true;
    try {
      if (this.mode === LayoutMode.LEFT_MODULAR) {
        this.quickSettingsPod?._refreshContent?.();
        this.clockPod?._refreshContent?.();
        const geometry = this._computeGeometry();
        if (!geometry.fits) throw new Error('Left Modular pods exceed the available monitor height');
        this.quickSettingsPod?.place(geometry.quickSettings);
        this.clockPod?.place(geometry.clock);
        this._geometry = geometry;
      } else {
        this._geometry = null;
        this.systemDock?.updateLayout();
      }
      this._layoutHealthy = true;
      this.updateApplicationDockConstraints();
      this._syncTopBar();
    } catch (error) {
      this._layoutHealthy = false;
      this._manageTopBar(false);
      console.error('dash2dock-lite: desktop layout update failed; panel restored', error);
      if (this.mode === LayoutMode.LEFT_MODULAR) {
        this._applyMode(LayoutMode.DUAL_EDGE);
        this.extension.desktop_layout = this.mode;
        this.extension._settings?.set_int('desktop-layout', this.mode);
      }
    } finally {
      this._updating = false;
    }
  }

  updateTheme() { for (const actor of this._actors()) actor.updateTheme(); }

  onSettingsChanged(name, value) {
    if (this._syncingSetting) return;
    if (name === 'desktop-layout' && value === this._activeMode) return;
    if (name === 'desktop-layout' || name === 'modular-show-quicksettings' ||
        name === 'modular-show-clock' || name === 'enable-system-dock') {
      this._applyMode(name === 'desktop-layout' ? value : this.mode);
    } else if (name === 'system-dock-hide-topbar') {
      this._syncTopBar();
    } else {
      this.systemDock?.onSettingsChanged(name, value);
      this.updateLayout();
      this.updateTheme();
    }
  }

  _syncTopBar() {
    const alternativesReady = this.mode === LayoutMode.LEFT_MODULAR
      ? !!this.quickSettingsPod && this.quickSettingsPod.hasUsableControls !== false && !!this.clockPod && this._geometry?.fits
      : !!this.systemDock && (!this.systemDock._geom ||
        this.systemDock._geom.height <= (Main.layoutManager.primaryMonitor?.height ?? 0));
    const nativeMenusReady = this.menus?.available !== false;
    this._manageTopBar(this._enabled && this._layoutHealthy !== false && this.extension.system_dock_hide_topbar && alternativesReady && nativeMenusReady);
  }

  _watchPanelOwner() {
    if (this._jpSettings) {
      this._jpSettings.disconnect(this._jpSignal);
      this._jpSettings = null;
    }
    const jp = Main.extensionManager?.lookup?.('just-perfection-desktop@custom');
    if (jp?.state !== 1) return;
    try {
      this._jpSettings = jp.stateObj?.getSettings();
      this._jpSignal = this._jpSettings?.connect('changed::panel', () => {
        this._syncTopBar();
      });
    } catch (error) {
      console.error('dash2dock-lite: unable to watch Just Perfection panel ownership', error);
    }
  }

  _otherExtensionHidesPanel() {
    const jp = Main.extensionManager?.lookup?.('just-perfection-desktop@custom');
    if (jp?.state !== 1) return false;
    try { return jp.stateObj?.getSettings().get_boolean('panel') === false; }
    catch (error) {
      console.error('dash2dock-lite: unable to read Just Perfection panel ownership', error);
      return true;
    }
  }

  _manageTopBar(hide) {
    const layout = Main.layoutManager;
    const panel = layout?.panelBox;
    if (!panel) return;
    this._changingPanelVisibility = true;
    try {
      if (hide) {
        if (this._otherExtensionHidesPanel()) {
          // Just Perfection moves the panel to overviewGroup and owns its
          // restoration from that point on.
          this._panelSnapshot = null;
          return;
        }
        const tracked = layout._trackedActors?.find(entry => entry.actor === panel);
        if (!this._panelSnapshot) {
          this._panelSnapshot = {visible: panel.visible || (!!tracked?.trackFullscreen &&
            !!layout.primaryMonitor?.inFullscreen && Main.overview?.visible !== true), chrome: tracked ? {
            affectsStruts: tracked.affectsStruts,
            trackFullscreen: tracked.trackFullscreen,
          } : null};
        }
        // GNOME 51 builds work-area struts even for hidden chrome actors.
        // Untracking also stops fullscreen/Overview from showing it again.
        // Keep the native hierarchy alive for Quick Settings and calendar menus.
        if (tracked) layout.untrackChrome(panel);
        if (panel.visible) panel.hide();
      } else if (this._panelSnapshot) {
        const snapshot = this._panelSnapshot;
        this._panelSnapshot = null;
        if (this._otherExtensionHidesPanel()) return;
        if (snapshot.chrome && panel.get_parent() === layout.uiGroup &&
            !layout._trackedActors?.some(entry => entry.actor === panel))
          layout.trackChrome(panel, snapshot.chrome);
        const monitor = layout.primaryMonitor;
        const fullscreen = monitor?.inFullscreen && Main.overview?.visible !== true;
        panel.visible = snapshot.visible && !fullscreen;
      }
    } finally {
      this._changingPanelVisibility = false;
    }
  }

  destroy() {
    this._enabled = false;
    this._manageTopBar(false);
    this.menus?.closeAll();
    for (const [object, id] of this._signals) object.disconnect(id);
    this._signals = [];
    if (this._jpSettings) this._jpSettings.disconnect(this._jpSignal);
    this._jpSettings = null;
    this._dispose(this._actors());
    this.systemDock = this.quickSettingsPod = this.clockPod = null;
    this._geometry = null;
    this._dockConstraints = new WeakMap();
    this.menus?.destroy();
    this.state?.destroy();
    this.menus = this.state = null;
  }
}
