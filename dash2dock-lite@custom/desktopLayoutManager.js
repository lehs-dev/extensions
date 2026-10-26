'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSettingsPod, InputMethodPod, ClockPod} from './systemDock/modularPods.js';
import {SystemState} from './systemDock/systemState.js';
import {SystemMenus} from './systemDock/systemMenus.js';
import {computeUnifiedDockGeometry} from './systemDock/systemDockLayout.js';
import {unifiedAppearance, unifiedEdge} from './unifiedDock.js';

export const LayoutMode = {UNIFIED: 1};

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
    this.systemDock = this.quickSettingsPod = this.inputMethodPod = this.clockPod = null;
  }

  get mode() { return LayoutMode.UNIFIED; }
  get edge() { return unifiedEdge(this.extension); }
  get monitor() {
    const index = (this.extension.preferred_monitor ?? 0) - 1;
    return Main.layoutManager.monitors?.[index] ?? Main.layoutManager.primaryMonitor;
  }

  enable() {
    if (this._enabled) return;
    try {
      this.state = new SystemState();
      this.menus = new SystemMenus({state: this.state});
      this.menus.beforeOpen = () => this.applicationDock?.closeMenus?.();
      this._enabled = true;
      this._connect(Main.layoutManager, 'monitors-changed', () => this.updateLayout());
      this._connect(typeof global !== 'undefined' ? global.display : null,
        'in-fullscreen-changed', () => this.updateLayout());
      for (const signal of ['shown', 'hidden'])
        this._connect(Main.overview, signal, () => this.updateLayout());
      this._connect(Main.layoutManager.panelBox, 'notify::visible', () => {
        if (!this._changingPanelVisibility) this._syncTopBar();
      });
      this._connect(Main.extensionManager, 'extension-state-changed', () => {
        this._watchPanelOwner();
        this._syncTopBar();
      });
      this._watchPanelOwner();
      this._applyMode();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  _connect(object, name, callback) {
    if (object?.connect) this._signals.push([object, object.connect(name, callback)]);
  }

  _actors() { return [this.systemDock, this.quickSettingsPod, this.inputMethodPod, this.clockPod].filter(Boolean); }

  _dispose(actors) {
    for (const actor of actors) {
      try { actor.destroy(); }
      catch (error) { console.error('dash2dock-lite: layout actor cleanup failed', error); }
    }
  }

  _computeGeometry(quickSettingsPod = this.quickSettingsPod, clockPod = this.clockPod,
    inputMethodPod = this.inputMethodPod) {
    const ext = this.extension;
    const monitor = this.monitor;
    if (!monitor) throw new Error('Unified Dock requires an active monitor');
    for (const pod of [quickSettingsPod, inputMethodPod, clockPod]) pod?.setEdge?.(this.edge);
    const appearance = unifiedAppearance(ext);
    return computeUnifiedDockGeometry({
      monitor, ...appearance, edge: this.edge,
      quickSettingsContentWidth: quickSettingsPod?.getMeasuredContentWidth?.() ?? 0,
      clockContentWidth: clockPod?.getMeasuredContentWidth?.() ?? 0,
      inputMethodContentWidth: inputMethodPod?.getMeasuredContentWidth?.() ?? 0,
      inputMethodContentHeight: inputMethodPod?.getMeasuredContentHeight() ?? 0,
      quickSettingsContentHeight: quickSettingsPod?.getMeasuredContentHeight() ?? 0,
      clockContentHeight: clockPod?.getMeasuredContentHeight() ?? 0,
      appDockContentHeight: this.applicationDock?.getUnifiedContentHeight?.() ?? appearance.appIconSize,
      magnify: ext.animation_magnify ?? 0, spread: ext.animation_spread ?? 0.5,
      showQuickSettings: !!quickSettingsPod,
      showClock: !!clockPod,
      showInputMethod: !!inputMethodPod && inputMethodPod.hasUsableControls,
      showAppDock: ext.modular_show_appdock !== false,
    });
  }

  _applyMode() {
    if (this._transitioning) return;
    this._transitioning = true;
    const pending = [];
    const oldActors = this._actors();
    try {
      this.menus.closeAll();
      const params = {extension: this.extension, systemMenus: this.menus,
        systemState: this.state, onLayoutChanged: () => this.updateLayout()};
      const create = Pod => {
        const pod = new Pod(params);
        pending.push(pod);
        pod.enable();
        return pod;
      };
      const quickSettingsPod = this.extension.modular_show_quicksettings !== false ? create(QuickSettingsPod) : null;
      const inputMethodPod = create(InputMethodPod);
      const clockPod = this.extension.modular_show_clock !== false ? create(ClockPod) : null;
      const geometry = this._computeGeometry(quickSettingsPod, clockPod, inputMethodPod);
      quickSettingsPod?.place(geometry.quickSettings);
      inputMethodPod.place(geometry.inputMethod);
      clockPod?.place(geometry.clock);
      this.quickSettingsPod = quickSettingsPod;
      this.inputMethodPod = inputMethodPod;
      this.clockPod = clockPod;
      this._geometry = geometry;
      this._activeMode = LayoutMode.UNIFIED;
      this._layoutHealthy = geometry.fits;
      this.menus.systemDock = null;
      this.extension.systemDock = null;
      this._dispose(oldActors);
      this.extension._updateStyle?.();
    } catch (error) {
      this._dispose(pending);
      console.error('dash2dock-lite: Unified Dock initialization failed; retaining existing controls', error);
      if (this._activeMode === null) throw error;
    } finally {
      this._transitioning = false;
    }
    this.updateLayout();
  }

  get applicationDock() {
    const docks = this.extension.docks ?? [];
    return docks.find(dock => dock._monitorIndex === (this.monitor?.index ?? Main.layoutManager.primaryIndex)) ?? docks[0] ?? null;
  }

  getModularConstraints(monitor) {
    const target = this.monitor;
    if (!target || monitor.x !== target.x || monitor.y !== target.y) return null;
    return this._geometry?.appDock ?? null;
  }

  updateApplicationDockConstraints() {
    const key = JSON.stringify([this.mode, this._geometry?.appDock,
      Main.layoutManager.monitors?.map(m => [m.x, m.y, m.width, m.height, m.geometry_scale, m.inFullscreen]),
      this.extension.modular_show_appdock]);
    for (const dock of this.extension.docks ?? []) {
      if (this._dockConstraints.get(dock) === key && !dock._layoutDirty) continue;
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
      this.quickSettingsPod?._refreshContent?.();
      this.inputMethodPod?._refreshContent?.();
      this.clockPod?._refreshContent?.();
      const geometry = this._computeGeometry();
      this.quickSettingsPod?.place(geometry.quickSettings);
      this.inputMethodPod?.place(geometry.inputMethod);
      this.clockPod?.place(geometry.clock);
      this._geometry = geometry;
      this._layoutHealthy = geometry.fits;
      this.updateApplicationDockConstraints();
      this._syncTopBar();
    } catch (error) {
      this._layoutHealthy = false;
      this._manageTopBar(false);
      console.error('dash2dock-lite: desktop layout update failed; panel restored', error);
      for (const actor of this._actors()) actor.hide?.();
      this._geometry = null;
    } finally {
      this._updating = false;
    }
  }

  updateTheme() { for (const actor of this._actors()) actor.updateTheme(); }

  onSettingsChanged(name, value) {
    if (name === 'desktop-layout' || name === 'enable-system-dock') return;
    if (name === 'modular-show-quicksettings' || name === 'modular-show-clock') {
      this._applyMode();
    } else {
      if (name === 'unified-edge' || name === 'preferred-monitor' || name === 'global-scale') {
        this.menus.closeAll();
        this.applicationDock?.closeMenus?.();
      }
      // Color/scale changes reach content before measuring the new geometry.
      this.updateTheme();
      this.updateLayout();
    }
  }

  _syncTopBar() {
    const alternativesReady = !!this.quickSettingsPod && this.quickSettingsPod.hasUsableControls !== false &&
      !!this.clockPod && this._geometry?.fits;
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
    this.systemDock = this.quickSettingsPod = this.inputMethodPod = this.clockPod = null;
    this._geometry = null;
    this._dockConstraints = new WeakMap();
    this.menus?.destroy();
    this.state?.destroy();
    this.menus = this.state = null;
    this._activeMode = null;
  }
}
