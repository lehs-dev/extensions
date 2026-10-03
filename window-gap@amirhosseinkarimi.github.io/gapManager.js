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
        edges.forEach(([x, y, width, height], index) => {
            const actor = this._actors[index];
            if (actor) {
                actor.set_position(x, y);
                actor.set_size(width, height);
            } else {
                this._addEdge(x, y, width, height);
            }
        });
        for (const actor of this._actors.splice(edges.length)) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
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

    _addEdge(x, y, width, height) {
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

        this._actors.push(actor);
    }

    _destroyActors() {
        for (const actor of this._actors) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._actors = [];
    }
}
