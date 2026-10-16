// Spotlight: global signal connections
// SPDX-License-Identifier: GPL-3.0-or-later
import Shell from 'gi://Shell';
import St from 'gi://St';

// Connects global signals that live for the entire popup lifetime, across
// open and close cycles. Uses plain connect with explicit IDs so defense
// uninstall cannot accidentally wipe these.
export function connectGlobalSignals(popup, settings, ifaceSettings) {
    popup._windowCreatedId = global.display.connect(
        'window-created', () => { if (popup._visible) popup.close(); },
    );
    popup._appStateChangedId = Shell.AppSystem.get_default().connect(
        'app-state-changed', () => { if (popup._visible) popup.close(); },
    );
    ifaceSettings.connectObject(
        'changed::color-scheme', () => {
            if (popup._visible &&
                settings.get_string('theme-preference') === 'default')
                popup._syncTheme();
        },
        popup,
    );
    popup._stSettings = St.Settings.get();
    popup._stSettings.connectObject(
        'notify::color-scheme', () => {
            if (popup._visible && settings.get_string('theme-preference') === 'default')
                popup._syncTheme();
        },
        popup,
    );
    settings.connectObject(
        'changed::theme-preference', () => {
            if (popup._visible)
                popup._syncTheme();
        },
        popup,
    );
}

// Disconnects the global signals. Plain-connect IDs are cleaned explicitly,
// ifaceSettings uses connectObject and is cleaned via disconnectObject.
export function disconnectGlobalSignals(popup) {
    if (popup._windowCreatedId) {
        global.display.disconnect(popup._windowCreatedId);
        popup._windowCreatedId = 0;
    }
    if (popup._appStateChangedId) {
        Shell.AppSystem.get_default().disconnect(popup._appStateChangedId);
        popup._appStateChangedId = 0;
    }
    popup._ifaceSettings.disconnectObject(popup);
    popup._stSettings.disconnectObject(popup);
    popup._stSettings = null;
    popup._settings.disconnectObject(popup);
}
