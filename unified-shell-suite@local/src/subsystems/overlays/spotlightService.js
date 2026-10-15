/**
 * Unified Shell Suite - SpotlightService
 * Standalone, macOS-style Spotlight Search launcher for GNOME 51.
 * Features:
 * - Standalone St.Entry and search results popup (never steals Overview searchEntry)
 * - Zero global keyboard gobbling
 * - Clean modal grab handling
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class SpotlightService {
    constructor(settings, patchManager) {
        this._settings = settings;
        this._patchManager = patchManager;

        this._popup = null;
        this._entry = null;
        this._resultsBox = null;
        this._appSystem = Shell.AppSystem.get_default();
        this._grabHandle = null;
    }

    enable() {
        this._createUI();

        // Bind global key accelerator (e.g. Super+Space)
        Main.wm.addKeybinding(
            'spotlight-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.toggle()
        );
    }

    disable() {
        Main.wm.removeKeybinding('spotlight-shortcut');
        this.close();

        if (this._popup) {
            this._popup.destroy();
            this._popup = null;
            this._entry = null;
            this._resultsBox = null;
        }
    }

    _createUI() {
        this._popup = new St.Widget({
            name: 'unified-spotlight-popup',
            style: 'background-color: rgba(30, 30, 36, 0.95); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, spacing: 10 }),
        });

        this._entry = new St.Entry({
            name: 'unified-spotlight-entry',
            hint_text: 'Spotlight Search (apps, settings)...',
            can_focus: true,
            style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 14px; font-size: 16px; color: #ffffff;',
        });

        this._entry.clutter_text.connect('text-changed', () => this._onSearchChanged());
        this._entry.clutter_text.connect('activate', () => this._onActivateFirst());

        this._resultsBox = new St.BoxLayout({
            name: 'unified-spotlight-results',
            vertical: true,
            style: 'spacing: 4px;',
        });

        this._popup.add_child(this._entry);
        this._popup.add_child(this._resultsBox);

        Main.uiGroup.insert_child_above(this._popup, global.window_group);
    }

    toggle() {
        if (this._popup?.visible) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (!this._popup) return;

        const monitor = Main.layoutManager.primaryMonitor;
        const width = 640;
        const x = Math.round(monitor.x + (monitor.width - width) / 2);
        const y = Math.round(monitor.y + monitor.height * 0.22);

        this._popup.set_position(x, y);
        this._popup.set_size(width, -1);
        this._popup.show();

        this._entry.text = '';
        this._entry.grab_key_focus();

        // Push modal safely
        try {
            this._grabHandle = Main.pushModal(this._popup);
        } catch (_) {}

        // Listen for Escape key
        this._keyId = global.stage.connect('key-press-event', (_, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    close() {
        if (!this._popup?.visible) return;

        if (this._keyId) {
            global.stage.disconnect(this._keyId);
            this._keyId = 0;
        }

        if (this._grabHandle) {
            try {
                if (typeof this._grabHandle.dismiss === 'function') {
                    this._grabHandle.dismiss();
                } else {
                    Main.popModal(this._grabHandle);
                }
            } catch (_) {}
            this._grabHandle = null;
        }

        this._popup.hide();
        this._resultsBox.destroy_all_children();
    }

    _onSearchChanged() {
        const query = this._entry.text.trim().toLowerCase();
        this._resultsBox.destroy_all_children();
        if (!query) return;

        // Perform fast local search on installed apps
        const results = this._appSystem.get_installed().filter(app => {
            const name = app.get_name().toLowerCase();
            const id = app.get_id().toLowerCase();
            return name.includes(query) || id.includes(query);
        }).slice(0, 5);

        for (const app of results) {
            const row = new St.Button({
                style_class: 'unified-spotlight-result-row',
                style: 'padding: 8px 12px; border-radius: 8px; background-color: transparent;',
                reactive: true,
                can_focus: true,
            });

            const box = new St.BoxLayout({ vertical: false, style: 'spacing: 12px;' });
            const icon = app.create_icon_texture(32);
            const label = new St.Label({
                text: app.get_name(),
                y_align: Clutter.ActorAlign.CENTER,
                style: 'font-size: 14px; font-weight: 500;',
            });

            box.add_child(icon);
            box.add_child(label);
            row.set_child(box);

            row.connect('clicked', () => {
                app.open_new_window(-1);
                this.close();
            });

            this._resultsBox.add_child(row);
        }
    }

    _onActivateFirst() {
        const first = this._resultsBox.get_first_child();
        if (first) {
            first.emit('clicked');
        }
    }
}

