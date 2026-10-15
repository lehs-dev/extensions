/**
 * Unified Shell Suite - BlurEngine
 * Clean, hardware-accelerated background blur using native Shell.BlurEffect.
 * Eliminates custom paint_signals loops, CPU leaks, and shader compilation blocks.
 */

import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_PANEL_EFFECT = 'unified-blur-panel';
const BLUR_OVERVIEW_EFFECT = 'unified-blur-overview';

export class BlurEngine {
    constructor(settings) {
        this._settings = settings;
        this._panelEffect = null;
        this._overviewEffect = null;
    }

    enable() {
        this.update();
    }

    update() {
        const isEnabled = this._settings.get_boolean('blur-enabled');
        const sigma = this._settings.get_int('blur-sigma') || 30;
        const blurPanel = this._settings.get_boolean('blur-panel');
        const blurOverview = this._settings.get_boolean('blur-overview');

        // 1. Panel Blur
        if (isEnabled && blurPanel) {
            if (!this._panelEffect) {
                this._panelEffect = new Shell.BlurEffect({
                    mode: Shell.BlurEffectMode.BACKGROUND,
                });
                Main.panel.add_effect_with_name(BLUR_PANEL_EFFECT, this._panelEffect);
            }
            this._panelEffect.set_sigma(sigma);
        } else {
            this._removePanelBlur();
        }

        // 2. Overview Blur
        if (isEnabled && blurOverview && Main.overview?._overview) {
            if (!this._overviewEffect) {
                this._overviewEffect = new Shell.BlurEffect({
                    mode: Shell.BlurEffectMode.BACKGROUND,
                });
                Main.overview._overview.add_effect_with_name(BLUR_OVERVIEW_EFFECT, this._overviewEffect);
            }
            this._overviewEffect.set_sigma(sigma);
        } else {
            this._removeOverviewBlur();
        }
    }

    _removePanelBlur() {
        if (this._panelEffect) {
            try {
                Main.panel.remove_effect_by_name(BLUR_PANEL_EFFECT);
            } catch (_) {}
            this._panelEffect = null;
        }
    }

    _removeOverviewBlur() {
        if (this._overviewEffect && Main.overview?._overview) {
            try {
                Main.overview._overview.remove_effect_by_name(BLUR_OVERVIEW_EFFECT);
            } catch (_) {}
            this._overviewEffect = null;
        }
    }

    disable() {
        this._removePanelBlur();
        this._removeOverviewBlur();
    }
}

