import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

test('candidate highlight follows lookup cursor even when it equals the preedit caret', async () => {
    let Kimpanel;
    await loadModule('kimpanel@kde.org/extension.js', {
        mocks: {
            'gi://GObject': {default: {Object: Actor, registerClass: cls => { Kimpanel = cls; }}},
            'gi://Gio': {default: {}}, 'gi://GLib': {default: {}}, 'gi://Meta': {default: {}},
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
            './panel.js': {InputPanel: class {}}, './indicator.js': {KimIndicator: class {}},
            './menu.js': {KimMenu: class {}}, './lib.js': {},
        },
    });
    const panel = new Kimpanel();
    panel.pos = 0;
    panel.cursor = 2;
    let updates = 0;
    panel.updateInputPanel = () => updates++;
    const signal = () => panel._parseSignal(null, null, null, null,
        'UpdateLookupTableCursor', {deep_unpack: () => [0]});
    signal();
    assert.equal(updates, 1);
    assert.equal(panel.cursor, 0);
    signal();
    assert.equal(updates, 1);
});
