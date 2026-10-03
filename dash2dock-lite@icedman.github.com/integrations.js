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
    let compiz = Main.extensionManager.lookup(
      'compiz-alike-magic-lamp-effect@hermes83.github.com'
    );
    if (compiz && compiz.stateObj) {
      let stateObj = compiz.stateObj;
      this._compiz = stateObj;
      if (!hook) {
        if (stateObj._getIcon) {
          stateObj.getIcon = stateObj._getIcon;
          stateObj._getIcon = null;
        }
      } else {
        if (!stateObj._getIcon) stateObj._getIcon = stateObj.getIcon;
        if (!this._compizGetIcon) this._compizGetIcon = this.compiz_getIcon.bind(this);
        stateObj.getIcon = this.extension.lamp_app_animation
          ? this._compizGetIcon
          : stateObj._getIcon;
      }
    }
  }

  releaseCompiz() {
    this.hookCompiz(false);
    this._compiz = null;
  }

  // Prefer an icon on the window's monitor, then on the primary dock.
  compiz_getIcon(actor) {
    const metaWindow = actor.meta_window;
    const windowMonitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    const docks = (this.extension.docks || [])
      .map((dock) => ({ dock, monitor: dock.getMonitor() }))
      .filter(({ monitor }) => monitor);
    const priority = ({ monitor }) =>
      monitor.index === windowMonitor?.index ? 0 :
      monitor.index === Main.layoutManager.primaryIndex ? 1 : 2;
    docks.sort((a, b) => priority(a) - priority(b));

    if (docks.length === 0) {
      return this._compiz._getIcon.call(this._compiz, actor);
    }

    const windowApp = Shell.WindowTracker.get_default().get_window_app(metaWindow);
    const appId = windowApp?.get_id();
    const pid = metaWindow.get_pid();
    let target = docks[0];
    let dashIcon = null;
    for (const candidate of docks) {
      const match = (candidate.dock.dash?._box?.get_children() || []).find((element) => {
        const app = element.child?._delegate?.app;
        return app && (
          app === windowApp ||
          (appId && app.get_id() === appId) ||
          (pid && app.get_pids()?.includes(pid))
        );
      });
      if (match) {
        target = candidate;
        dashIcon = match;
        break;
      }
    }

    const { dock, monitor } = target;
    const iconActor = dashIcon?._renderer || dashIcon || dock.dash;
    const position = iconActor?.get_transformed_position();
    const size = iconActor?.get_transformed_size();
    const halfIconSize = dock._preferredIconSize() * (monitor.geometry_scale || 1) / 2;
    let x = position && Number.isFinite(position[0])
      ? position[0] + (size?.[0] > 0 ? size[0] / 2 : halfIconSize)
      : monitor.x + monitor.width / 2;
    let y = position && Number.isFinite(position[1])
      ? position[1] + (size?.[1] > 0 ? size[1] / 2 : halfIconSize)
      : monitor.y + monitor.height / 2;
    x = Math.max(monitor.x, Math.min(monitor.x + monitor.width, x));
    y = Math.max(monitor.y, Math.min(monitor.y + monitor.height, y));

    switch (dock._position) {
      case 'left':
        x = monitor.x;
        break;
      case 'right':
        x = monitor.x + monitor.width;
        break;
      case 'top':
        y = monitor.y;
        break;
      case 'bottom':
      default:
        y = monitor.y + monitor.height;
        break;
    }

    return {
      x,
      y,
      width: 0,
      height: 0,
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

      let meta_background = bms.first_child.first_child;
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
