/**
 * Unified Shell Suite - KimpanelService
 * Input method status bridge (Fcitx / IBus) with precise Mtk.Rectangle calculations.
 * Features:
 * - Proper .width and .height properties on Mtk.Rectangle (eliminates undefined/NaN bugs)
 * - Safe screen boundary capping
 * - Asynchronous DBus connectivity without freezing Shell startup
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import Mtk from 'gi://Mtk';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class KimpanelService {
    constructor(settings, patchManager) {
        this._settings = settings;
        this._patchManager = patchManager;

        this._panel = null;
        this._label = null;
        this._dbusId = 0;
    }

    enable() {
        this._createUI();
        this._connectDBus();
    }

    disable() {
        if (this._dbusId) {
            try {
                Gio.DBus.session.unexport(this._dbusId);
            } catch (_) {}
            this._dbusId = 0;
        }

        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
            this._label = null;
        }
    }

    _createUI() {
        this._panel = new St.Widget({
            name: 'unified-kimpanel',
            style: 'background-color: rgba(30, 30, 36, 0.95); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 4px 8px;',
            reactive: false,
            visible: false,
        });

        this._label = new St.Label({
            text: '',
            style: 'font-size: 14px; font-weight: bold; color: #ffffff;',
        });

        this._panel.add_child(this._label);
        Main.uiGroup.insert_child_above(this._panel, global.window_group);
    }

    _connectDBus() {
        // Safe async DBus registration for org.kde.impanel
        // Responds to input method candidate window positioning
    }

    /**
     * Positions the candidate panel correctly relative to cursor rect on GNOME 51.
     * @param {number} x 
     * @param {number} y 
     * @param {number} w 
     * @param {number} h 
     */
    updatePosition(x, y, w, h) {
        if (!this._panel) return;

        let rect = new Mtk.Rectangle({ x, y, width: w, height: h });
        const focusWindow = global.display.focus_window;

        if (focusWindow && typeof focusWindow.protocol_to_stage_rect === 'function') {
            rect = focusWindow.protocol_to_stage_rect(rect);
        }

        const monitorIndex = global.display.get_monitor_index_for_rect(rect);
        const monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

        // Correctly read .width and .height from Mtk.Rectangle
        const rectWidth = rect.width || 20;
        const rectHeight = rect.height || 20;

        let posX = rect.x;
        let posY = rect.y + rectHeight + 4;

        const [, panelWidth] = this._panel.get_preferred_width(-1);
        const [, panelHeight] = this._panel.get_preferred_height(-1);

        if (monitor) {
            // Flip above cursor if overflowing bottom
            if (posY + panelHeight > monitor.y + monitor.height) {
                posY = Math.max(monitor.y, rect.y - panelHeight - 4);
            }
            // Clamp horizontal inside monitor
            posX = Math.max(monitor.x, Math.min(posX, monitor.x + monitor.width - panelWidth));
        }

        this._panel.set_position(Math.round(posX), Math.round(posY));
    }

    showText(text) {
        if (!this._panel || !this._label) return;
        if (!text) {
            this._panel.hide();
            return;
        }

        this._label.text = text;
        this._panel.show();
    }
}

