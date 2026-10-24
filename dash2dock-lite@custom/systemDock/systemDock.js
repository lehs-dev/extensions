'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { AttachedDockCanvas } from '../attachedBackground.js';
import { SystemState } from './systemState.js';
import { SystemMenus } from './systemMenus.js';
import {
  computeSystemDockGeometry,
  isWithinSystemDockHoverArea,
} from './systemDockLayout.js';
import {
  ClockItem,
  SystemDockSeparator,
  NetworkItem,
  BluetoothItem,
  AudioItem,
  BatteryItem,
  NotificationItem,
  PowerItem,
} from './systemDockItems.js';

const WidgetBase = St?.Widget || class {};
const getGlobal = () => (typeof global !== 'undefined' ? global : null);
const isFullscreenObscured = monitor => !!monitor?.inFullscreen &&
  (getGlobal()?.window_group?.visible ?? !Main.overview?.visible);

export const SystemDock = GObject.registerClass(
  {},
  class SystemDock extends WidgetBase {
    _init(params = {}) {
      this._initialized = true;
      this.extension = params.extension;

      if (typeof super._init === 'function') {
        super._init({
          name: 'SystemDock',
          style_class: 'system-dock-container',
          reactive: true,
          track_hover: true,
        });
      } else {
        this.name = 'SystemDock';
        this.style_class = 'system-dock-container';
        this.reactive = true;
        this.track_hover = true;
      }

      this._signals = [];
      this._items = new Map();
      this._geom = null;
      this._onChrome = false;
      this._originalTopBarState = null;
      this._topBarManagedByOther = false;
      this._enabled = false;
      this._isHidden = false;
      this.translation_x = 0;

      try {
        // Instantiate state provider and menu manager
        this.state = params.state || new SystemState();
        this.menus = params.menus || new SystemMenus({ systemDock: this, state: this.state });
        this._ownsStateAndMenus = !params.state;
        this._managedLayout = !!params.state;

        // The renderer is required: a failed capsule must not report success.
        this._canvas = new AttachedDockCanvas();
        this.add_child(this._canvas);

        // Items container
        this._contentBox = new St.BoxLayout({
          style_class: 'system-dock-box',
          orientation: Clutter.Orientation.VERTICAL,
        });
        if (this._contentBox.layout_manager) {
          this._contentBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        }
        this._contentBox.visible = true;
        this._contentBox.opacity = 255;
        this.add_child(this._contentBox);

        this._createItems();
        this._setupEvents();

        // State listener: dynamically update layout when indicator availability changes
        this._stateListener = (event) => {
          if (
            event === 'bluetooth-changed' ||
            event === 'battery-changed' ||
            event === 'notifications-changed'
          ) {
            this._updateItemsVisibility();
            this.updateLayout();
          }
        };
        if (this.state) {
          this.state.addListener(this._stateListener);
        }
      } catch (error) {
        this.destroy();
        throw error;
      }
    }

    _createItems() {
      const iconSize = this.extension?.system_dock_icon_size ?? 18;

      // 1. Clock (Upright stacked digits)
      const clock = new ClockItem({
        systemMenus: this.menus,
        systemState: this.state,
      });
      this._items.set('clock', clock);
      this._contentBox.add_child(clock);

      // Separator after clock
      const sepTop = new SystemDockSeparator();
      this._items.set('separator-top', sepTop);
      this._contentBox.add_child(sepTop);

      // 2. Network
      const network = new NetworkItem({
        systemMenus: this.menus,
        systemState: this.state,
        iconSize,
      });
      this._items.set('network', network);
      this._contentBox.add_child(network);

      // 3. Bluetooth
      const bluetooth = new BluetoothItem({
        systemMenus: this.menus,
        systemState: this.state,
        iconSize,
      });
      this._items.set('bluetooth', bluetooth);
      this._contentBox.add_child(bluetooth);

      // 4. Audio
      const audio = new AudioItem({
        systemMenus: this.menus,
        systemState: this.state,
        iconSize,
      });
      this._items.set('audio', audio);
      this._contentBox.add_child(audio);

      // 5. Battery
      const battery = new BatteryItem({
        systemMenus: this.menus,
        systemState: this.state,
        iconSize,
      });
      this._items.set('battery', battery);
      this._contentBox.add_child(battery);

      // 6. Notifications
      const notifications = new NotificationItem({
        systemMenus: this.menus,
        systemState: this.state,
        iconSize,
      });
      this._items.set('notifications', notifications);
      this._contentBox.add_child(notifications);

      // Separator before power
      const sepBottom = new SystemDockSeparator();
      this._items.set('separator-bottom', sepBottom);
      this._contentBox.add_child(sepBottom);

      // 7. Power
      const power = new PowerItem({
        systemMenus: this.menus,
        iconSize,
      });
      this._items.set('power', power);
      this._contentBox.add_child(power);

      this._updateItemsVisibility();
    }

    _updateItemsVisibility() {
      const getPref = (key, def = true) => {
        if (this.extension && this.extension[key] !== undefined) {
          return !!this.extension[key];
        }
        return def;
      };

      const clock = this._items.get('clock');
      if (clock) clock.visible = getPref('system_dock_show_clock', true);

      const net = this._items.get('network');
      if (net) net.visible = getPref('system_dock_show_network', true);

      const bt = this._items.get('bluetooth');
      if (bt) {
        bt.visible =
          getPref('system_dock_show_bluetooth', true) &&
          (this.state?.bluetooth?.available ?? false);
      }

      const aud = this._items.get('audio');
      if (aud) aud.visible = getPref('system_dock_show_volume', true);

      const bat = this._items.get('battery');
      if (bat) {
        bat.visible =
          getPref('system_dock_show_battery', true) &&
          (this.state?.battery?.present ?? false);
      }

      const notif = this._items.get('notifications');
      if (notif) notif.visible = getPref('system_dock_show_notifications', true);

      const pwr = this._items.get('power');
      if (pwr) pwr.visible = getPref('system_dock_show_power', true);

      const middleItemsVisible =
        (net?.visible ?? false) ||
        (bt?.visible ?? false) ||
        (aud?.visible ?? false) ||
        (bat?.visible ?? false) ||
        (notif?.visible ?? false);

      const sepTop = this._items.get('separator-top');
      if (sepTop) {
        sepTop.visible = (clock?.visible ?? false) && middleItemsVisible;
      }

      const sepBottom = this._items.get('separator-bottom');
      if (sepBottom) {
        sepBottom.visible = (pwr?.visible ?? false) && (middleItemsVisible || (clock?.visible ?? false));
      }
    }

    _setupEvents() {
      this.connect('motion-event', (actor, event) => {
        let coords = [0, 0];
        if (typeof event?.get_coords === 'function') {
          coords = event.get_coords();
        } else if (typeof getGlobal()?.get_pointer === 'function') {
          coords = getGlobal().get_pointer();
        }

        if (this.extension?.system_dock_behavior === 1) {
          this._setHidden(false, true);
        }

        if (!this.isWithinHoverArea(coords)) {
          return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
      });

      this.connect('leave-event', () => {
        if (this.extension?.system_dock_behavior === 1) {
          this._checkOverlap();
        }
        return Clutter.EVENT_PROPAGATE;
      });

      this.connect('button-press-event', (actor, event) => {
        let coords = [0, 0];
        if (typeof event?.get_coords === 'function') {
          coords = event.get_coords();
        } else if (typeof getGlobal()?.get_pointer === 'function') {
          coords = getGlobal().get_pointer();
        }

        if (!this.isWithinHoverArea(coords)) {
          return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }

    isWithinHoverArea(point) {
      if (!this._geom) return true;
      return isWithinSystemDockHoverArea(
        point,
        { x: this.x, y: this.y, width: this.width, height: this.height },
        this._geom.flareWidth,
        this._geom.footDepth
      );
    }

    getMonitor() {
      return (
        Main.layoutManager?.primaryMonitor || {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          geometry_scale: 1.0,
          inFullscreen: false,
          index: 0,
        }
      );
    }

    enable() {
      if (this._enabled) return;
      this._enabled = true;

      this.visible = !isFullscreenObscured(this.getMonitor());
      this.opacity = 255;
      if (this.visible && typeof this.show === 'function') {
        this.show();
      }
      if (this._contentBox) {
        this._contentBox.visible = true;
        this._contentBox.opacity = 255;
        if (typeof this._contentBox.show === 'function') {
          this._contentBox.show();
        }
      }
      if (this._canvas) {
        this._canvas.visible = true;
        this._canvas.opacity = 255;
        if (typeof this._canvas.show === 'function') {
          this._canvas.show();
        }
      }

      // Add to Chrome on primary monitor
      if (Main.layoutManager?.addChrome && !this._onChrome) {
        Main.layoutManager.addChrome(this, {
          affectsStruts: false,
          trackFullscreen: true,
        });
        this._onChrome = true;
      }

      // Connect monitor changes
      if (Main.layoutManager?.connect) {
        const id = Main.layoutManager.connect('monitors-changed', () => {
          this.updateLayout();
        });
        this._signals.push({ obj: Main.layoutManager, id });
      }

      // Connect overview / fullscreen visibility and workspace window overlap
      const g = getGlobal();
      if (g?.window_manager?.connect) {
        const id = g.window_manager.connect('switch-workspace', () => {
          this._checkFullscreen();
          this._checkOverlap();
        });
        this._signals.push({ obj: g.window_manager, id });
      }

      if (g?.display?.connect) {
        const id = g.display.connect('restacked', () => {
          this._checkOverlap();
        });
        this._signals.push({ obj: g.display, id });
      }

      this.updateLayout();
      this.updateTheme();

      // Manage GNOME Top Bar hiding if enabled
      if (this.extension?.system_dock_hide_topbar) {
        this._manageTopBar(true);
      }
    }

    _checkFullscreen() {
      const monitor = this.getMonitor();
      if (isFullscreenObscured(monitor)) {
        this.visible = false;
      } else {
        this.visible = true;
        this.opacity = 255;
      }
    }

    _setHidden(hidden, animate = true) {
      if (this._isHidden === hidden) return;
      this._isHidden = hidden;

      const targetX = hidden ? (this.width - 2) : 0;
      this.translation_x = targetX;

      if (animate && typeof this.ease === 'function') {
        this.ease({
          translation_x: targetX,
          duration: 250,
          mode: Clutter.AnimationMode?.EASE_OUT_QUAD ?? 2,
        });
      }
    }

    _checkOverlap() {
      const behavior = this.extension?.system_dock_behavior ?? 0;
      if (behavior !== 1) {
        this._setHidden(false, false);
        return;
      }

      // Keep dock revealed while any popup menu is open
      if (this.menus?.isAnyMenuOpen) {
        this._setHidden(false, true);
        return;
      }

      // If pointer is near the right edge or hovering the dock, stay revealed
      const g = getGlobal();
      let pointer = [0, 0];
      if (typeof g?.get_pointer === 'function') {
        pointer = g.get_pointer();
      }
      const monitor = this.getMonitor();
      const nearEdge = pointer[0] >= (monitor.x + monitor.width - 6);
      if (nearEdge || this.hover || this.isWithinHoverArea(pointer)) {
        this._setHidden(false, true);
        return;
      }

      // Check for overlapping windows on the current active workspace
      let hasOverlap = false;
      try {
        if (g?.get_window_actors && g?.workspace_manager) {
          const activeWs = g.workspace_manager.get_active_workspace();
          const actors = g.get_window_actors();
          const dockBounds = {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
          };

          const monIndex = monitor.index ?? 0;
          for (const actor of actors) {
            const metaWin = typeof actor.get_meta_window === 'function' ? actor.get_meta_window() : null;
            if (!metaWin) continue;
            if (typeof metaWin.can_close === 'function' && !metaWin.can_close()) continue;
            if (typeof metaWin.get_monitor === 'function') {
              const winMon = metaWin.get_monitor();
              if (winMon !== undefined && winMon !== null && winMon !== monIndex) continue;
            }
            if (typeof metaWin.get_workspace === 'function' && metaWin.get_workspace() !== activeWs) continue;
            if (typeof metaWin.is_hidden === 'function' && metaWin.is_hidden()) continue;
            if (typeof metaWin.showing_on_its_workspace === 'function' && !metaWin.showing_on_its_workspace()) continue;

            let frame = null;
            if (typeof metaWin.get_frame_rect === 'function') {
              frame = metaWin.get_frame_rect();
            } else if (typeof actor.get_transformed_position === 'function' && typeof actor.get_transformed_size === 'function') {
              const [wx, wy] = actor.get_transformed_position();
              const [ww, wh] = actor.get_transformed_size();
              frame = { x: wx, y: wy, width: ww, height: wh };
            }

            if (frame) {
              const overlap = !(
                frame.x >= dockBounds.x + dockBounds.width ||
                frame.x + frame.width <= dockBounds.x ||
                frame.y >= dockBounds.y + dockBounds.height ||
                frame.y + frame.height <= dockBounds.y
              );
              if (overlap) {
                hasOverlap = true;
                break;
              }
            }
          }
        }
      } catch (e) {}

      this._setHidden(hasOverlap, true);
    }

    onMenuStateChanged(open) {
      if (open) {
        this._setHidden(false, true);
      } else {
        this._checkOverlap();
      }
    }

    _manageTopBar(hide) {
      // DesktopLayoutManager is the only panel owner for coordinated layouts.
      if (this._managedLayout) return;
      const panelBox = Main.layoutManager?.panelBox;
      if (!panelBox) return;

      if (hide) {
        // Safety check - ensure System Dock is valid, allocated, and attached
        const isValid =
          this._enabled &&
          this._onChrome &&
          this._contentBox &&
          this._items &&
          this._items.size > 0 &&
          this.width > 0 &&
          this.height > 0;

        if (!isValid) {
          console.warn(
            '[D2DL-PAINT-DEBUG] System Dock is not fully allocated or attached to stage; skipping Top Bar hide to preserve user access to system controls.'
          );
          return;
        }

        // Coordinate with Just Perfection
        let jpPanelDisabled = false;
        try {
          const jpSettings = new Gio.Settings({
            schema_id: 'org.gnome.shell.extensions.just-perfection',
          });
          if (!jpSettings.get_boolean('panel')) {
            jpPanelDisabled = true;
          }
        } catch (e) {
          // Just Perfection not present or schema absent
        }

        if (jpPanelDisabled) {
          this._topBarManagedByOther = true;
          return;
        }

        if (!this._originalTopBarState) {
          this._originalTopBarState = {
            visible: panelBox.visible,
            translation_y: panelBox.translation_y,
            inChrome: panelBox.get_parent() === Main.layoutManager.uiGroup,
          };
        }

        if (panelBox.get_parent() === Main.layoutManager.uiGroup) {
          Main.layoutManager.removeChrome(panelBox);
        }
        panelBox.hide();
        panelBox.translation_y = -panelBox.height;
      } else {
        if (this._topBarManagedByOther) {
          this._topBarManagedByOther = false;
          return;
        }

        if (this._originalTopBarState) {
          panelBox.translation_y = 0;
          if (this._originalTopBarState.inChrome) {
            Main.layoutManager.addChrome(panelBox, {
              affectsStruts: true,
              trackFullscreen: true,
            });
          }
          if (this._originalTopBarState.visible) {
            panelBox.show();
          }
          this._originalTopBarState = null;
        }
      }
    }

    updateLayout() {
      this._updateItemsVisibility();

      const monitor = this.getMonitor();
      const scaleFactor = monitor.geometry_scale || 1.0;

      const rawDockWidth = this.extension?.system_dock_width;
      const dockWidth = (typeof rawDockWidth === 'number' && rawDockWidth > 0) ? rawDockWidth : 48;
      const rawFlareWidth = this.extension?.system_dock_flare_width;
      const flareWidth = (typeof rawFlareWidth === 'number' && rawFlareWidth > 0) ? rawFlareWidth : 14;
      const rawFootDepth = this.extension?.system_dock_foot_depth;
      const footDepth = (typeof rawFootDepth === 'number' && rawFootDepth > 0) ? rawFootDepth : 4;
      const rawCornerRadius = this.extension?.system_dock_corner_radius;
      const cornerRadius = (typeof rawCornerRadius === 'number' && rawCornerRadius > 0) ? rawCornerRadius : 10;
      const rawIconSize = this.extension?.system_dock_icon_size;
      const iconSize = (typeof rawIconSize === 'number' && rawIconSize > 0) ? rawIconSize : 18;
      const rawIconSpacing = this.extension?.system_dock_icon_spacing;
      const iconSpacing = (typeof rawIconSpacing === 'number' && rawIconSpacing >= 0) ? rawIconSpacing : 6;

      const clock = this._items.get('clock');
      const showClock = !!clock?.visible;

      let nonClockItemsCount = 0;
      let separatorsCount = 0;
      for (const [key, item] of this._items) {
        if (!item.visible) continue;
        if (key.startsWith('separator')) {
          separatorsCount++;
        } else if (key !== 'clock') {
          nonClockItemsCount++;
          if (typeof item.setIconSize === 'function') {
            item.setIconSize(Math.round(iconSize * scaleFactor));
          }
        }
      }

      // Measure content container accurately
      let measuredContentHeight = 0;
      if (this._contentBox) {
        if (typeof this._contentBox.get_preferred_height === 'function') {
          try {
            const [, nat] = this._contentBox.get_preferred_height(-1);
            if (nat > 0) measuredContentHeight = Math.ceil(nat);
          } catch (e) {}
        }

        let childSum = 0;
        let visibleCount = 0;
        const children = typeof this._contentBox.get_children === 'function'
          ? this._contentBox.get_children()
          : Array.from(this._items.values());

        for (const child of children) {
          if (!child || !child.visible) continue;
          visibleCount++;
          let ch = 0;
          if (typeof child.get_preferred_height === 'function') {
            try {
              const [, nat] = child.get_preferred_height(-1);
              if (nat > 0) ch = Math.ceil(nat);
            } catch (e) {}
          }
          if (ch <= 0) {
            if (child.style_class && child.style_class.includes('separator')) {
              ch = Math.round(7 * scaleFactor);
            } else if (child === clock) {
              ch = Math.round(36 * scaleFactor);
            } else {
              ch = Math.round((iconSize + 8) * scaleFactor);
            }
          }
          childSum += ch;
        }
        if (visibleCount > 1) {
          childSum += (visibleCount - 1) * Math.round(iconSpacing * scaleFactor);
        }

        measuredContentHeight = Math.max(measuredContentHeight, childSum);
      }

      const geom = computeSystemDockGeometry({
        monitor,
        dockWidth,
        flareWidth,
        footDepth,
        cornerRadius,
        iconSize,
        iconSpacing,
        clockHeight: 36,
        showClock,
        itemsCount: nonClockItemsCount,
        separatorsCount,
        measuredContentHeight,
        scaleFactor,
      });

      this._geom = geom;

      this.x = geom.x;
      this.y = geom.y;
      this.width = geom.width;
      this.height = geom.height;
      if (typeof this.set_position === 'function') {
        this.set_position(geom.x, geom.y);
      }
      if (typeof this.set_size === 'function') {
        this.set_size(geom.width, geom.height);
      }
      this.visible = !isFullscreenObscured(this.getMonitor());
      this.opacity = 255;
      if (this.visible && typeof this.show === 'function') {
        this.show();
      }

      // Update background canvas
      if (this._canvas) {
        this._canvas.visible = true;
        this._canvas.opacity = 255;
        if (typeof this._canvas.show === 'function') {
          this._canvas.show();
        }
        this._canvas.set_position(0, 0);
        this._canvas.set_size(geom.width, geom.height);
        this._canvas.set_state({
          width: geom.width,
          height: geom.height,
          flareWidth: geom.flareWidth,
          footDepth: geom.footDepth,
          cornerRadius: geom.cornerRadius,
          scaleFactor: 1,
          position: 'right',
          backgroundColor:
            this.extension?._dockColors?.['background-color'] || [
              0.08, 0.08, 0.09, 0.72,
            ],
          borderColor:
            this.extension?._dockColors?.['border-color'] || [1, 1, 1, 0.25],
          borderThickness: this.extension?.border_thickness || 0,
        });
      }

      // Update content box
      if (this._contentBox) {
        this._contentBox.visible = true;
        this._contentBox.opacity = 255;
        if (typeof this._contentBox.show === 'function') {
          this._contentBox.show();
        }
        this._contentBox.set_position ? this._contentBox.set_position(0, geom.contentTop) : (this._contentBox.x = 0, this._contentBox.y = geom.contentTop);
        this._contentBox.set_size ? this._contentBox.set_size(geom.width, geom.contentHeight) : (this._contentBox.width = geom.width, this._contentBox.height = geom.contentHeight);
        if (this._contentBox.set_style) {
          this._contentBox.set_style(
            `spacing: ${geom.iconSpacing}px; width: ${geom.width}px;`
          );
        }
      }

      this._checkFullscreen();
      this._checkOverlap();
    }

    updateTheme() {
      if (!this._geom || !this._canvas) return;

      this._canvas.set_state({
        width: this._geom.width,
        height: this._geom.height,
        flareWidth: this._geom.flareWidth,
        footDepth: this._geom.footDepth,
        cornerRadius: this._geom.cornerRadius,
        scaleFactor: 1,
        position: 'right',
        backgroundColor:
          this.extension?._dockColors?.['background-color'] || [
            0.08, 0.08, 0.09, 0.72,
          ],
        borderColor:
          this.extension?._dockColors?.['border-color'] || [1, 1, 1, 0.25],
        borderThickness: this.extension?.border_thickness || 0,
      });
    }

    onSettingsChanged(name, value) {
      if (name === 'system-dock-hide-topbar') {
        this._manageTopBar(value);
      } else if (name === 'system-dock-behavior') {
        this._checkOverlap();
      } else if (name.startsWith('system-dock-')) {
        this.updateLayout();
        this.updateTheme();
      }
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._enabled = false;

      // Restore Top Bar if hidden by us
      this._manageTopBar(false);

      // Close open menus
      if (this._ownsStateAndMenus) {
        if (this.menus) {
          this.menus.destroy();
          this.menus = null;
        }
        if (this.state) {
          if (this._stateListener) {
            this.state.removeListener(this._stateListener);
            this._stateListener = null;
          }
          this.state.destroy();
          this.state = null;
        }
      } else {
        if (this.menus) {
          this.menus.closeAll?.();
        }
        if (this.state && this._stateListener) {
          this.state.removeListener(this._stateListener);
          this._stateListener = null;
        }
      }

      // Disconnect signals
      for (const { obj, id } of this._signals) {
        try {
          if (obj && typeof obj.disconnect === 'function') {
            obj.disconnect(id);
          }
        } catch (e) {}
      }
      this._signals = [];

      // Remove from Chrome
      if (this._onChrome && Main.layoutManager?.removeChrome) {
        Main.layoutManager.removeChrome(this);
        this._onChrome = false;
      }

      // Destroy items
      for (const [_, item] of this._items) {
        try {
          item.destroy();
        } catch (e) {}
      }
      this._items.clear();

      if (this._canvas) {
        try {
          this._canvas.destroy();
        } catch (e) {}
        this._canvas = null;
      }

      if (this._contentBox) {
        try {
          this._contentBox.destroy();
        } catch (e) {}
        this._contentBox = null;
      }

      if (typeof super.destroy === 'function') {
        super.destroy();
      }
    }
  }
);
