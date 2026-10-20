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
import Meta from 'gi://Meta';

import {MissionControlOverview} from './overview.js';

function _createStaticBackground(monitor) {
  const container = new Meta.BackgroundGroup();

  const bgManager = new Background.BackgroundManager({
    container,
    monitorIndex: monitor.index,
    controlPosition: false,
  });

  return {container, bgManager};
}

let _origMonitorInit = null;
let _childAddedId = null;
const _groups = new Map();
const _hiddenBackgrounds = new Map();
let _monitorInitOverride = null;
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
  if (!destroyed) {
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

    // Shell owns progress, cancellation and completion of workspace gestures.
    // A second animation on _container survives remove_all_transitions() on
    // MonitorGroup and keeps moving windows after a new swipe has begun.

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

    this._overview = new MissionControlOverview();
    this._overview.enable();

    console.log(`[static-workspace-background] enabled`);
  }

  disable() {
    this._overview?.disable();
    this._overview = null;
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

    for (const group of [..._groups.keys()])
      _releaseGroup(group);
    _restoreHiddenBackgrounds();

    console.log(`[static-workspace-background] disabled`);
  }
}
