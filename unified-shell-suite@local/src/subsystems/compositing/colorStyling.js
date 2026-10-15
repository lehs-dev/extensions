/**
 * Unified Shell Suite - ColorStyling Component
 * Integrates clean light/dark style switching without side effects.
 */

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ColorStyling {
    constructor(settings) {
        this._settings = settings;
        this._savedColorScheme = null;
    }

    enable() {
        this._savedColorScheme = Main.sessionMode.colorScheme;
        this.update();
    }

    update() {
        const scheme = this._settings.get_string('color-scheme');
        if (scheme === 'prefer-light' || scheme === 'prefer-dark') {
            Main.sessionMode.colorScheme = scheme;
            St.Settings.get().notify('color-scheme');
        } else if (this._savedColorScheme) {
            Main.sessionMode.colorScheme = this._savedColorScheme;
            St.Settings.get().notify('color-scheme');
        }
    }

    disable() {
        if (this._savedColorScheme) {
            Main.sessionMode.colorScheme = this._savedColorScheme;
            St.Settings.get().notify('color-scheme');
            this._savedColorScheme = null;
        }
    }
}

