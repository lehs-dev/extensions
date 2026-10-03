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
        this._destroyActors();

        const margins = this._getMargins();

        for (const monitor of Main.layoutManager.monitors) {
            if (margins.top > 0)
                this._addEdge(monitor.x, monitor.y, monitor.width, margins.top);

            if (margins.bottom > 0) {
                this._addEdge(
                    monitor.x,
                    monitor.y + monitor.height - margins.bottom,
                    monitor.width,
                    margins.bottom
                );
            }

            if (margins.left > 0)
                this._addEdge(monitor.x, monitor.y, margins.left, monitor.height);

            if (margins.right > 0) {
                this._addEdge(
                    monitor.x + monitor.width - margins.right,
                    monitor.y,
                    margins.right,
                    monitor.height
                );
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
