// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Amir Hossein Karimi

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class GapManager {
    constructor(settings) {
        this._settings = settings;
        this._actors = [];
    }

    rebuild() {
        // Guard against calls during shutdown/reload when layoutManager
        // or monitors are gone. Note: when Tiling Shell is also enabled
        // with outer gaps > 0, both extensions shrink the work area
        // (Window Gap via struts, Tiling Shell via its own outer gaps),
        // so the visible margin doubles. Disable outer gaps in one of
        // the two extensions if that is not wanted.
        try {
            if (!Main.layoutManager || !Main.layoutManager.monitors)
                return;
        } catch (e) {
            return;
        }
        const margins = this._getMargins();
        const edges = [];

        for (const monitor of Main.layoutManager.monitors) {
            // Keep a usable work area even on tiny virtual displays.
            const horizontalScale = Math.min(1,
                Math.max(0, monitor.width - 1) / Math.max(1, margins.left + margins.right));
            const verticalScale = Math.min(1,
                Math.max(0, monitor.height - 1) / Math.max(1, margins.top + margins.bottom));
            const top = Math.floor(margins.top * verticalScale);
            const bottom = Math.floor(margins.bottom * verticalScale);
            const left = Math.floor(margins.left * horizontalScale);
            const right = Math.floor(margins.right * horizontalScale);
            if (top > 0)
                edges.push([monitor.x, monitor.y, monitor.width, top]);

            if (bottom > 0) {
                edges.push([
                    monitor.x,
                    monitor.y + monitor.height - bottom,
                    monitor.width,
                    bottom,
                ]);
            }

            if (left > 0)
                edges.push([monitor.x, monitor.y, left, monitor.height]);

            if (right > 0) {
                edges.push([
                    monitor.x + monitor.width - right,
                    monitor.y,
                    right,
                    monitor.height,
                ]);
            }
        }

        // Updating actors preserves Shell's chrome tracking and avoids destroying
        // and recreating four actors per monitor for every preferences change.
        const replaceActor = (index, x, y, width, height) => {
            const old = this._actors[index];
            if (old) {
                try {
                    Main.layoutManager.removeChrome(old);
                } catch (e) {
                    // layoutManager gone during shutdown
                }
                try {
                    if (typeof old.is_destroyed !== 'function' || !old.is_destroyed())
                        old.destroy();
                } catch (e) {
                    // already disposed from C
                }
            }
            this._actors[index] = this._createEdge(x, y, width, height);
        };
        edges.forEach(([x, y, width, height], index) => {
            let actor = this._actors[index];
            try {
                if (actor && typeof actor.is_destroyed === 'function' && actor.is_destroyed()) {
                    actor = null;
                }
            } catch (e) {
                actor = null;
            }
            if (actor) {
                try {
                    actor.set_position(x, y);
                    actor.set_size(width, height);
                } catch (e) {
                    // Actor disposed from C during shutdown; replace in place
                    replaceActor(index, x, y, width, height);
                }
            } else {
                replaceActor(index, x, y, width, height);
            }
        });
        for (const actor of this._actors.splice(edges.length)) {
            if (!actor)
                continue;
            try {
                Main.layoutManager.removeChrome(actor);
            } catch (e) {
                // layoutManager gone during shutdown
            }
            try {
                actor.destroy();
            } catch (e) {
                // already disposed from C
            }
        }
    }

    destroy() {
        this._destroyActors();
        this._settings = null;
    }

    _getMargins() {
        if (this._settings.get_boolean('uniform')) {
            const size = this._settings.get_int('gap-size');
            return { top: size, bottom: size, left: size, right: size };
        }

        return {
            top: this._settings.get_int('margin-top'),
            bottom: this._settings.get_int('margin-bottom'),
            left: this._settings.get_int('margin-left'),
            right: this._settings.get_int('margin-right'),
        };
    }

    _createEdge(x, y, width, height) {
        try {
            const actor = new Clutter.Actor({
                reactive: false,
                width,
                height,
                x,
                y,
                opacity: 0,
            });

            // GNOME 50 removed affectsInputRegion from addChrome params
            Main.layoutManager.addChrome(actor, {
                affectsStruts: true,
            });

            return actor;
        } catch (e) {
            return null;
        }
    }

    _addEdge(x, y, width, height) {
        const actor = this._createEdge(x, y, width, height);
        if (actor)
            this._actors.push(actor);
    }

    _destroyActors() {
        for (const actor of this._actors) {
            if (!actor)
                continue;
            try {
                Main.layoutManager.removeChrome(actor);
            } catch (e) {
                // layoutManager gone during shutdown
            }
            try {
                actor.destroy();
            } catch (e) {
                // already disposed from C
            }
        }
        this._actors = [];
    }
}
