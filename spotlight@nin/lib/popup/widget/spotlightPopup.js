// Spotlight: popup widget and lifecycle orchestration
// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {PopupBackdrop} from '../components/backdrop.js';
import {PopupPositioner} from '../components/positioner.js';
import {OverviewSearchStealer} from '../../overview/searchStealer.js';
import {ThumbnailEnhancer} from '../../overview/thumbnails.js';
import {installCloseDefense, uninstallCloseDefense} from '../behavior/defense.js';
import {applyTheme} from '../behavior/theme.js';
import {scheduleIdle, cancelIdle, trackTextVisibility} from '../behavior/lifecycle.js';
import {connectGlobalSignals, disconnectGlobalSignals} from '../behavior/signals.js';

export const SpotlightPopup = GObject.registerClass(
class SpotlightPopup extends St.Widget {
    _init(settings) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            visible: false,
        });
        this._settings = settings;
        this._backdrop = null;
        this._positioner = new PopupPositioner(this);
        this._ifaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._visible = false;
        this._openIdleId = 0;
        this._closeIdleId = 0;
        this._opening = false;
        this._textChangedEventId = 0;

        this._content = new St.BoxLayout({
            style_class: 'spotlight-container',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this.add_child(this._content);

        this._stealer = new OverviewSearchStealer(this);
        this._thumbnailEnhancer = new ThumbnailEnhancer();
        connectGlobalSignals(this, this._settings, this._ifaceSettings);
    }

    stealOverviewSearch() {
        this._stealer.steal();
        this._thumbnailEnhancer.apply();
    }

    returnOverviewSearch() {
        this._syncClose();
        this._stealer.restore();
        this._thumbnailEnhancer.revert();
    }

    open() {
        cancelIdle(this, '_closeIdleId');
        if (this._visible) {
            this._stealer.entry?.grab_key_focus();
            return;
        }
        if (!this._stealer.entry || !this._stealer.search)
            return;

        this._opening = false;

        const entry = this._stealer.entry;
        const search = this._stealer.search;

        if (entry.get_parent())
            entry.get_parent().remove_child(entry);
        // The Overview may have faded the entry out before it was detached.
        entry.remove_transition('opacity');
        entry.opacity = 255;
        entry.visible = true;
        this._content.add_child(entry);

        if (search.get_parent())
            search.get_parent().remove_child(search);
        this._content.add_child(search);

        // Measure the empty entry before the first allocation, including on reopen.
        search._text.set_text('');
        search.visible = false;

        const monitor = this._positioner.getTargetMonitor();
        this._backdrop = new PopupBackdrop(() => this.close(), monitor);
        this._syncTheme();
        this._backdrop.show();

        if (this.get_parent())
            Main.layoutManager.removeChrome(this);
        Main.layoutManager.addChrome(this);

        this._positioner.showCentered();

        if (!this._textChangedEventId)
            this._textChangedEventId = trackTextVisibility(search);

        installCloseDefense(this, search, entry);
        this._visible = true;

        // Focus immediately so input can arrive during the opening animation.
        entry.grab_key_focus();
    }

    _syncTheme() {
        applyTheme(this._content, this._settings, this._ifaceSettings);
    }

    close() {
        if ((!this._visible && !this._opening) || this._closeIdleId !== 0)
            return;
        cancelIdle(this, '_openIdleId');
        this._opening = false;
        scheduleIdle(this, '_closeIdleId', () => this._doClose());
    }

    toggle() {
        if (this._visible && this._closeIdleId === 0)
            this.close();
        else
            this.open();
    }

    _doClose(animate = true) {
        this._positioner.stop();
        if (this._backdrop) {
            this._backdrop.destroy();
            this._backdrop = null;
        }

        uninstallCloseDefense(this, this._stealer.search);

        if (this._textChangedEventId) {
            this._stealer.search._text.disconnect(this._textChangedEventId);
            this._textChangedEventId = 0;
        }

        this._visible = false;
        const removeChrome = () => {
            // Keep the content intact until the fade finishes. Unmapping the
            // native controller resets its text and must happen after activation.
            this.hide();
            for (const actor of [this._stealer.entry, this._stealer.search]) {
                if (actor?.get_parent() === this._content)
                    this._content.remove_child(actor);
            }
            if (this.get_parent())
                Main.layoutManager.removeChrome(this);
        };
        if (animate) {
            this._animateClose(removeChrome);
        } else {
            this.hide();
            removeChrome();
        }
    }

    _syncClose() {
        cancelIdle(this, '_openIdleId');
        cancelIdle(this, '_closeIdleId');
        this._opening = false;
        if (this._visible)
            this._doClose(false);
        this._positioner.stop();
        this.remove_all_transitions();
        this.hide();
        if (this.get_parent())
            Main.layoutManager.removeChrome(this);
    }

    _animateClose(onComplete) {
        // An accessibility setting may change during an in-flight transition.
        this.remove_transition('opacity');
        this.remove_transition('scale-x');
        this.remove_transition('scale-y');
        const stSettings = St.Settings.get();
        if (stSettings && !stSettings.enable_animations) {
            this.hide();
            this.opacity = 255;
            this.scale_x = 1.0;
            this.scale_y = 1.0;
            onComplete();
            return;
        }
        this.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.hide();
                // Reset properties so the next open starts from a clean state.
                this.opacity = 255;
                this.scale_x = 1.0;
                this.scale_y = 1.0;
                onComplete();
            },
        });
    }

    destroy() {
        this._syncClose();
        disconnectGlobalSignals(this);
        this._content = null;
        this._settings = null;
        super.destroy();
    }
});
