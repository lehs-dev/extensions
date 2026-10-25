'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { trySpawnCommandLine } from './utils.js';

// import { trySpawnCommandLine } from 'resource:///org/gnome/shell/misc/util.js';

import { Dash } from 'resource:///org/gnome/shell/ui/dash.js';

import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
  DashIcon,
  DashItemContainer,
} from 'resource:///org/gnome/shell/ui/dash.js';

import { DockPosition } from './dock.js';
import { AttachedDockCanvas } from './attachedBackground.js';

class DockItemMenu extends PopupMenu.PopupMenu {
  constructor(sourceActor, side = St.Side.TOP, params = {}) {
    if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL) {
      if (side === St.Side.LEFT) side = St.Side.RIGHT;
      else if (side === St.Side.RIGHT) side = St.Side.LEFT;
    }

    super(sourceActor, 0.5, side);

    this.actor.hide();
    this.actor.opacity = 0;

    let { desktopApp } = params;
    if (!desktopApp) return;

    this.desktopApp = desktopApp;

    this._newWindowItem = this.addAction('Open Window', () => {
      let workspaceManager = global.workspace_manager;
      let workspace = workspaceManager.get_active_workspace();
      let ctx = global.create_app_launch_context(0, workspace);
      desktopApp.launch([], ctx);
      this._onActivate();
    });

    desktopApp.list_actions().forEach((action) => {
      let name = desktopApp.get_action_name(action);
      this.addAction(name, () => {
        let workspaceManager = global.workspace_manager;
        let workspace = workspaceManager.get_active_workspace();
        let ctx = global.create_app_launch_context(0, workspace);
        desktopApp.launch_action(action, ctx);
        this.item.dock.extension.animate({ refresh: true });
      });
    });
  }

  _onActivate() {}

  popup() {
    this.actor.opacity = 255;
    this.open(BoxPointer.PopupAnimation.FULL);
    this._menuManager.ignoreRelease();
  }

  close(animate) {
    super.close(animate);
    if (!this.isOpen) {
      this.actor.hide();
      this.actor.opacity = 0;
    }
  }
}

const DockItemOverlay = GObject.registerClass(
  {},
  class DockItemOverlay extends St.Widget {
    _init(renderer, params) {
      super._init({
        name: 'DockItemContainer',
        ...params,
      });

      this.renderer = renderer;
      if (renderer) {
        this.add_child(renderer);
      }
    }
  }
);

export const DockItemDotsOverlay = GObject.registerClass(
  {},
  class DockItemDotsOverlay extends DockItemOverlay {
    update(icon, data) {
      let renderer = this.renderer;
      let { appCount, position, vertical, extension, dock } = data;

      renderer.width = dock._iconSizeScaledDown || icon._icon.width;
      renderer.height = dock._iconSizeScaledDown || icon._icon.height;
      if (typeof renderer.set_pivot_point === 'function') {
        renderer.set_pivot_point(icon._icon.pivot_point?.x ?? 0.5, icon._icon.pivot_point?.y ?? 0.5);
      } else {
        renderer.pivot_point = icon._icon.pivot_point;
      }

      let canvasScale = renderer.width / renderer._canvas.width;

      // scaling fix
      let scale = dock._monitor.geometry_scale || 1;
      canvasScale *= scale;
      renderer._canvas.set_scale(canvasScale, canvasScale);

      let offsetX = 0;
      let offsetY = renderer.height * 0.125 * scale;
      if (vertical) {
        offsetX = -offsetY;
        if (position == DockPosition.RIGHT) {
          offsetX = offsetY;
        }
        offsetY = 0;
      } else {
        if (position == DockPosition.TOP) {
          offsetY = -offsetY;
        }
      }

      // renderer.translationX = icon._icon.translationX + offsetX;
      // renderer.translationY = icon._icon.translationY + offsetY;

      renderer.translationX = offsetX;
      renderer.translationY = offsetY;

      let options = extension.running_indicator_style_options;
      let running_indicator_style = options[extension.running_indicator_style];
      let running_indicator_color = extension._dockColors?.['running-indicator-color'] ||
        extension.running_indicator_color;

      renderer.set_state({
        count: appCount,
        color: running_indicator_color || [1, 1, 1, 1],
        style: running_indicator_style || 'default',
        size: extension.running_indicator_size || 0,
        // Canvas space diameter for a 4 logical pixel default indicator.
        diameter: 4 * scale / canvasScale,
        rotate: vertical
          ? position == DockPosition.RIGHT
            ? -90
            : 90
          : position == DockPosition.TOP
            ? 180
            : 0,
      });
    }
  }
);

