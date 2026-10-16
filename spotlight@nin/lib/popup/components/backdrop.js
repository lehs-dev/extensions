// Spotlight: click-outside backdrop for the popup
// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Handles its own chrome lifecycle so spotlightPopup.js can just call show and
// destroy without needing to know how the backdrop actually gets on screen.
export class PopupBackdrop {
    constructor(onClickOutside, monitor) {
        // Catch outside clicks without painting over the desktop.
        this._actor = new St.Widget({
            style_class: 'spotlight-backdrop',
            reactive: true,
            can_focus: false,
            visible: false,
        });
        // Covers only the target monitor. Users on other monitors keep working normally.
        this._actor.set_size(monitor.width, monitor.height);
        this._actor.set_position(monitor.x, monitor.y);

        // Clicks outside land here before reaching the stage, which is the whole point.
        this._actor.connectObject('button-release-event', () => {
            onClickOutside();
            return Clutter.EVENT_STOP;
        }, this._actor);
    }

    show() {
        Main.layoutManager.addChrome(this._actor);
        this._actor.show();
    }

    destroy() {
        this._actor.remove_all_transitions();
        this._actor.disconnectObject(this._actor);
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
    }
}
