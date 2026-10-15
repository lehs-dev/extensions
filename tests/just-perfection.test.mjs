import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup(version = 51, hasBin = true) {
    const display = new Actor();
    const {API} = await loadModule('just-perfection-desktop@just-perfection/lib/API.js', {
        globals: {global: {display}},
    });
    const entry = new Actor();
    const bin = new Actor();
    bin.add_child(entry);
    const controls = {_searchEntryBin: hasBin ? bin : undefined,
        layout_manager: {_computeWorkspacesBoxForState() {}}};
    const uiGroup = new Actor();
    const chrome = [];
    const Main = {
        overview: {searchEntry: entry, _overview: {controls, _controls: controls},
            dash: {showAppsButton: new Actor()}},
        layoutManager: {uiGroup, addChrome: (actor, params) => chrome.push(params)},
        windowAttentionHandler: {_onWindowDemandsAttention() {}},
    };
    const api = new API({Main, Clutter: {AnimationMode: {EASE: 1}}}, version);
    return {api, entry, bin, chrome, display, Main};
}

test('search visibility tolerates a detached entry and no container', async () => {
    const {api, entry, bin} = await setup(51, false);
    bin.remove_child(entry);
    api.searchEntryHide(false);
    assert.equal(api._searchEntryVisibility, false);
    api.searchEntryShow(false);
    assert.equal(api._searchEntryVisibility, true);
    assert.equal(entry.transitions.size, 0);
});

test('search visibility changes only the overview bin when entry belongs to a popup', async () => {
    const {api, entry, bin} = await setup();
    bin.remove_child(entry);
    const popup = new Actor();
    popup.add_child(entry);
    api.searchEntryHide(false);
    bin.complete();
    assert.equal(bin.height, 0);
    assert.equal(entry.opacity, 255);
    assert.equal(popup.transitions.size, 0);
    api.searchEntryShow(false);
    bin.complete();
    assert.equal(bin.height, -1);
    assert.equal(entry.transitions.size, 0);
});

test('entry reparented during the show transition is not faded by an old callback', async () => {
    const {api, entry, bin} = await setup();
    api.searchEntryHide(false);
    entry.complete();
    bin.complete();
    api.searchEntryShow(false);
    bin.remove_child(entry);
    new Actor().add_child(entry);
    bin.complete();
    assert.equal(entry.transitions.size, 0);
});

test('normal overview entry still hides and shows; fake changes preserve preference', async () => {
    const {api, entry, bin} = await setup();
    api.searchEntryHide(false);
    entry.complete();
    bin.complete();
    assert.equal(entry.opacity, 0);
    api.searchEntryShow(true);
    bin.complete();
    entry.complete();
    assert.equal(entry.opacity, 255);
    assert.equal(api._searchEntryVisibility, false);
});

for (const version of [45, 49, 50, 51]) {
    test(`chrome uses valid parameters for GNOME ${version}`, async () => {
        const {api, chrome} = await setup(version);
        api.chromeAdd(new Actor());
        assert.equal(Object.hasOwn(chrome[0], 'affectsInputRegion'), version < 50);
    });
}

test('restored attention handlers retain distinct signal IDs for later cleanup', async () => {
    const {api, display, Main} = await setup();
    api._displayWindowDemandsAttentionSignal = display.connect('window-demands-attention', () => {});
    api._displayWindowMarkedUrgentSignal = display.connect('window-marked-urgent', () => {});
    api.windowDemandsAttentionFocusDisable();
    const handler = Main.windowAttentionHandler;
    assert.ok(display.signals.has(handler._windowDemandsAttentionId));
    assert.ok(display.signals.has(handler._windowMarkedUrgentId));
    assert.notEqual(handler._windowDemandsAttentionId, handler._windowMarkedUrgentId);
});