export const DockItemBadgeOverlay = GObject.registerClass(
  {},
  class DockItemBadgeOverlay extends DockItemOverlay {
    update(icon, data) {
      let renderer = this.renderer;
      let { noticesCount, position, vertical, extension, scale } = data;

      renderer.width = icon._icon.width;
      renderer.height = icon._icon.height;
      let canvasScale = renderer.width / renderer._canvas.width;
      renderer._canvas.set_scale(canvasScale, canvasScale);

      let options = extension.notification_badge_style_options;
      let notification_badge_style =
        options[extension.notification_badge_style];
      let notification_badge_color = extension.notification_badge_color;

      renderer.translationX = renderer.width / 1.5;
      // renderer.translationY = icon._icon.translationY;

      renderer.set_state({
        count: noticesCount,
        color: notification_badge_color || [1, 1, 1, 1],
        style: notification_badge_style || 'default',
        size: extension.notification_badge_size || 0,
        translate: [0, -0.85],
      });
    }
  }
);

export const DockIcon = GObject.registerClass(
  {},
  class DockIcon extends DashIcon {
    _init(app) {
      super._init(app);
      this._dot.visible = false;

      this._draggable._onButtonPress = () => {
        return Clutter.EVENT_PROPAGATE;
      };
      this._draggable._onTouchEvent = () => {
        return Clutter.EVENT_PROPAGATE;
      };
      this._draggable._grabActor = () => {};
    }

    _createIcon(size) {
      this._iconActor = new St.Icon({
        icon_name: this._default_icon_name || 'file',
        icon_size: size,
        style_class: this._default_icon_style_class || '',
        track_hover: true,
      });

      let container = this.get_parent();

      // attach event
      let icon = this._iconActor;
      icon.reactive = true;
      icon.track_hover = true;

      icon.connectObject(
        'enter-event',
        () => {
          try {
            container.showLabel();
          } catch (err) {
            console.log(err);
          }
        },
        'leave-event',
        () => {
          try {
            container.hideLabel();
          } catch (err) {
            console.log(err);
          }
        },
        'button-press-event',
        (actor, evt) => {
          if (evt.get_button() != 1) {
            if (container._menu) {
              container._menu.popup();
            }
          } else {
            if (container._onClick) {
              container._onClick();
            }
          }
        },
        this
      );

      return this._iconActor;
    }
  }
);

export const DockItemContainer = GObject.registerClass(
  {},
  class DockItemContainer extends DashItemContainer {
    _init(params) {
      super._init({
        name: 'DockItemContainer',
        style_class: 'dash-item-container',
        ...params,
        scale_x: 1,
        scale_y: 1,
      });

      this.custom_icon = true;

      // hack to get DesktopAppInfo class
      let DesktopAppInfo = Main.overview.d2dl.DesktopAppInfo;
      if (!DesktopAppInfo) {
        try {
          DesktopAppInfo =
            Shell.AppSystem.get_default().get_installed()[0].constructor;
        } catch (err) {
          // should be unreachable
          console.log(err);
        }
        Main.overview.d2dl.DesktopAppInfo = DesktopAppInfo;
      }

      let desktopApp = params.app;
      if (desktopApp) {
        // monkey patch dummy app
        if (!desktopApp.get_icon) {
          desktopApp.can_open_new_window = () => false;
          desktopApp.create_icon_texture = () => null;
          desktopApp.get_windows = () => null;
          desktopApp.get_icon = () => {
            return {
              get_names: () => [],
            };
          };
        }
      } else {
        desktopApp = DesktopAppInfo.new_from_filename(params.appinfo_filename);
      }

      let dashIcon = new DockIcon(desktopApp, {
        name: 'DockItemContainer',
        style_class: 'dash-item-container',
        ...(params || {}),
      });
      this.set_scale(1, 1);
      this.setChild(dashIcon);

      try {
        this.setLabelText(desktopApp.get_name());
        dashIcon._default_icon_name = desktopApp.get_icon().get_names()[0];
      } catch (err) {
        console.log(err);
        console.log(params);
      }

      // menu
      if (params.appinfo_filename) {
        this._menu = new DockItemMenu(this, St.Side.TOP, {
          desktopApp,
        });
        this._menu.item = this;
        this._menu.actor.hide();
        this._menu.actor.opacity = 0;
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu._menuManager = this._menuManager;
        Main.uiGroup.add_child(this._menu.actor);
        this._menuManager.addMenu(this._menu);
        this._menu.actor.hide();
        this._menu.actor.opacity = 0;
        this._menu.close();
        dashIcon._menu = this._menu;
      }
    }

    activateNewWindow() {
      if (this._menu && this._menu._newWindowItem) {
        this._menu._newWindowItem.emit('activate', null);
      }
    }

    _onClick() {
      this.activateNewWindow();
    }
  }
);

