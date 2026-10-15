import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

test('real search stealer and visibility settings coexist through steal and restore', async () => {
    const stage = new Actor();
    const entry = new Actor();
    const bin = new Actor();
    const controls = {_searchEntryBin: bin, layout_manager: {_computeWorkspacesBoxForState() {}}};
    bin.add_child(entry);
    const search = new Actor();
    const searchParent = new Actor();
    searchParent.add_child(search);
    search._searchResults = {activateDefault() {}};
    search._searchCancelled = () => {};
    const overview = {searchEntry: entry, searchController: search, toggle() {},
        _overview: {controls, _controls: controls}, dash: {showAppsButton: new Actor()}};
    const Main = {overview, layoutManager: {uiGroup: new Actor()}};
    const {OverviewSearchStealer} = await loadModule('spotlight@nin/lib/overview/searchStealer.js', {
        mocks: {'resource:///org/gnome/shell/ui/main.js': Main, 'gi://Clutter': {default: {}}},
        globals: {global: {stage}},
    });
    const {API} = await loadModule('just-perfection-desktop@just-perfection/lib/API.js');
    const api = new API({Main, Clutter: {AnimationMode: {EASE: 1}}}, 51);
    const stealer = new OverviewSearchStealer({_visible: false});
    stealer.steal();
    assert.equal(entry.get_parent(), null);
    api.searchEntryHide(false);
    bin.complete();
    api.searchEntryShow(false);
    bin.complete();
    stealer.restore();
    assert.equal(entry.get_parent(), bin);
    assert.equal(entry.opacity, 255);
    assert.equal(entry.visible, true);
    assert.equal(search.get_parent(), searchParent);
    assert.equal(stage.signals.size, 0);
});

test('gap actors retain usable work areas, tolerate negative monitor origins and release all chrome', async () => {
    const chrome = new Set();
    const monitors = [{x: -1920, y: -200, width: 1920, height: 1080},
        {x: 0, y: 0, width: 10, height: 10}];
    const {GapManager} = await loadModule('window-gap@amirhosseinkarimi.github.io/gapManager.js', {
        mocks: {'gi://Clutter': {default: {Actor}},
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {
                monitors, addChrome: (actor, params) => {
                    assert.deepEqual(Object.keys(params), ['affectsStruts']);
                    chrome.add(actor);
                }, removeChrome: actor => chrome.delete(actor),
            }}},
    });
    let size = 100;
    const gaps = new GapManager({get_boolean: () => true, get_int: () => size});
    gaps.rebuild();
    assert.equal(chrome.size, 8);
    for (let i = 0; i < monitors.length; i++) {
        const [top, bottom, left, right] = gaps._actors.slice(i * 4, i * 4 + 4);
        assert.ok(top.height + bottom.height < monitors[i].height);
        assert.ok(left.width + right.width < monitors[i].width);
    }
    const original = [...gaps._actors];
    gaps.rebuild();
    assert.deepEqual([...gaps._actors], original);
    size = 0;
    gaps.rebuild();
    assert.equal(chrome.size, 0);
    gaps.destroy();
});

test('light style restores the prior color scheme over repeated enable/disable cycles', async () => {
    const sessionMode = {colorScheme: 'prefer-dark'};
    let notifications = 0;
    const {default: Extension} = await loadModule(
        'light-style@gnome-shell-extensions.gcampax.github.com/extension.js', {
            mocks: {'gi://St': {default: {Settings: {get: () => ({notify: () => notifications++})}}},
                'resource:///org/gnome/shell/ui/main.js': {sessionMode}},
        });
    const extension = new Extension();
    for (let i = 0; i < 5; i++) {
        extension.enable();
        assert.equal(sessionMode.colorScheme, 'prefer-light');
        extension.disable();
        assert.equal(sessionMode.colorScheme, 'prefer-dark');
    }
    assert.equal(notifications, 10);
});
