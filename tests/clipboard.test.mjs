import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup() {
    let Indicator;
    let historyCallback;
    const queries = [];
    const mimeQueries = [];
    const stored = [];
    let privateMode = false;
    class Menu extends Actor {
        constructor(...args) { super(...args); this.actor = this; }
        addMenuItem(item) { this.add_child(item); }
    }
    const Main = {wm: {removeKeybinding() {}}, layoutManager: {
        primaryMonitor: {width: 1920}, findMonitorForActor: () => ({width: 1280})}};
    await loadModule('clipboard-history@alexsaveau.dev/extension.js', {
        globals: {global: {}},
        mocks: {
            'gi://Clutter': {default: {ActorAlign: {CENTER: 0}}},
            'gi://GObject': {default: {registerClass: cls => { Indicator = cls; return cls; }}},
            'gi://GLib': {default: {}},
            'gi://Meta': {default: {}},
            'gi://Shell': {default: {}},
            'gi://St': {default: {Clipboard: {get_default: () => ({
                get_text: (kind, callback) => queries.push({kind, callback}),
                get_mimetypes: kind => { mimeQueries.push(kind); return []; },
            })}, ClipboardType: {CLIPBOARD: 1, PRIMARY: 2}, Side: {BOTTOM: 0},
            BoxLayout: Actor, Label: Actor, Icon: Actor, Entry: Actor, ScrollView: Actor}},
            'resource:///org/gnome/shell/ui/main.js': Main,
            'resource:///org/gnome/shell/ui/messageTray.js': {},
            'resource:///org/gnome/shell/ui/panelMenu.js': {Button: Actor},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupBaseMenuItem: Menu,
                PopupMenuSection: Menu, PopupSeparatorMenuItem: Menu, PopupSwitchMenuItem: Menu},
            'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}, gettext: s => s},
            'resource:///org/gnome/shell/misc/animationUtils.js': {ensureActorVisibleInScrollView() {}},
            './store.js': {buildClipboardStateFromLog: callback => { historyCallback = callback; },
                storeTextEntry: text => stored.push(text)},
            './confirmDialog.js': {openConfirmDialog() {}},
        },
    });
    const indicator = new Indicator();
    indicator.menu = new Menu();
    indicator.settings = {
        get_int: () => 50,
        get_boolean: key => key === 'private-mode' ? privateMode : key === 'ignore-password-mimes',
    };
    indicator._shortcutsBindingIds = [];
    indicator._fetchSettings();
    return {indicator, queries, mimeQueries, stored,
        finishHistory: (...args) => historyCallback(...args),
        setPrivate: value => { privateMode = value; indicator._fetchSettings(); }};
}

test('history loading after disable never reconnects signals or touches destroyed UI', async () => {
    const {indicator, finishHistory} = await setup();
    indicator._updatePrivateModeState = () => {};
    indicator._buildMenu();
    indicator.destroy();
    finishHistory(null, null, 1);
    assert.equal(indicator._settingsChangedId, undefined);
    assert.equal(indicator.entries, undefined);
});

test('clipboard replies arriving after disable are ignored', async () => {
    const {indicator, queries} = await setup();
    indicator._queryClipboard();
    indicator._queryPrimaryClipboard();
    indicator.destroy();
    for (const query of queries)
        query.callback(null, 'late text');
});

test('private mode takes effect before an outstanding clipboard reply is consumed', async () => {
    const {indicator, queries, stored, setPrivate} = await setup();
    indicator.entries = {findTextItem: () => null, append() {}};
    indicator.favoriteEntries = {findTextItem: () => null};
    indicator._addEntry = indicator._pruneOldestEntries = () => {};
    indicator._queryClipboard();
    setPrivate(true);
    queries[0].callback(null, 'secret');
    assert.equal(stored.length, 0);
});

test('MIME checks use the correct clipboard selection enum', async () => {
    const {indicator, mimeQueries} = await setup();
    indicator._queryClipboard();
    indicator._queryPrimaryClipboard();
    assert.deepEqual(mimeQueries, [1, 2]);
});

test('previous/next shortcuts tolerate empty history and unfinished loading', async () => {
    const {indicator} = await setup();
    indicator._previousEntry();
    indicator._nextEntry();
    indicator.entries = {head: undefined, last: () => undefined};
    indicator._previousEntry();
    indicator._nextEntry();
});

test('menu width follows the panel monitor instead of the primary display', async () => {
    const {indicator} = await setup();
    indicator._setMenuWidth();
    assert.equal(indicator.menu.actor.width, 640);
});
