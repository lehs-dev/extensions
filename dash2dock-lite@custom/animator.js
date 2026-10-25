'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
const Point = Graphene.Point;

import { Dot } from './apps/dot.js';
import { DockPosition } from './dock.js';
import { Vector } from './vector.js';

import { DockItemDotsOverlay, DockItemBadgeOverlay } from './dockItems.js';
import {
  Bounce,
  Linear,
  CubicEaseOut,
  QuadraticEaseOut,
  SineEaseInOut,
} from './effects/easing.js';
import {
  get_distance_sqr,
  get_distance,
  isInRect,
  isOverlapRect,
} from './utils.js';

const ANIM_POSITION_PER_SEC = 550 / 1000;
const ANIM_SIZE_PER_SEC = 250 / 1000;
const ANIM_ICON_RAISE = 0.5;
const ANIM_ICON_SCALE = 1.5;
const ANIM_ICON_HIT_AREA = 2.5;

const DOT_CANVAS_SIZE = 96;

export let Animator = class {
  enable() {
    if (!this._renderers) {
      this._renderers = [];
      this._dots = [];
      this._badges = [];
    }
    this._computed = null;
  }

  disable() {
    for (const actor of [
      ...(this._renderers || []),
      ...(this._dots || []),
      ...(this._badges || []),
    ]) actor.destroy();
    this._renderers = [];
    this._dots = [];
    this._badges = [];
    this._target = null;
  }

  _precreateResources(dock) {
    if (!dock._icons) {
      return false;
    }

    let count = dock._icons.length;
    if (dock.renderArea.get_children().length == 0) {
      this._renderers = [];
      this._dots = [];
      this._badges = [];
    }
    this._target = dock.renderArea;

    while (this._renderers.length < count) {
      // renderer
      let target = dock.renderArea;
      let renderer = new St.Icon({
        icon_name: 'file',
        name: 'd2daIcon',
        reactive: false,
        icon_size: 24,
      });
      renderer.visible = false;
      target.add_child(renderer);
      const hitTarget = dock._createIconHitTarget?.(renderer);
      if (hitTarget) renderer.connect('destroy', () => hitTarget.destroy());
      this._renderers.push(renderer);

      // dot
      let dots = new DockItemDotsOverlay(new Dot(DOT_CANVAS_SIZE));
      dots.visible = false;
      target.add_child(dots);
      this._dots.push(dots);

      // badges
      let badge = new DockItemBadgeOverlay(new Dot(DOT_CANVAS_SIZE));
      badge.visible = false;
      target.add_child(badge);
      this._badges.push(badge);
    }

    for (let i = dock._icons.length; i < this._renderers.length; i++) {
      this._renderers[i].visible = false;
      if (!dock._dragging) this._renderers[i]._hitTarget?.hide();
      this._dots[i].visible = false;
      this._badges[i].visible = false;
    }

    return true;
  }

  //! begin optimization
  animate(dt) {
    let dock = this.dock;
    dock._lastHoveredIcon = dock._hoveredIcon;

    let simulation = false;

    if (!dock.layout()) {
      if (!dock._layoutSuppressed) console.log('unable to layout()');
      return;
    }

    if (!this._precreateResources(dock)) {
      return;
    }

    // opacity
    let didFadeIn = false;
    if (dock.opacity < 255) {
      let opacityPerSecond = 255 / 500;
      didFadeIn = true;
      let dst = 255 - dock.opacity;
      let mag = Math.abs(dst);
      let dir = Math.sign(dst);
      if (opacityPerSecond > mag / dt) {
        opacityPerSecond = mag / dt;
      }
      dock.opacity += Math.floor(opacityPerSecond * dt * dir);
      if (dock.renderArea.opacity < 255 && dock.opacity > 50) {
        dock.renderArea.opacity = dock.opacity;
      }
    }

    let m = dock.getMonitor();
    let pointer = global.get_pointer();

    // simulated or transformed pointers
    if (dock.extension.simulated_pointer) {
      pointer = [...dock.extension.simulated_pointer];
      simulation = true;
    }
    if (dock.simulated_pointer) {
      pointer = [...dock.simulated_pointer];
      simulation = true;
    }
    // disable icon scale animation upon hovering an item
    if (
      dock._list &&
      dock._list.visible &&
      dock._list._box &&
      dock._lastHoveredIcon == dock._list._target
    ) {
      pointer[1] -= dock._iconSize * dock._scaleFactor;
    }

    let [px, py] = pointer;

    let vertical = dock.isVertical();
    let isWithin = dock.isWithinHoverArea
      ? dock.isWithinHoverArea([px, py])
      : dock._isWithinDash([px, py]);

    if (m.inFullscreen) {
      isWithin = false;
    }

    let animated = isWithin;
    dock.animated = animated;

    let animateIcons = dock._icons;
    let iconSize = dock._iconSizeScaledDown;
    let scaleFactor = dock._scaleFactor;

    let nearestIdx = -1;
    let nearestIcon = null;
    let nearestDistance = -1;

    let iconCenterOffset = (iconSize * scaleFactor) / 2;
    let hitArea = iconSize * ANIM_ICON_HIT_AREA * scaleFactor;
    hitArea *= hitArea;

    let idx = 0;
    let prevIcon = null;
    animateIcons.forEach((icon) => {
      if (!icon._icon) return;
      let pos = icon.get_transformed_position();

      if (icon._found && !icon._handled) {
        icon._handled = true;
        dock._maybeBounce(icon, true);
      }

      icon._pos = [...pos];
      icon._fixedPosition = [...pos];

      // get nearest
      let bposcenter = [...pos];
      bposcenter[0] += iconCenterOffset;
      bposcenter[1] += iconCenterOffset;
      let dst = get_distance_sqr(pointer, bposcenter);

      if (
        isWithin &&
        (nearestDistance == -1 || nearestDistance > dst) &&
        dst < hitArea
      ) {
        nearestDistance = dst;
        nearestIcon = icon;
        nearestIdx = idx;
        icon._distance = dst;
      }

      icon._target = pos;
      icon._targetScale = 1;

      icon._idx = idx++;

      icon._prev = prevIcon;
      icon._next = null;
      if (prevIcon) {
        prevIcon._next = icon;
      }
      prevIcon = icon;
    });

    const settings = St.Settings.get();
    let noAnimation = !dock.extension.animate_icons_unmute ||
      !settings.enable_animations ||
      (St.ReducedMotion && settings.reducedMotion === St.ReducedMotion.REDUCE);
    if (dock._dragging) {
      noAnimation = true;
      isWithin = true;
    }
    if ((!simulation && !isWithin) || noAnimation) {
      nearestIcon = null;
    }
    dock._nearestIcon = nearestIcon;
    dock._hoverPointer = nearestIcon && isWithin ? [px, py] : null;

    let didScale = false;
    let didBounce = false;

    //------------------------
    // animation behavior
    //------------------------
    let edge_distance = dock._edge_distance;
    let rise = dock.extension.animation_rise * ANIM_ICON_RAISE;
    let magnify = dock.extension.animation_magnify * ANIM_ICON_SCALE;
    let spread = dock.extension.animation_spread;

    // when not much spreading, minimize magnification
    if (spread < 0.2) {
      magnify *= 0.8;
    }
    // when too much magnification, increase spreading
    if (magnify > 0.15 && spread < 0.55) {
      spread = 0.55 + spread * 0.2;
    }

    let threshold = (iconSize + 10) * 2.5 * scaleFactor;
    if (animated && edge_distance < 0) {
      edge_distance = 0;
    }

    let total_scale = 0;
    let did_scale_count = 0;

    // animate
    let firstIcon = null;
    let lastIcon = null;
    let iconTable = [];

    let Ease = SineEaseInOut;
    if (dock.extension.animation_rise_curve == 1) {
      Ease = CubicEaseOut;
    } else if (dock.extension.animation_rise_curve == 2) {
      Ease = QuadraticEaseOut;
    }

    animateIcons.forEach((icon) => {
      if (!icon._icon) return;
      let original_pos = [...icon._pos];

      // used by background resizing and repositioning
      icon._fixedPosition = [...original_pos];

      original_pos[0] += icon.width / 2;
      original_pos[1] += icon.height / 2;

      icon._pos = [...original_pos];
      icon._translate = 0;
      icon._translateRise = 0;

      iconTable.push(icon);
      if (firstIcon == null) {
        firstIcon = icon;
      }
      lastIcon = null;

      let scale = 1;
      let dx = original_pos[0] - px;
      if (vertical) {
        dx = original_pos[1] - py;
      }

      icon._hoverProgress = 0;
      if (dx * dx < threshold * threshold && nearestIcon) {
        let adx = Math.abs(dx);
        let hoverProgress = 1.0 - adx / threshold;
        // let fp = hoverProgress * 0.6 * (1 + magnify);
        icon._hoverProgress = hoverProgress;

        // affect scale;
        if (magnify != 0) {
          // scale += fp;
          scale = Math.min(2, 1 + magnify * Ease(hoverProgress));
        }

        // affect rise
        // let sz = iconSize * fp * scaleFactor;
        let sz = iconSize * (scale - 1) * scaleFactor;
        icon._translateRise = sz * rise;
        didScale = true;

        total_scale += scale;
        did_scale_count += 1;
      }

      icon._scale = scale;
      icon._targetScale = scale;

      // Only the renderer scales. The invisible source supplies stable layout
      // and hit geometry, including for PNG icons and drag placeholders.
      if (icon._icon.scaleX !== 1 || icon._icon.scaleY !== 1)
        icon._icon.set_scale(1, 1);

      if (!icon._pos) {
        return;
      }
    });

    let largestIconScale = 1;

    //! use better collision test here?
    let total_spread_left = 0;
    let total_spread_right = 0;
    let hoveredIcon = nearestIcon ? (dock._lastHoveredIcon || nearestIcon) : null;
    for (let i = 0; i < iconTable.length; i++) {
      if (iconTable.length < 2) break;
      let icon = iconTable[i];

      if (icon._targetScale > largestIconScale) {
        largestIconScale = icon._targetScale;
        hoveredIcon = icon;
      }

      // if (icon._icon && icon._icon.hover) {
      //   hoveredIcon = icon;
      // }

      let scale = icon._scale;
      if (scale > 1) {
        // affect spread
        let offset = 1.25 * (scale - 1) * iconSize * scaleFactor * spread * 0.5;
        // left
        for (let j = i - 1; j >= 0; j--) {
          let left = iconTable[j];
          left._translate -= offset;
          total_spread_left += offset;
        }
        // right
        for (let j = i + 1; j < iconTable.length; j++) {
          let right = iconTable[j];
          right._translate += offset;
          total_spread_right += offset;
        }
      }
    }

    // Keep expansion centred without changing the target when the nearest
    // icon changes at the midpoint between two hit areas.
    dock._hoveredIcon = hoveredIcon;
    if (!nearestIcon) {
      dock._lastHoveredIcon = null;
      this._dwellIcon = null;
      this._dwellTick = 0;
    }
    if (iconTable.length > 0) {
      const adjust = (iconTable[0]._translate + iconTable[iconTable.length - 1]._translate) / 2;
      for (const icon of iconTable)
        icon._translate -= adjust;
    }

    //-------------------
    // interpolation / animation
    //-------------------
    let renderOffset = dock.renderArea.get_transformed_position();

    let first = animateIcons[0];
    let last = animateIcons[animateIcons.length - 1];

    let slowDown = dock.extension._config.speed_up || 1;
    if (!didScale) {
      slowDown = 0.5;
    }

    animateIcons.forEach((icon) => {
      if (!icon._icon) return;

      icon._scale = icon._targetScale;

      const isTopOrLeft =
        dock._position === DockPosition.TOP ||
        dock._position === DockPosition.LEFT;
      const riseDirection = isTopOrLeft ? 1 : -1;

      let translationX;
      let translationY;
      if (vertical) {
        translationX = icon._translateRise * riseDirection;
        translationY = icon._translate;
      } else {
        translationX = icon._translate;
        translationY = icon._translateRise * riseDirection;
      }

      //-------------------
      // animate position
      //-------------------
      {
        let speed = ANIM_POSITION_PER_SEC * slowDown;
        let targetPosition = new Vector([translationX, translationY, 0]);
        let currentPosition = new Vector([
          icon._animationTranslationX ?? 0,
          icon._animationTranslationY ?? 0,
          0,
        ]);
        let dst = targetPosition.subtract(currentPosition);
        let mag = dst.magnitude();
        if (mag > 0) {
          dst = dst.normalize();
        }
        let deltaVector = dst.multiplyScalar(speed * dt);
        let deltaMag = deltaVector.magnitude();
        let appliedVector = new Vector([targetPosition.x, targetPosition.y, 0]);
        if (deltaMag < mag) {
          appliedVector = currentPosition.add(deltaVector);
        }
        translationX = appliedVector.x;
        translationY = appliedVector.y;
        icon._deltaVector = appliedVector;
      }

      // The interpolation above already uses elapsed time. A second blend
      // per frame would give 120 Hz a different response from 60 Hz.
      icon._animationTranslationX = translationX;
      icon._animationTranslationY = translationY;

      // clear bounce animation
      if (icon._appwell) {
        icon._appwell.translationY = 0;
        didBounce = icon._appwell._bounce;
        // clear bounce
        icon._appwell._bounce = false;
      }
    });

    //--------------
    // renderer
    //--------------
    animateIcons.forEach((icon) => {
      if (!icon._icon) return;
      // dock.renderArea.opacity = 100;
      {
        let icon_name = icon._icon.icon_name;
        let app_name =
          icon._appwell?.app?.app_info?.get_id()?.replace('.desktop', '') ??
          null;
        let gicon = null;

        // override icons here
        if (dock.extension.icon_map || dock.extension.app_map) {
          // override via icon name
          if (
            dock.extension.icon_map_cache &&
            dock.extension.icon_map_cache[icon_name]
          ) {
            gicon = dock.extension.icon_map_cache[icon_name];
          }
          if (
            !gicon &&
            dock.extension.icon_map &&
            dock.extension.icon_map[icon_name]
          ) {
            icon_name = dock.extension.icon_map[icon_name];
          }

          // override via app name
          if (
            app_name &&
            dock.extension.app_map_cache &&
            dock.extension.app_map_cache[app_name]
          ) {
            gicon = dock.extension.app_map_cache[app_name];
          }
          if (
            !gicon &&
            dock.extension.app_map &&
            app_name &&
            dock.extension.app_map[app_name]
          ) {
            icon_name = dock.extension.app_map[app_name];
          }
        }

        icon._renderer = this._renderers[icon._idx];
        icon._renderer._icon = icon._icon;
        icon._renderer.set_style_class_name('');

        if (!icon._appwell?._bounce) {
          icon._renderer.translationY = 0;
        }

        let renderer = icon._renderer;
        if (gicon) {
          // apply override
          renderer.gicon = gicon;

          // replace PNG with override SVG
          if (icon._icon.gicon && icon._icon.gicon.file && gicon) {
            icon._icon.gicon = gicon;
          }
        } else {
          if (icon_name) {
            renderer.icon_name = icon_name;
          } else {
            if (icon._icon.gicon) {
              // Directly assign the icon's gicon to the renderer (fixed in #issue 188)
              renderer.gicon = icon._icon.gicon;
            }
          }
        }

        //-------------------
        // animate scaling at renderer
        //-------------------
        let unscaledIconSize = dock._iconSizeScaledDown * scaleFactor;
        let targetSize = unscaledIconSize * icon._targetScale;
        let currentSize = renderer.icon_size * renderer.scaleX;
        {
          let dst = targetSize - currentSize;
          let mag = Math.abs(dst);
          let dir = Math.sign(dst);
          let accel = 0;
          let pixelOverTime = ANIM_SIZE_PER_SEC * slowDown;
          let deltaSize = pixelOverTime * dir * dt;
          let appliedSize = deltaSize;
          appliedSize += accel;
          if (Math.abs(appliedSize) > mag) {
            appliedSize = dst;
          }
          targetSize = currentSize + appliedSize;
          icon._deltaSize = appliedSize;
          icon._targetSize = targetSize;
        }
        // compute icon scale based on size
        icon._scale = targetSize / unscaledIconSize;

        let baseSize = 32 * (dock.extension.icon_quality || 1);
        if (renderer.icon_size != baseSize) {
          renderer.set_size(baseSize, baseSize);
          renderer.set_icon_size(baseSize);
        }
        let scaleToTarget = targetSize / baseSize;
        renderer.set_scale(scaleToTarget, scaleToTarget);

        let p = icon.get_transformed_position();
        let adjustX = icon.width / 2 - targetSize / 2;
        let adjustY = icon.height / 2 - targetSize / 2;

        if (targetSize > icon.height) {
          let rise = (targetSize - icon.height) * 0.5;
          if (vertical) {
            adjustX += rise * (dock._position == 'left' ? 1 : -1);
          } else {
            adjustY += rise * (dock._position == 'bottom' ? -1 : 1);
          }
        }

        //-------------------
        // commit position
        //-------------------
        if (!isNaN(p[0]) && !isNaN(p[1])) {
          let iconContainer = icon._icon.get_parent();
          // iconContainer can be null when dragging icons
          if (iconContainer) {
            // Source actors supply layout and native DND. Moving their inner
            // containers feeds animated geometry back into future allocations.
            let ry = p[1] + adjustY + icon._animationTranslationY - renderOffset[1];
            renderer.set_position(
              p[0] + adjustX + icon._animationTranslationX - renderOffset[0],
              ry
            );

            // renderer.ease({
            //   x: p[0] + adjustX + icon._icon.translationX - renderOffset[0],
            //   y: ry,
            //   duration: 100,
            //   mode: Clutter.AnimationMode.LINEAR,
            // });

            // renderer.ease({
            //   width: baseSize,
            //   height: baseSize,
            //   icon_size: baseSize,
            //   duration: 200,
            //   mode: Clutter.AnimationMode.LINEAR,
            // });

            renderer.visible = true;
            icon._renderBounds = {x: renderOffset[0] + renderer.x + renderer.translationX,
              y: renderOffset[1] + renderer.y + renderer.translationY,
              width: targetSize, height: targetSize};
          }
          icon._px = p[0] - renderOffset[0];
          icon._py = p[1] - renderOffset[1];
        }

        let hideLabel = true;

        // label
        if (
          nearestIcon &&
          icon === hoveredIcon &&
          icon._label &&
          icon._label.text &&
          icon._label.text.length
        ) {
          let tSize = renderer.get_transformed_size();
          // let tPos = icon._icon.get_transformed_position();
          let tPos = renderer.get_transformed_position();
          if (isNaN(tPos[0]) || isNaN(tPos[1])) {
            tPos[0] = 0;
            tPos[1] = 0;
          }
          let sw = !isNaN(tSize[0]) ? tSize[0] : 0;
          let sh = !isNaN(tSize[1]) ? tSize[1] : 0;

          if (this._dwellIcon === icon) {
            this._dwellTick += dt;
            if (this._dwellTick > 450 && icon._targetScale > 1) {
              try {
                hideLabel = false;
                if (icon._label.opacity < 255 - 25) {
                  icon._label.opacity += 25;
                } else {
                  icon._label.opacity = 255;
                }
              } catch (err) {
                // label not ready?
              }
            }
          } else {
            this._dwellTick = 0;
          }
          this._dwellIcon = icon;

          // icon._label.style = 'font-size: 32pt';
          // icon._label.set_scale(0.5, 0.5);
          let lsz = icon._label.get_transformed_size();
          if (!isNaN(lsz[0]) && !isNaN(lsz[1])) {
            icon._label.x = tPos[0] + sw / 2 - lsz[0] / 2;
            icon._label.y = tPos[1] + sh / 2 - lsz[1] / 2;
            if (vertical) {
              if (dock._position == DockPosition.LEFT) {
                icon._label.x += sh / 1.5 + icon._label.width / 2;
              } else {
                icon._label.x -= sh / 1.5 + icon._label.width / 2;
              }
              icon._label.y += 2 * (m.geometry_scale || 1);
            } else {
              if (magnify == 0 || dock._iconSize <= 4) {
                sh *= 1.5;
              }
              if (dock._position == DockPosition.BOTTOM) {
                icon._label.y -= sh / 1.25;
              } else {
                icon._label.y += sh / 1.25;
              }
              icon._label.x += 2 * (m.geometry_scale || 1);
            }
          }
        }

        if (hideLabel && icon._label) {
          icon._label.opacity = 0;
        }

        //! todo... add placeholder opacity when dragging
        renderer.opacity =
          icon._icon == dock._dragged && dock._dragging ? 75 : 255;
      }



      // badges
      //! ***badge location at scaling is messed up***
      let badge = this._badges[icon._idx];
      badge.hide();
      if (icon != dock._dragged) {
        let appNotices = icon._appwell
          ? dock.extension.services._appNotices[icon._appwell.app.get_id()]
          : null;
        let noticesCount = 0;
        if (appNotices) {
          noticesCount = appNotices.count;
        }
        // noticesCount = 1;
        let target = dock.renderArea;
        if (badge && noticesCount > 0) {
          badge.update(icon, {
            noticesCount,
            position: dock._position,
            vertical,
            extension: dock.extension,
          });
          // badge.x = icon._renderer.x + 3 * icon._scale;
          // badge.y = icon._renderer.y - 3 * icon._scale;

          // if (dock._position == DockPosition.TOP) {
          //   badge.y = icon._renderer.y + (icon.height - 6) * icon._scale;
          // }

          badge.width = icon._renderer.width * icon._renderer.scaleX;
          badge.height = badge.width;
          badge.x = icon._renderer.x;
          badge.y = icon._renderer.y;

          badge.set_scale(icon._scale, icon._scale);
          badge.show();
        }
      }

      // dots
      //! ***dot requires a little more aligning at dock position other than bottom***
      let dots = this._dots[icon._idx];
      dots.hide();
      if (
        icon != dock._dragged &&
        icon._appwell &&
        icon._appwell.app &&
        icon._appwell.app.get_n_windows
      ) {
        let appCount = dock.getAppWindowsFiltered(icon._appwell.app).length;
        // appCount = 1;
        if (dots && appCount > 0) {
          dots.update(icon, {
            appCount,
            position: dock._position,
            vertical,
            extension: dock.extension,
            dock,
          });

          dots.width = icon._renderer.width * icon._renderer.scaleX;
          dots.height = dots.width;
          dots.x = icon._renderer.x;
          dots.y = icon._renderer.y;
          dots.set_scale(icon._scale, icon._scale);
          dots.show();
        }
      }

      // custom icons
      if (dock.extension.services) {
        dock.extension.services.updateIcon(icon, {
          scaleFactor,
          iconSize,
          dock,
        });
      }
    });

    // separators
    dock._separators.forEach((actor) => {
      let prev = actor._prev; // get_previous_sibling() || actor._prev;
      let next = actor._next; // get_next_sibling();
      if (prev && next && prev._icon && next._icon) {
        actor.translationX =
          ((prev._animationTranslationX ?? 0) + (next._animationTranslationX ?? 0)) / 2;
        actor.translationY =
          ((prev._animationTranslationY ?? 0) + (next._animationTranslationY ?? 0)) / 2;
        let thickness = dock.extension.separator_thickness || 0;
        if (vertical) {
          actor.width = iconSize * 0.5 * scaleFactor;
          actor.height = thickness * scaleFactor;
        } else {
          actor.width = thickness * scaleFactor;
          actor.height = iconSize * 0.75 * scaleFactor;
        }
        actor.visible = thickness > 0;
      }

      let any = next ?? prev;
      if (!vertical && any) {
        actor.translationY = any.height / 2 - actor.height / 2;
      } else if (vertical && any) {
        // actor.translationX = any.width / 2 - actor.width / 2;
      }
    });

    let targetX = 0;
    let targetY = 0;
    if (dock._hidden && dock.extension.autohide_dash) {
      if (isWithin) {
        dock.slideIn();
      }
    }

    const edgeDirectionMultiplier =
      dock._position == DockPosition.BOTTOM ||
      dock._position == DockPosition.RIGHT
        ? 1
        : -1;

    // if (!animated && !dock._hidden && dock.extension.peek_hidden_icons) {
    //   edge_distance = -dock._iconSizeScaledDown * scaleFactor / 1.5;
    // }

    //-------------------
    // animate slide in slide out
    //-------------------
    if (dock._hidden) {
      if (vertical) {
        if (dock._position == DockPosition.LEFT) {
          targetX =
            -(dock._background.width + edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        } else {
          targetX =
            (dock._background.width - edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        }
      } else {
        if (dock._position == DockPosition.BOTTOM) {
          targetY =
            (dock._background.height - edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        } else {
          targetY =
            -(dock._background.height + edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        }
      }
    }

    // edge
    if (vertical) {
      targetX += edge_distance * -edgeDirectionMultiplier;
    } else {
      targetY += edge_distance * -edgeDirectionMultiplier;
    }

    // dock translation
    {
      let autohide_slowDown = 1;
      let translationX = targetX;
      let translationY = targetY;
      let speed =
        ((150 + 300 * dock.extension.autohide_speed * scaleFactor) / 1000) *
        autohide_slowDown;

      let v1 = new Vector([targetX, targetY, 0]);
      let v2 = new Vector([dock.dash.translationX, dock.dash.translationY, 0]);
      let dst = v1.subtract(v2);
      let mag = dst.magnitude();
      if (mag > 0) {
        // let ndst = dst.normalize();
        let v3 = v2.add(dst.multiplyScalar(speed));
        translationX = v3.x;
        translationY = v3.y;
      }

      dock.dash.translationX = translationX;
      dock.dash.translationY = translationY;
    }

    // background
    {
      dock._background.style = dock.extension._backgroundStyle;
      dock._background.update({
        first,
        last,
        iconSize: dock._iconSizeScaledDown,
        scaleFactor,
        position: dock._position,
        vertical: vertical,
        panel_mode: dock.extension.panel_mode,
        dock,
      });
      dock._syncIconHitTargets?.();

      // allied areas
      //! this should be at the layout -- make independent of background
      // struts
      if (vertical) {
        dock.struts.width =
          (dock._modularViewport ? dock._restingWidth ?? iconSize * scaleFactor + 8 : dock._background.width) +
          iconSize * 0.2 * scaleFactor +
          edge_distance -
          dock._background._padding * scaleFactor;
        dock.struts.height = dock.height;

        if (dock.extension.autohide_dash) {
          dock.struts.y = dock._background.y + dock.y;
          dock.struts.height = dock._background.height;
          // X11 .. click through fix ..
          // dock.struts.width *= 1.25;
        }

        // dock.struts.y = dock.y;
        if (dock._position == DockPosition.RIGHT) {
          dock.struts.x = dock.x + dock.width - dock.struts.width;
        } else {
          dock.struts.x = dock.x;
        }
      } else {
        dock.struts.width = dock.width;
        dock.struts.height =
          dock._background.height +
          iconSize * 0.2 * scaleFactor +
          edge_distance -
          dock._background._padding * scaleFactor;

        if (dock.extension.autohide_dash) {
          dock.struts.x = dock._background.x + dock.x;
          dock.struts.width = dock._background.width;
          // X11 .. click through fix ..
          // dock.struts.height *= 1.25;
        }

        // dock.struts.x = dock.x;
        if (dock._position == DockPosition.BOTTOM) {
          dock.struts.y = dock.y + dock.height - dock.struts.height;
        } else {
          dock.struts.y = dock.y;
        }
      }

      dock._updateTransparenies();
    }

    dock.struts.visible = !dock._hidden && !m.inFullscreen && !dock._layoutSuppressed;
    dock.dash.opacity = 255;

    //---------------------
    // animate the list
    //---------------------
    if (dock._list && dock._list.visible && dock._list._target) {
      dock._list.animate(dt);
      didScale = true;
    }

    if (didFadeIn || didScale || dock._dragging || didBounce) {
      dock.autohider._debounceCheckHide();
      dock._debounceEndAnimation();
    }

    dock.extension.integrations.bms_update_size(this);
  }

  bounceIcon(appwell) {
    let dock = this.dock;
    let app_id = appwell._id;

    // let scaleFactor = dock.getMonitor().geometry_scale;
    //! why not scaleFactor?
    let travel =
      (dock._iconSize / 3) *
      ((0.25 + dock.extension.animation_bounce_height) * 1.5);
    // * scaleFactor;
    appwell.translation_y = 0;

    const getTarget = (app_id) => {
      if (dock._dragging) return [null, null];
      let icons = dock._findIcons();
      let icon = icons.find((icon) => {
        return icon._appwell && icon._appwell._id == app_id;
      });
      if (!icon || !icon._appwell) {
        return [null, null];
      }
      return [icon._appwell.get_parent(), icon._appwell];
    };

    const translateDecor = (container, appwell) => {
      try {
        if (!container._icon) return;
        if (container._renderer) {
          container._renderer.translationY = appwell.translationY;
        }
        if (container._image) {
          container._image.translationY = appwell.translationY;
        }
        if (container._badge) {
          container._badge.translationY = appwell.translationY;
        }
        if (container._label) {
          container._label.opacity = 0;
        }
      } catch (err) {
        console.log(err);
      }
    };

    let t = 250;
    let _frames = [
      {
        _duration: t,
        _func: (f, s) => {
          let res = Linear.easeNone(f._time, 0, travel, f._duration);
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            if (dock.isVertical()) {
              appwell.translation_x =
                dock._position == DockPosition.LEFT ? res : -res;
              if (container._renderer) {
                container._renderer.translationX = appwell.translationX;
              }
            } else {
              appwell.translation_y =
                dock._position == DockPosition.BOTTOM ? -res : res;
              if (container._renderer) {
                container._renderer.translationY = appwell.translationY;
              }
            }
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
      {
        _duration: t * 3,
        _func: (f, s) => {
          let res = Bounce.easeOut(f._time, travel, -travel, f._duration);
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            if (dock.isVertical()) {
              appwell.translation_x = appwell.translation_x =
                dock._position == DockPosition.LEFT ? res : -res;
              if (container._renderer) {
                container._renderer.translationX = appwell.translationX;
              }
            } else {
              appwell.translation_y =
                dock._position == DockPosition.BOTTOM ? -res : res;
              if (container._renderer) {
                container._renderer.translationY = appwell.translationY;
              }
            }
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
    ];

    let frames = [];
    for (
      let i = 0;
      i < [3, 1, 2, 3][dock.extension.animation_bounce_frequency || 0];
      i++
    ) {
      _frames.forEach((b) => {
        frames.push({
          ...b,
        });
      });
    }

    dock.extension._hiTimer.runAnimation([
      ...frames,
      {
        _duration: 10,
        _func: (f, s) => {
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            appwell.translation_y = 0;
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
      {
        _duration: 10,
        _func: (f, s) => {
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = false;
          } catch (err) {
            console.log(err);
          }
        },
      },
    ]);
  }
};
