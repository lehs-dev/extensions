/**
 * Unified Shell Suite - StaticBackground Component
 * Preserves wallpaper stability during workspace transitions while maintaining 100% smooth 1:1 touchpad gestures.
 */

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import Meta from 'gi://Meta';

export class StaticBackground {
    constructor(patchManager) {
        this._patchManager = patchManager;
        this._groups = new Map();
    }

    _createStaticBackground(monitor) {
        const container = new Meta.BackgroundGroup();
        const bgManager = new Background.BackgroundManager({
            container,
            monitorIndex: monitor.index,
            controlPosition: false,
        });
        return { container, bgManager };
    }

    _releaseGroup(group) {
        const record = this._groups.get(group);
        if (!record) return;

        this._groups.delete(group);
        try {
            group.set_style(record.style);
            for (const [background, opacity] of record.backgrounds) {
                background.opacity = opacity;
            }
        } catch (_) {}

        try {
            record.bgManager.destroy();
            record.container.destroy();
        } catch (_) {}
    }

    enable() {
        const self = this;
        this._patchManager.hookMethod(
            WorkspaceAnimation.MonitorGroup.prototype,
            '_init',
            originalInit => function (monitor, workspaceIndices, movingWindow) {
                originalInit.call(this, monitor, workspaceIndices, movingWindow);

                const style = this.get_style();
                const backgrounds = (this._workspaceGroups || [])
                    .filter(group => group._background)
                    .map(group => [group._background, group._background.opacity]);

                this.set_style('background-color: transparent;');
                (this._workspaceGroups || []).forEach(group => {
                    if (group._background) {
                        group._background.opacity = 0;
                    }
                });

                const { container, bgManager } = self._createStaticBackground(monitor);
                this.insert_child_below(container, null);

                const destroyId = this.connect('destroy', () => self._releaseGroup(this));
                self._groups.set(this, { style, backgrounds, container, bgManager, destroyId });
            }
        );
    }

    disable() {
        for (const group of [...this._groups.keys()]) {
            this._releaseGroup(group);
        }
        this._groups.clear();
    }
}

