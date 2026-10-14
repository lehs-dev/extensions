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
let _childAddedId = null;
const _groups = new Map();
const _animations = new Map();
const _hiddenBackgrounds = new Map();
let _monitorInitOverride = null;
let _easePropertyOverride = null;
let _generation = 0;

function _restoreHiddenBackgrounds() {
  for (const [actor, record] of _hiddenBackgrounds) {
    actor.disconnect(record.destroyId);
    actor.visible = record.visible;
  }
  _hiddenBackgrounds.clear();
}

function _releaseGroup(group, destroyed = false) {
  const record = _groups.get(group);
  if (!record)
    return;
  _groups.delete(group);
  if (destroyed) {
    _animations.delete(group);
  } else {
    group.disconnect(record.destroyId);
    group.set_style(record.style);
    for (const [background, opacity] of record.backgrounds)
      background.opacity = opacity;
  }
  record.bgManager.destroy();
  if (!destroyed)
    record.container.destroy();
  if (_groups.size === 0)
    _restoreHiddenBackgrounds();
}

export default class Extension {
  enable() {
    if (_origMonitorInit) return;
    const generation = ++_generation;

    _origMonitorInit = WorkspaceAnimation.MonitorGroup.prototype._init;
    const originalMonitorInit = _origMonitorInit;

    _monitorInitOverride = function(monitor, workspaceIndices, movingWindow) {
      originalMonitorInit.call(this, monitor, workspaceIndices, movingWindow);
      if (generation !== _generation)
        return;
      const style = this.get_style();
      const backgrounds = this._workspaceGroups
        .filter(group => group._background)
        .map(group => [group._background, group._background.opacity]);

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

      const destroyId = this.connect('destroy', () => _releaseGroup(this, true));
      _groups.set(this, {style, backgrounds, container, bgManager, destroyId});
    };
    WorkspaceAnimation.MonitorGroup.prototype._init = _monitorInitOverride;

    _origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
    const originalEaseProperty = _origEaseProperty;
    _easePropertyOverride = function(property, value, params = {}) {
      if (generation !== _generation) {
        originalEaseProperty.call(this, property, value, params);
        return;
      }
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
        _animations.delete(this);
        this._container.remove_transition('translation_x');
        this._container.remove_transition('translation_y');
        this._container.translation_x = 0;
        this._container.translation_y = 0;
      }

      if (bounce) {
        const animation = {target: value, params};
        _animations.set(this, animation);
        originalEaseProperty.call(this, property, bounce.target, {
          ...params,
          duration: bounce.slideDuration,
          mode: Clutter.AnimationMode.EASE_OUT_SINE,
          onStopped: undefined,
          onComplete: () => {
            if (_animations.get(this) !== animation || this.get_stage() === null)
              return;
            const {x, y} = _bounceTranslation(this, bounce.overshootPx);
            this._container.translation_x = x;
            this._container.translation_y = y;
            this._container.ease({
              translation_x: 0,
              translation_y: 0,
              duration: bounce.returnDuration,
              mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
              onComplete: () => {
                if (_animations.get(this) !== animation)
                  return;
                _animations.delete(this);
                params.onComplete?.();
              },
              onStopped: finished => {
                if (_animations.get(this) !== animation)
                  return;
                if (!finished)
                  _animations.delete(this);
                params.onStopped?.(finished);
              },
            });
          },
        });
        return;
      }

      originalEaseProperty.call(this, property, value, params);
    };
    WorkspaceAnimation.MonitorGroup.prototype.ease_property = _easePropertyOverride;

    // Hide wallpaper panels other extensions add while a switch runs.
    _childAddedId = Main.uiGroup.connect('child-added', (_, actor) => {
      if (_groups.size > 0 && actor instanceof Meta.BackgroundGroup &&
          !_hiddenBackgrounds.has(actor)) {
        const visible = actor.visible;
        const destroyId = actor.connect('destroy', () => _hiddenBackgrounds.delete(actor));
        _hiddenBackgrounds.set(actor, {visible, destroyId});
        actor.visible = false;
      }
    });

    console.log(`[static-workspace-background] enabled`);
  }

  disable() {
    _generation++;
    if (_childAddedId) {
      Main.uiGroup.disconnect(_childAddedId);
      _childAddedId = null;
    }

    if (_origMonitorInit) {
      if (WorkspaceAnimation.MonitorGroup.prototype._init === _monitorInitOverride)
        WorkspaceAnimation.MonitorGroup.prototype._init = _origMonitorInit;
      _origMonitorInit = null;
      _monitorInitOverride = null;
    }

    if (_origEaseProperty) {
      if (WorkspaceAnimation.MonitorGroup.prototype.ease_property === _easePropertyOverride)
        WorkspaceAnimation.MonitorGroup.prototype.ease_property = _origEaseProperty;
      _origEaseProperty = null;
      _easePropertyOverride = null;
    }

    // Finish Shell's switch callback so its modal grab and compositor inhibit
    // are released, even when disabled during either phase of the bounce.
    const animations = [..._animations];
    _animations.clear();
    for (const group of [..._groups.keys()])
      _releaseGroup(group);
    _restoreHiddenBackgrounds();
    const completions = [];
    for (const [group, animation] of animations) {
      if (group.get_stage() === null)
        continue;
      group.remove_transition('progress');
      group._container.remove_transition('translation_x');
      group._container.remove_transition('translation_y');
      group._container.translation_x = 0;
      group._container.translation_y = 0;
      group.progress = animation.target;
      completions.push(animation.params);
    }
    for (const params of completions) {
      params.onStopped?.(true);
      params.onComplete?.();
    }

    console.log(`[static-workspace-background] disabled`);
  }
}
