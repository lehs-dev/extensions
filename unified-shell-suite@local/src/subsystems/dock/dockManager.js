/**
 * Unified Shell Suite - DockManager
 * High-performance, VSync-synchronized application dock for GNOME 51.
 * Features:
 * - 100% Clutter timeline animations (zero out-of-sync timers)
 * - Zero blocking disk I/O (pure in-memory CSS/styling)
 * - Smooth hover magnification and autohide
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class DockManager {
    constructor(settings, patchManager) {
        this._settings = settings;
        this._patchManager = patchManager;

        this._container = null;
        this._dockBox = null;
        this._appSystem = Shell.AppSystem.get_default();
        this._favSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
    }

    enable() {
        this._createDockUI();
        this._populateApps();

        // Listen for app updates
        this._patchManager.connectSignal(
            this._appSystem,
            'installed-changed',
            () => this._populateApps()
        );

        this._patchManager.connectSignal(
            this._favSettings,
            'changed::favorite-apps',
            () => this._populateApps()
        );

        // Update layout on monitor changes
        this._patchManager.connectSignal(
            Main.layoutManager,
            'monitors-changed',
            () => this._updatePosition()
        );

        this._updatePosition();
    }

    disable() {
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
            this._dockBox = null;
        }
    }

    _createDockUI() {
        this._container = new St.Widget({
            name: 'unified-dock-container',
            reactive: true,
            track_hover: true,
        });

        this._dockBox = new St.BoxLayout({
            name: 'unified-dock-box',
            style_class: 'unified-dock-box',
            style: 'background-color: rgba(20, 20, 24, 0.75); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 6px 10px;',
            vertical: false,
            reactive: true,
        });

        this._container.add_child(this._dockBox);
        Main.layoutManager.addChrome(this._container, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        // Autohide hover triggers
        this._container.connect('enter-event', () => this._onHoverEnter());
        this._container.connect('leave-event', () => this._onHoverLeave());
    }

    _onHoverEnter() {
        if (!this._settings.get_boolean('dock-autohide')) return;
        this._container.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onHoverLeave() {
        if (!this._settings.get_boolean('dock-autohide')) return;
        this._container.ease({
            opacity: 120,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _updatePosition() {
        if (!this._container) return;

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const [, natWidth] = this._dockBox.get_preferred_width(-1);
        const [, natHeight] = this._dockBox.get_preferred_height(-1);

        const x = Math.round(monitor.x + (monitor.width - natWidth) / 2);
        const y = Math.round(monitor.y + monitor.height - natHeight - 8);

        this._container.set_position(x, y);
        this._container.set_size(natWidth, natHeight);
    }

    _populateApps() {
        if (!this._dockBox) return;

        this._dockBox.destroy_all_children();
        const iconSize = this._settings.get_int('dock-icon-size') || 48;
        const favIds = this._favSettings.get_strv('favorite-apps');

        for (const appId of favIds) {
            const app = this._appSystem.lookup_app(appId);
            if (!app) continue;

            const button = new St.Button({
                style_class: 'unified-dock-app-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const icon = app.create_icon_texture(iconSize);
            button.set_child(icon);

            // Smooth hardware-accelerated icon scaling on hover
            button.connect('enter-event', () => {
                button.ease({
                    scale_x: 1.18,
                    scale_y: 1.18,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });

            button.connect('leave-event', () => {
                button.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });

            button.connect('clicked', () => {
                app.open_new_window(-1);
            });

            this._dockBox.add_child(button);
        }

        this._updatePosition();
    }
}

