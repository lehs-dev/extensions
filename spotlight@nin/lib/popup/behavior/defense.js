// Spotlight: popup close defense layers
// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

function isInPopupMenu(actor) {
    for (let current = actor; current; current = current.get_parent()) {
        if (current.has_style_class_name?.('popup-menu'))
            return true;
    }
    return false;
}

// Installs the multi-layer close defense on a popup. Each layer catches a
// different activation path that the others might miss.
export function installCloseDefense(popup, search, entry) {
    // Native result activation closes through the search stealer. Closing on
    // pointer press would remove the result before its release can activate it.
    global.stage.connectObject(
        'captured-event', (actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS)
                return Clutter.EVENT_PROPAGATE;

            const key = event.get_key_symbol();
            const focus = global.stage.get_key_focus();
            if (isInPopupMenu(focus))
                return Clutter.EVENT_PROPAGATE;

            if (key === Clutter.KEY_Escape) {
                popup.close();
                return Clutter.EVENT_STOP;
            }

            // Down arrow: Navigate from entry to search results, or between results
            if (key === Clutter.KEY_Down) {
                if (!popup._visible || !search.visible)
                    return Clutter.EVENT_PROPAGATE;

                const focus = global.stage.get_key_focus();
                if (!focus || focus === entry || entry.contains(focus)) {
                    if (search.navigate_focus(null, St.DirectionType.TAB_FORWARD, false) ||
                        search.navigate_focus(null, St.DirectionType.DOWN, false)) {
                        return Clutter.EVENT_STOP;
                    }
                } else if (search.contains(focus)) {
                    if (search.navigate_focus(focus, St.DirectionType.TAB_FORWARD, false) ||
                        search.navigate_focus(focus, St.DirectionType.DOWN, false)) {
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_STOP;
            }

            // Up arrow: Navigate backwards through results or return to search entry
            if (key === Clutter.KEY_Up) {
                if (!popup._visible)
                    return Clutter.EVENT_PROPAGATE;

                const focus = global.stage.get_key_focus();
                if (focus && search.contains(focus)) {
                    const moved = search.navigate_focus(focus, St.DirectionType.TAB_BACKWARD, false) ||
                                  search.navigate_focus(focus, St.DirectionType.UP, false);
                    if (!moved) {
                        entry.grab_key_focus();
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            // Typing redirect: typing letters or Backspace while a result is focused returns focus to entry
            const unicode = Clutter.keysym_to_unicode(key);
            if ((unicode >= 0x20 && key !== Clutter.KEY_space) || key === Clutter.KEY_BackSpace) {
                const focus = global.stage.get_key_focus();
                if (focus && focus !== entry && !entry.contains(focus) && popup.contains(focus)) {
                    entry.grab_key_focus();
                    // Capture keeps its original target even after focus moves.
                    search._text.event(event, false);
                    return Clutter.EVENT_STOP;
                }
            }

            if (key === Clutter.KEY_Return ||
                key === Clutter.KEY_KP_Enter ||
                key === Clutter.KEY_space) {
                const focus = global.stage.get_key_focus();
                if (focus &&
                    focus !== entry &&
                    !entry.contains(focus) &&
                    popup.contains(focus)) {
                    popup.close();
                }
            }

            return Clutter.EVENT_PROPAGATE;
        },
        popup,
    );

    // Close on key-focus loss unless focus moved to a popup-menu.
    global.stage.connectObject(
        'notify::key-focus', () => {
            if (!popup._visible)
                return;
            const focus = global.stage.get_key_focus();

            if (!focus) {
                entry.grab_key_focus();
                return;
            }

            if (entry && (entry === focus || entry.contains(focus)))
                return;

            if (popup.contains(focus))
                return;

            if (isInPopupMenu(focus))
                return;

            popup.close();
        },
        popup,
    );

    // Layer 3: external app focus at the window manager level. Catches web
    // search opening in a browser and any activation that shifts focus outside
    // the GNOME Shell stage. Uses plain connect so defense uninstall cannot
    // wipe persistent signals on global.display that share the popup owner.
    popup._focusWindowId = global.display.connect(
        'notify::focus-window', () => {
            if (!popup._visible)
                return;
            if (global.display.focus_window !== null)
                popup.close();
        },
    );
}

// Disconnects all defense handlers. Stage and search signals use
// connectObject with the popup owner. The focus-window signal on global.display
// uses plain connect with an explicit ID to avoid colliding with persistent
// signals that share the same owner.
export function uninstallCloseDefense(popup, search) {
    global.stage.disconnectObject(popup);
    if (popup._focusWindowId) {
        global.display.disconnect(popup._focusWindowId);
        popup._focusWindowId = 0;
    }
    if (search)
        search.disconnectObject(popup);
}