export const DockBackground = GObject.registerClass(
  {},
  class DockBackground extends St.Widget {
    _init(params) {
      this._initialized = true;
      if (typeof super._init === 'function') {
        super._init({
          name: 'DockBackground',
          ...(params || {}),
        });
      }

      this._canvas = new AttachedDockCanvas();
      this._canvas.visible = false;
      this.add_child(this._canvas);
    }

    update(params) {
      let {
        first,
        last,
        iconSize,
        scaleFactor,
        vertical,
        position,
        panel_mode,
        dock,
      } = params;

      if (dock.extension?.desktopLayoutManager?.mode === 1) panel_mode = false;
      this._padding = 0;

      if (!first || !last || (first == last && !dock._modularViewport)) {
        this.opacity = 0;
        return;
      }

      let dp = dock.dash.get_transformed_position();
      if (isNaN(dp[0]) || isNaN(dp[1])) return;

      const rect = {};
      const commitRect = () => {
        for (const key of ['x', 'y', 'width', 'height'])
          if (this[key] !== rect[key]) this[key] = rect[key];
        this._paintedRect = {...rect};
      };

      let padding =
        iconSize * 0.1 * (dock.extension.dock_padding || 0) * scaleFactor;

      if (first && last) {
        let tx = first._animationTranslationX ?? first._icon.translationX;
        let ty = first._animationTranslationY ?? first._icon.translationY;
        let tx2 = last._animationTranslationX ?? last._icon.translationX;
        let ty2 = last._animationTranslationY ?? last._icon.translationY;

        // bottom
        rect.x = dp[0];
        rect.y = dp[1];
        let width = dock.dash.width;
        let height = dock.dash.height;

        if (dock.isVertical()) {
          rect.y += ty;
          height += ty2 - ty;
        } else {
          rect.x += tx;
          width += tx2 - tx;
        }

        // padding
        rect.x -= padding;
        width += padding * 2;
        rect.y -= padding;
        height += padding * 2;

        if (!isNaN(width)) {
          rect.width = width;
        }
        if (!isNaN(height)) {
          rect.height = height;
        }

        rect.x -= dock.x;
        rect.y -= dock.y;
        this._padding = padding;

        // adjust padding
        let az = -padding;
        rect.x += az / 2;
        rect.width -= az * (1 + !vertical);
        rect.y += az / 2;
        rect.height -= az * (1 + vertical);

        if (panel_mode) {
          if (vertical) {
            rect.y = 0;
            rect.height = dock.height;
          } else {
            rect.x = 0;
            rect.width = dock.width;
          }
        }

        const isAttachedEdge =
          !panel_mode &&
          (dock.extension?.background_style === 1 || dock.extension?.desktopLayoutManager?.mode === 1);

        if (isAttachedEdge) {
          const flareWidth = dock.extension?.flare_width ?? 14;
          const footDepth = dock.extension?.foot_depth ?? 4;
          const cornerRadius = dock.extension?.attached_corner_radius ?? 10;
          const fw = Math.round(flareWidth * scaleFactor);

          if (position === DockPosition.BOTTOM) {
            rect.x -= fw;
            rect.width += 2 * fw;
            const screenBottom = dock.height + (dock.dash.translationY || 0);
            rect.height = Math.max(1, screenBottom - rect.y);
          } else if (position === DockPosition.TOP) {
            rect.x -= fw;
            rect.width += 2 * fw;
            const bodyBottom = rect.y + rect.height;
            const screenTop = 0 + (dock.dash.translationY || 0);
            rect.y = screenTop;
            rect.height = Math.max(1, bodyBottom - rect.y);
          } else if (position === DockPosition.LEFT) {
            rect.y -= fw;
            rect.height += 2 * fw;
            const bodyRight = rect.x + rect.width;
            const screenLeft = 0 + (dock.dash.translationX || 0);
            rect.x = screenLeft;
            rect.width = Math.max(1, bodyRight - rect.x);
          } else if (position === DockPosition.RIGHT) {
            rect.y -= fw;
            rect.height += 2 * fw;
            const screenRight = dock.width + (dock.dash.translationX || 0);
            rect.width = Math.max(1, screenRight - rect.x);
          }

          if (dock._modularViewport) {
            // Keep input/scroll allocation stable while the painted contour
            // follows the interpolated renderers, including a single app.
            const inset = Math.max(4 * scaleFactor, padding);
            const restingRights = (dock._icons ?? []).filter(icon => Number.isFinite(icon._fixedPosition?.[0]))
              .map(icon => icon._fixedPosition[0] - dock.x + icon.width / 2 + iconSize * scaleFactor / 2 + inset);
            if (restingRights.length) dock._restingWidth = Math.max(...restingRights);
            const bounds = (dock._icons ?? []).flatMap(icon => {
              const renderer = icon._renderer;
              if (!renderer || renderer.visible === false) return [];
              const b = icon._renderBounds;
              const [x, y] = b ? [b.x, b.y] : renderer.get_transformed_position();
              const [w, h] = b ? [b.width, b.height] : renderer.get_transformed_size();
              if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return [];
              // Scrolled-out apps must not affect the visible capsule width.
              if (y + h <= dock.y + fw || y >= dock.y + dock.height - fw) return [];
              return [{top: y - dock.y, bottom: y + h - dock.y, right: x + w - dock.x}];
            });
            if (bounds.length) {
              rect.width = Math.max(1, Math.max(...bounds.map(b => b.right)) + inset - rect.x);
              rect.y = Math.min(...bounds.map(b => b.top)) - inset - fw;
              rect.height = Math.max(...bounds.map(b => b.bottom)) + inset + fw - rect.y;
            }
            // When moving vertically near the crown, changing icon profiles
            // must not shrink the painted body out from under the pointer.
            // Entry is still gated by the previous paint/source area, and an
            // actual exit clears this floor on the very next frame.
            if (dock._hoverPointer) {
              rect.width = Math.max(rect.width, dock._hoverPointer[0] - dock.x - rect.x + 1);
              const pointerY = dock._hoverPointer[1] - dock.y;
              const bottom = Math.max(rect.y + rect.height, pointerY + fw + 1);
              rect.y = Math.min(rect.y, pointerY - fw - 1);
              rect.height = bottom - rect.y;
            }
            if (dock._modularViewport.overflow) {
              // Long lists scroll through a fixed capsule; scrolling alone
              // must never move its top or bottom toward the system pods.
              rect.y = dock.dash.translationY || 0;
              rect.height = dock.height;
            } else {
              const top = Math.max(dock.dash.translationY || 0, rect.y);
              const bottom = Math.min((dock.dash.translationY || 0) + dock.height, rect.y + rect.height);
              rect.y = top;
              rect.height = Math.max(1, bottom - top);
            }
          }

          if (dock._modularViewport) {
            const right = Math.ceil(rect.x + rect.width);
            const bottom = Math.ceil(rect.y + rect.height);
            rect.x = Math.floor(rect.x);
            rect.y = Math.floor(rect.y);
            rect.width = Math.max(1, right - rect.x);
            rect.height = Math.max(1, bottom - rect.y);
          }
          // All measurements happen before actor mutations. Intermediate Dash
          // sizes must not force a relayout while reading renderer transforms.
          commitRect();
          if (this._canvas) {
            this._canvas.visible = true;
            if (this._canvas.x !== 0 || this._canvas.y !== 0)
              this._canvas.set_position(0, 0);
            if (this._canvas.width !== rect.width || this._canvas.height !== rect.height)
              this._canvas.set_size(rect.width, rect.height);
            this._canvas.set_state({
              width: rect.width,
              height: rect.height,
              flareWidth,
              footDepth,
              cornerRadius,
              scaleFactor,
              position,
              backgroundColor: dock.extension?._dockColors?.['background-color'],
              borderColor: dock.extension?._dockColors?.['border-color'],
              borderThickness: dock.extension?.border_thickness || 0,
            });
          }
        } else {
          commitRect();
          if (this._canvas) {
            this._canvas.visible = false;
          }
        }

        this.opacity = 255;
        dock.dash.opacity = this.opacity;
      }
    }
  }
);
