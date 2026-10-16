import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

class SearchActor extends Actor {
    contains(actor) {
        assert.notEqual(actor, null, 'native contains() requires an actor');
        for (let current = actor; current; current = current.get_parent()) {
            if (current === this)
                return true;
        }
        return false;
    }
}

async function setupOverview() {
    const Clutter = {
        EventType: {KEY_PRESS: 1},
        KEY_space: 0x20,
        EVENT_STOP: true,
        EVENT_PROPAGATE: false,
        keysym_to_unicode: key => key < 0xff00 ? key : 0,
    };
    const stage = new Actor();
    stage.keyFocus = null;
    stage.get_key_focus = () => stage.keyFocus;
    const entryParent = new Actor();
    const entry = new SearchActor();
    const text = new SearchActor();
    entry.add_child(text);
    entryParent.add_child(entry);
    entry.grab_key_focus = () => { stage.keyFocus = text; };
    const receivedKeys = [];
    text.event = (event, capture) => {
        assert.equal(capture, false);
        receivedKeys.push(event.get_key_symbol());
    };
    entry.event = () => assert.fail('St.Entry does not insert normal text events');

    const searchParent = new Actor();
    const search = new SearchActor();
    const result = new SearchActor();
    search.add_child(result);
    searchParent.add_child(search);
    search._text = text;
    search._searchActive = false;
    search._setSearchActive = active => { search._searchActive = active; };
    let nativeResets = 0;
    search._searchCancelled = () => {
        search._setSearchActive(false);
        nativeResets++;
    };
    const originalCancelled = search._searchCancelled;
    let nativeToggles = 0;
    let nativeHides = 0;
    const overview = {
        visible: true,
        searchEntry: entry,
        searchController: search,
        toggle() { nativeToggles++; },
        hide(...args) {
            assert.equal(this, overview);
            nativeHides++;
            return args;
        },
    };
    const originalToggle = overview.toggle;
    const originalHide = overview.hide;
    let nativeActivations = 0;
    search._searchResults = {
        activateDefault() {
            nativeActivations++;
            overview.toggle();
        },
    };
    const originalActivateDefault = search._searchResults.activateDefault;
    let closeRequests = 0;
    const popup = {
        _visible: false,
        close() { closeRequests++; },
    };
    const {OverviewSearchStealer} = await loadModule(
        'spotlight@nin/lib/overview/searchStealer.js', {
            mocks: {
                'resource:///org/gnome/shell/ui/main.js': {overview},
                'gi://Clutter': {default: Clutter},
            },
            globals: {global: {stage}},
        });
    const stealer = new OverviewSearchStealer(popup);
    stealer.steal();
    const dispatch = key => {
        const event = {
            type: () => Clutter.EventType.KEY_PRESS,
            get_key_symbol: () => key,
        };
        for (const {name, callback} of stage.signals.values()) {
            if (name === 'captured-event' && callback(stage, event) === Clutter.EVENT_STOP)
                return Clutter.EVENT_STOP;
        }
        stage.keyFocus?.event?.(event, false);
        return Clutter.EVENT_PROPAGATE;
    };
    return {
        stage, entry, text, search, result, popup, overview, stealer, Clutter,
        entryParent, searchParent, receivedKeys, dispatch,
        originalCancelled, originalToggle, originalHide, originalActivateDefault,
        counts: () => ({nativeResets, nativeToggles, nativeHides, nativeActivations, closeRequests}),
    };
}

