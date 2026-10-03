/*
 * Static Workspace Background extension for GNOME Shell 48+
 * Copyright 2026 Cleo Menezes Jr.
 *
 * Inspired by V-Shell
 * Copyright 2022-2025 GdH and JianZcar
 *
 * This software is released under the GNU General Public License v3 or later.
 * See <http://www.gnu.org/licenses/> for details.
 */

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

import { computeBounceParams } from './bounce.js';

function _createStaticBackground(monitor) {
  const container = new Meta.BackgroundGroup();

  const bgManager = new Background.BackgroundManager({
    container,
    monitorIndex: monitor.index,
    controlPosition: false,
  });

  return {container, bgManager};
}

function _bounceTranslation(group, overshoot) {
  if (global.workspace_manager.layout_rows === -1)
    return {x: 0, y: -overshoot};
  if (group.get_text_direction() === Clutter.TextDirection.RTL)
    return {x: overshoot, y: 0};
  return {x: -overshoot, y: 0};
}

let _origMonitorInit = null;
let _origEaseProperty = null;
let _groupsActive = 0;
let _childAddedId = null;

export default class Extension {
  enable() {
    if (_origMonitorInit) return;

    _origMonitorInit = WorkspaceAnimation.MonitorGroup.prototype._init;

    WorkspaceAnimation.MonitorGroup.prototype._init = function(monitor, workspaceIndices, movingWindow) {
      _origMonitorInit.call(this, monitor, workspaceIndices, movingWindow);

      // Theme uses opaque .workspace-animation; cloned wallpapers hide real windows.
      // Static wallpaper must override this.
      this.set_style('background-color: transparent;');
      this._workspaceGroups.forEach(group => {
        if (group._background)
          group._background.opacity = 0;
      });

      // Clones slide over _container and sticky group.
      const {container, bgManager} = _createStaticBackground(monitor);
      this.insert_child_below(container, null);

      this.connect('destroy', () => {
        _groupsActive--;
        bgManager.destroy();
      });

      _groupsActive++;
    };

    _origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
    WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
      const bounce = property === 'progress'
        ? computeBounceParams({
            duration: params.duration,
            target: value,
            current: this.progress,
          })
        : null;

      // Overshoot in translation_x/y keeps progress in [0,1]; outside it the
      // adjustment binding yields NaN. Reset so an interrupted one doesn't offset.
      if (property === 'progress') {
        this._container.remove_transition('translation_x');
        this._container.remove_transition('translation_y');
        this._container.translation_x = 0;
        this._container.translation_y = 0;
      }

      if (bounce) {
        console.log(`[static-workspace-background] bounce ${bounce.slideDuration}ms +${bounce.returnDuration}ms`);
        _origEaseProperty.call(this, property, bounce.target, {
          duration: bounce.slideDuration,
          mode: Clutter.AnimationMode.EASE_OUT_SINE,
          onComplete: () => {
            if (this.get_stage() === null)
              return;
            const {x, y} = _bounceTranslation(this, bounce.overshootPx);
            this._container.translation_x = x;
            this._container.translation_y = y;
            this._container.ease({
              translation_x: 0,
              translation_y: 0,
              duration: bounce.returnDuration,
              mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
              onComplete: params.onComplete,
            });
          },
        });
        return;
      }

      _origEaseProperty.call(this, property, value, params);
    };

    // Hide wallpaper panels other extensions add while a switch runs.
    _childAddedId = Main.uiGroup.connect('child-added', (_, actor) => {
      if (_groupsActive > 0 && actor instanceof Meta.BackgroundGroup) {
        actor.visible = false;
      }
    });

    console.log(`[static-workspace-background] enabled`);
  }

  disable() {
    if (_childAddedId) {
      Main.uiGroup.disconnect(_childAddedId);
      _childAddedId = null;
    }

    if (_origMonitorInit) {
      WorkspaceAnimation.MonitorGroup.prototype._init = _origMonitorInit;
      _origMonitorInit = null;
    }

    if (_origEaseProperty) {
      WorkspaceAnimation.MonitorGroup.prototype.ease_property = _origEaseProperty;
      _origEaseProperty = null;
    }

    console.log(`[static-workspace-background] disabled`);
  }
}
