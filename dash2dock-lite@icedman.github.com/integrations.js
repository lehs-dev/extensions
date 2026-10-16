import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Shell from 'gi://Shell';

// these are hacks to make Dash2Dock Animated compatible with other Extensions
//
export const Integrations = class {
  enable() {
    this.hookCompiz();
    this.hookBms();
  }

  disable() {
    this.releaseCompiz();
    this.releaseBms();
  }

  hookCompiz(hook = true) {
    const compiz = Main.extensionManager.lookup(
      'compiz-alike-magic-lamp-effect@hermes83.github.com'
    );
    const stateObj = compiz?.stateObj;
    if (!hook || this.extension.lamp_app_animation === false || this._compiz !== stateObj)
      this.releaseCompiz();
    if (!hook || !stateObj || this.extension.lamp_app_animation === false || this._compiz)
      return;

    this._compiz = stateObj;
    const original = this._originalCompizGetIcon = stateObj.getIcon;
    const hookState = this._compizHook = {
      resolve: this.compiz_getIcon.bind(this),
      original,
      owner: stateObj,
    };
    // Keep fallback in the wrapper: the original can itself query this
    // integration when Compiz is enabled after the dock.
    this._compizGetIcon = (actor) => hookState.resolve?.(actor) ||
      hookState.original.call(hookState.owner, actor);
    stateObj.getIcon = this._compizGetIcon;
  }

  releaseCompiz() {
    if (this._compiz && this._compiz.getIcon === this._compizGetIcon)
      this._compiz.getIcon = this._originalCompizGetIcon;
    // A later hook may still call our wrapper. Make it a passive fallback and
    // drop the bound integration so it cannot retain a disabled dock.
    if (this._compizHook)
      this._compizHook.resolve = null;
    this._compizHook = null;
    this._compiz = null;
    this._originalCompizGetIcon = null;
    this._compizGetIcon = null;
  }

  // Prefer an icon on the window's monitor, then on the primary dock.
  compiz_getIcon(actor) {
    if (this.extension?.lamp_app_animation === false)
      return null;
    const metaWindow = actor?.meta_window || actor?.get_meta_window?.() || actor;
    const windowMonitorIndex = typeof metaWindow?.get_monitor === 'function'
      ? metaWindow.get_monitor()
      : null;
    const windowMonitor = windowMonitorIndex !== null
      ? Main.layoutManager.monitors[windowMonitorIndex]
      : null;
    const docks = (this.extension?.docks || [])
      .map((dock) => ({ dock, monitor: dock.getMonitor?.() }))
      .filter(({ monitor }) => monitor &&
        [monitor.x, monitor.y, monitor.width, monitor.height].every(Number.isFinite) &&
        monitor.width > 0 && monitor.height > 0);
    const priority = ({ monitor }) =>
      monitor.index === windowMonitor?.index ? 0 :
      monitor.index === Main.layoutManager.primaryIndex ? 1 : 2;
    docks.sort((a, b) => priority(a) - priority(b));

    if (docks.length === 0)
      return null;

    const windowTracker = Shell?.WindowTracker?.get_default?.();
    const windowApp = windowTracker?.get_window_app?.(metaWindow);
    const appId = windowApp?.get_id?.();
    const pid = typeof metaWindow?.get_pid === 'function' ? metaWindow.get_pid() : null;
    for (const candidate of docks) {
      const elements = [...new Set([
        ...(candidate.dock._icons || []),
        ...(candidate.dock.dash?._box?.get_children?.() || []),
      ])];
      const matches = elements.filter((element) => {
        const app = element?.child?._delegate?.app || element?.child?.app ||
                    element?._appwell?.app || element?.app;
        if (app) {
          if (windowApp && app === windowApp) return true;
          if (appId && app.get_id?.() === appId) return true;
          if (pid && app.get_pids?.()?.includes(pid)) return true;
        }
        if (appId && (element?.appId === appId || element?._icon?.icon_name === appId))
          return true;
        return false;
      });
      for (const match of matches) {
        const geometry = this._compizIconGeometry(match, candidate.dock, candidate.monitor);
        if (geometry)
          return geometry;
      }
    }

    return null;
  }

  _compizIconGeometry(dashIcon, dock, monitor) {
    const iconActor = dashIcon._renderer || dashIcon;
    const rawPosition = iconActor.get_transformed_position?.();
    if (!rawPosition || !Number.isFinite(rawPosition[0]) || !Number.isFinite(rawPosition[1]))
      return null;

    const preferredSize = typeof dock._preferredIconSize === 'function'
      ? dock._preferredIconSize() * (monitor.geometry_scale || 1)
      : (dock._iconSizeScaledDown || dock._iconSize || 48) * (monitor.geometry_scale || 1);
    const iconSize = Number.isFinite(preferredSize) && preferredSize > 0 ? preferredSize : 48;

    const rawSize = iconActor?.get_transformed_size?.();
    const width = Math.min(monitor.width,
      Number.isFinite(rawSize?.[0]) && rawSize[0] > 0 ? rawSize[0] : iconSize);
    const height = Math.min(monitor.height,
      Number.isFinite(rawSize?.[1]) && rawSize[1] > 0 ? rawSize[1] : iconSize);

    let [x, y] = rawPosition;
    const right = monitor.x + monitor.width;
    const bottom = monitor.y + monitor.height;
    // Autohide moves the real icon beyond its dock edge. Keep its app-specific
    // coordinate along that edge; unrelated off-screen geometry is not a target.
    switch (dock._position) {
      case 'left':
        if (y + height <= monitor.y || y >= bottom || x >= right)
          return null;
        x = Math.max(monitor.x, x);
        break;
      case 'right':
        if (y + height <= monitor.y || y >= bottom || x + width <= monitor.x)
          return null;
        x = Math.min(right - width, x);
        break;
      case 'top':
        if (x + width <= monitor.x || x >= right || y >= bottom)
          return null;
        y = Math.max(monitor.y, y);
        break;
      case 'bottom':
      default:
        if (x + width <= monitor.x || x >= right || y + height <= monitor.y)
          return null;
        y = Math.min(bottom - height, y);
        break;
    }

    x = Math.max(monitor.x, Math.min(monitor.x + monitor.width - width, x));
    y = Math.max(monitor.y, Math.min(monitor.y + monitor.height - height, y));

    return {
      x,
      y,
      width,
      height,
      monitorIndex: monitor.index,
      dockPosition: dock._position || 'bottom',
    };
  }

  hookBms(hook = true) {
    if (!hook) {
      this.extension.docks.forEach((dock) => {
        dock.animator._bms = null;
      });
    }

    let bms = Main.extensionManager.lookup('blur-my-shell@aunetx');
    this._bms = bms;
    if (bms && bms.stateObj && bms.metadata.version >= 70) {
      let obj = bms.stateObj;
      if (obj._dash_to_dock_blur) {
        if (!obj._dash_to_dock_blur.update_size_orig) {
          obj._dash_to_dock_blur.update_size_orig =
            obj._dash_to_dock_blur.update_size;
        }
        if (hook && this.extension.blur_background) {
          obj._dash_to_dock_blur.update_size = () => {};
        } else if (obj._dash_to_dock_blur.update_size_orig) {
          obj._dash_to_dock_blur.update_size =
            obj._dash_to_dock_blur.update_size_orig;
        }
      }
    }
  }

  releaseBms() {
    this.hookBms(false);
    this._bms = null;
  }

  bms_update_size(animator) {
    let dock = animator.dock;

    // blur my shell
    let bms = dock.get_children().find((child) => {
      let name = child.get_name();
      return name === 'bms-dash-backgroundgroup';
    });

    animator._bms = bms;

    if (!bms) {
      return;
    }

    bms.visible = dock.extension.blur_background;
    if (!bms.visible) {
      return;
    }

    // compatible blur-my-shell version 70
    // bms version 70 supports 46,47..up
    if (
      dock.extension.integrations._bms &&
      dock.extension.integrations._bms.metadata.version >= 70
    ) {
      let bg_offset_x = dock._background.x;
      let bg_offset_y = dock._background.y;
      let rw = dock.renderArea.width;
      let rh = dock.renderArea.height;

      let meta_background = bms.first_child?.first_child;
      if (!meta_background) {
        // this should exists
        return;
      }

      // bottom layout
      switch (dock._position) {
        case 'left':
        case 'top':
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = 0;
          bms.first_child.y = 0;
          bms.first_child.set_clip(
            bg_offset_x,
            bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
        case 'right':
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = -meta_background.width + rw;
          bms.first_child.y = 0;
          bms.first_child.set_clip(
            -bms.first_child.x + bg_offset_x,
            0 + bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
        case 'bottom':
        default:
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = 0;
          bms.first_child.y = -meta_background.height + rh;
          bms.first_child.set_clip(
            0 + bg_offset_x,
            -bms.first_child.y + bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
      }

      let opacity = (dock.extension.background_color[3] ?? 0.5) * 54 + 200;
      meta_background.opacity = opacity;

      animator._blur_effects = bms.first_child.get_effects();
      if (animator._blur_effects) {
        animator._blur_effects.forEach((e) => {
          if (e.constructor.name == 'CornerEffect') {
            e.radius = dock.extension.computed_border_radius;
          }
        });
      }

      return;
    }

    // bms version incompatible
    bms.visible = false;
  }
};