test('Overview typing reaches the focused ClutterText exactly once', async () => {
    const {popup, entry, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    popup._visible = true;
    entry.grab_key_focus();
    assert.equal(dispatch(0x61), Clutter.EVENT_PROPAGATE);
    assert.equal(dispatch(Clutter.KEY_space), Clutter.EVENT_PROPAGATE);
    assert.deepEqual(receivedKeys, [0x61, Clutter.KEY_space]);
    stealer.restore();
});

test('Overview typing from results forwards text once to the inner text actor', async () => {
    const {popup, stage, text, result, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    popup._visible = true;
    for (const key of [0x61, 0x0103]) {
        stage.keyFocus = result;
        assert.equal(dispatch(key), Clutter.EVENT_STOP);
        assert.equal(stage.keyFocus, text);
    }
    assert.deepEqual(receivedKeys, [0x61, 0x0103]);
    stealer.restore();
});

test('Overview forwards typing safely when no actor has key focus', async () => {
    const {popup, stage, text, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    popup._visible = true;
    assert.equal(dispatch(0x61), Clutter.EVENT_STOP);
    assert.equal(stage.keyFocus, text);
    assert.deepEqual(receivedKeys, [0x61]);
    stealer.restore();
});

test('Space on an Overview search result reaches native activation', async () => {
    const {popup, stage, result, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    popup._visible = true;
    stage.keyFocus = result;
    let activations = 0;
    result.event = event => {
        assert.equal(event.get_key_symbol(), Clutter.KEY_space);
        activations++;
    };
    assert.equal(dispatch(Clutter.KEY_space), Clutter.EVENT_PROPAGATE);
    assert.equal(activations, 1);
    assert.deepEqual(receivedKeys, []);
    stealer.restore();
});

test('Overview leaves native context menu typing and activation with the focused menu item', async () => {
    const {popup, stage, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    const menu = new SearchActor();
    menu.add_style_class_name('popup-menu');
    const menuItem = new SearchActor();
    menu.add_child(menuItem);
    stage.keyFocus = menuItem;
    const menuKeys = [];
    menuItem.event = event => { menuKeys.push(event.get_key_symbol()); };
    for (const visible of [false, true]) {
        popup._visible = visible;
        for (const key of [0x61, Clutter.KEY_space])
            assert.equal(dispatch(key), Clutter.EVENT_PROPAGATE);
    }
    assert.deepEqual(receivedKeys, []);
    assert.deepEqual(menuKeys, [0x61, Clutter.KEY_space, 0x61, Clutter.KEY_space]);
    assert.equal(stage.keyFocus, menuItem);
    stealer.restore();
});

test('closed Spotlight consumes Overview text without focusing its detached entry', async () => {
    const {stage, receivedKeys, dispatch, Clutter, stealer} = await setupOverview();
    assert.equal(dispatch(0x61), Clutter.EVENT_STOP);
    assert.equal(stage.keyFocus, null);
    assert.deepEqual(receivedKeys, []);
    stealer.restore();
});

test('native result toggles dismiss Spotlight and restore normal Overview behavior on disable', async () => {
    const {popup, overview, search, stealer, originalToggle,
        originalActivateDefault, counts} = await setupOverview();
    popup._visible = true;
    overview.toggle();
    assert.equal(counts().closeRequests, 1);
    assert.equal(counts().nativeToggles, 0);
    search._searchResults.activateDefault();
    assert.equal(counts().nativeActivations, 1);
    assert.equal(counts().nativeToggles, 0);
    stealer.restore();
    assert.equal(overview.toggle, originalToggle);
    assert.equal(search._searchResults.activateDefault, originalActivateDefault);
    overview.toggle();
    assert.equal(counts().nativeToggles, 1);
});

test('clearing search updates native search-active state and restores cancellation on disable', async () => {
    const {search, stealer, originalCancelled, counts, entry,
        entryParent, searchParent, stage} = await setupOverview();
    search._setSearchActive(true);
    search._searchCancelled();
    assert.equal(search._searchActive, false);
    assert.equal(counts().nativeResets, 0);
    stealer.restore();
    assert.equal(search._searchCancelled, originalCancelled);
    assert.equal(entry.get_parent(), entryParent);
    assert.equal(search.get_parent(), searchParent);
    assert.equal(stage.signals.size, 0);
    search._setSearchActive(true);
    search._searchCancelled();
    assert.equal(search._searchActive, false);
    assert.equal(counts().nativeResets, 1);
});

test('app and system action hide requests dismiss Spotlight and preserve native Overview hide', async () => {
    const {popup, overview, stealer, originalHide, counts} = await setupOverview();
    popup._visible = true;
    assert.deepEqual(overview.hide('activation'), ['activation']);
    assert.equal(counts().closeRequests, 1);
    assert.equal(counts().nativeHides, 1);
    popup._visible = false;
    overview.hide();
    assert.equal(counts().closeRequests, 1);
    assert.equal(counts().nativeHides, 2);
    stealer.restore();
    assert.equal(overview.hide, originalHide);
    popup._visible = true;
    overview.hide();
    assert.equal(counts().closeRequests, 1);
    assert.equal(counts().nativeHides, 3);
});
