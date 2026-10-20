import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadModule, Actor} from './helpers/shell.mjs';

class MockStage extends Actor {
    constructor() {
        super();
        this._keyFocus = null;
    }
    get_key_focus() {
        return this._keyFocus;
    }
    set_key_focus(actor) {
        this._keyFocus = actor;
    }
    connectObject(...args) {
        let i = 0;
        while (i < args.length) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'function') {
                this.connect(args[i], args[i + 1]);
                i += 2;
            } else {
                i++;
            }
        }
    }
    disconnectObject(owner) {}
}

class TestActor extends Actor {
    constructor(params = {}) {
        super(params);
        this.effects = new Map();
        this.can_focus = true;
        this.style_classes = new Set();
        if (params.style_class) {
            params.style_class.split(' ').forEach(c => this.style_classes.add(c));
        }
    }
    _init(params = {}) {
        Object.assign(this, params);
        if (params.style_class) {
            params.style_class.split(' ').forEach(c => this.style_classes.add(c));
        }
    }
    connectObject(...args) {
        let i = 0;
        while (i < args.length) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'function') {
                this.connect(args[i], args[i + 1]);
                i += 2;
            } else {
                i++;
            }
        }
    }
    disconnectObject(owner) {}
    set_width(w) {
        this.width = w;
    }
    set_height(h) {
        this.height = h;
    }
    set_pivot_point(x, y) {
        this.pivot = [x, y];
    }
    grab_key_focus() {
        this.stage?.set_key_focus(this);
    }
    add_effect_with_name(name, effect) {
        this.effects.set(name, effect);
    }
    remove_effect(effect) {
        for (const [k, v] of this.effects.entries()) {
            if (v === effect)
                this.effects.delete(k);
        }
    }
    add_style_class_name(name) {
        this.style_classes.add(name);
    }
    remove_style_class_name(name) {
        this.style_classes.delete(name);
    }
    has_style_class_name(name) {
        return this.style_classes.has(name);
    }
    contains(child) {
        let p = child;
        while (p) {
            if (p === this) return true;
            p = p.get_parent();
        }
        return false;
    }
    get_preferred_height(forWidth) {
        return [50, 65];
    }
}

class MockBlurEffect {
    constructor(params) {
        this.params = params;
        this.radius = 0;
    }
}

async function setupSpotlight() {
    const stage = new MockStage();
    const entry = new TestActor();
    entry.stage = stage;
    const bin = new TestActor();
    bin.add_child(entry);

    const resultItem1 = new TestActor();
    resultItem1.stage = stage;
    const resultItem2 = new TestActor();
    resultItem2.stage = stage;

    const search = new TestActor();
    search._searchResults = {activateDefault() {}};
    search._text = {
        set_text() {},
        event() {},
        connect() { return 1; },
        disconnect() {},
    };
    search.add_child(resultItem1);
    search.add_child(resultItem2);

    // Mock search focus navigation
    let currentFocusIndex = -1;
    search.navigate_focus = (from, direction, wrap) => {
        if (direction === 1 || direction === 3) { // TAB_FORWARD or DOWN
            if (!from || from === entry) {
                currentFocusIndex = 0;
            } else if (currentFocusIndex < 1) {
                currentFocusIndex++;
            } else {
                return false;
            }
            const target = currentFocusIndex === 0 ? resultItem1 : resultItem2;
            target.grab_key_focus();
            return true;
        } else if (direction === 2 || direction === 4) { // TAB_BACKWARD or UP
            if (currentFocusIndex > 0) {
                currentFocusIndex--;
                const target = currentFocusIndex === 0 ? resultItem1 : resultItem2;
                target.grab_key_focus();
                return true;
            } else if (currentFocusIndex === 0) {
                currentFocusIndex = -1;
                return false; // Cannot navigate backwards past first item
            }
            return false;
        }
        return false;
    };

    const controls = {_searchEntryBin: bin, _thumbnailsBox: {_maxThumbnailScale: 0.05}};
    const chromeActors = new Set();
    const Main = {
        overview: {
            searchEntry: entry,
            searchController: search,
            toggle() {},
            _overview: {controls, _controls: controls},
        },
        layoutManager: {
            monitors: [{x: 0, y: 0, width: 1920, height: 1080}],
            primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080},
            addChrome(actor) { chromeActors.add(actor); },
            removeChrome(actor) { chromeActors.delete(actor); },
        },
    };

    const Clutter = {
        BinLayout: class {},
        Orientation: {VERTICAL: 1},
        AnimationMode: {EASE_OUT_QUAD: 1},
        EventType: {KEY_PRESS: 1, BUTTON_PRESS: 2},
        KEY_Escape: 0xff1b,
        KEY_Return: 0xff0d,
        KEY_KP_Enter: 0xff8d,
        KEY_space: 0x0020,
        KEY_Down: 0xff54,
        KEY_Up: 0xff52,
        KEY_BackSpace: 0xff08,
        KEY_a: 0x0061,
        EVENT_STOP: true,
        EVENT_PROPAGATE: false,
        keysym_to_unicode: sym => (sym >= 0x20 && sym <= 0x7e ? sym : 0),
    };

    const Shell = {
        BlurEffect: MockBlurEffect,
        BlurMode: {BACKGROUND: 1},
        AppSystem: {get_default: () => ({connect: () => 1, disconnect() {}})},
    };

    const St = {
        Widget: TestActor,
        BoxLayout: TestActor,
        DirectionType: {TAB_FORWARD: 1, TAB_BACKWARD: 2, DOWN: 3, UP: 4},
        ThemeContext: {get_for_stage: () => ({scale_factor: 1})},
        Settings: {get: () => ({enable_animations: false, connectObject() {}, disconnectObject() {}})},
    };

    const settings = {
        get_string: key => 'default',
        connectObject() {},
        disconnectObject() {},
    };

    const idles = new Map();
    let nextIdleId = 1;
    const runIdles = () => {
        let count = 0;
        while (idles.size > 0 && count < 1000) {
            const [id, fn] = idles.entries().next().value;
            idles.delete(id);
            fn();
            count++;
        }
        return count;
    };

    const {SpotlightPopup} = await loadModule('spotlight@custom/lib/popup/widget/spotlightPopup.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': Main,
            'gi://Clutter': {default: Clutter},
            'gi://Shell': {default: Shell},
            'gi://St': {default: St},
            'gi://GLib': {default: {
                idle_add: (prio, fn) => {
                    const id = nextIdleId++;
                    idles.set(id, fn);
                    return id;
                },
                source_remove: id => {
                    idles.delete(id);
                },
                PRIORITY_DEFAULT_IDLE: 0,
                SOURCE_REMOVE: false,
            }},
            'gi://GObject': {default: {
                registerClass: (...args) => {
                    const cls = args.length > 1 ? args[1] : args[0];
                    return class extends cls {
                        constructor(...params) {
                            super(...params);
                            if (typeof this._init === 'function') {
                                this._init(...params);
                            }
                        }
                    };
                },
            }},
            'gi://Gio': {default: {
                Settings: class {
                    get_string() { return 'default'; }
                    connectObject() {}
                    disconnectObject() {}
                },
            }},
            'resource:///org/gnome/shell/ui/workspacesView.js': {SecondaryMonitorDisplay: {prototype: {}}},
            'resource:///org/gnome/shell/ui/workspaceThumbnail.js': {WorkspaceThumbnail: {prototype: {}}},
            'resource:///org/gnome/shell/ui/background.js': {BackgroundManager: class {}},
        },
        globals: {
            global: {
                stage,
                display: {
                    connect() { return 1; },
                    disconnect() {},
                    focus_window: null,
                },
                get_pointer: () => [500, 500],
            },
        },
    });

    const popup = new SpotlightPopup(settings);
    popup.stealOverviewSearch();

    return {
        popup, stage, entry, search, resultItem1, resultItem2,
        Main, Clutter, Shell, chromeActors, runIdles,
    };
}

test('spotlight requests key focus synchronously on open() without an idle', async () => {
    const {popup, stage, entry} = await setupSpotlight();

    assert.equal(stage.get_key_focus(), null);

    // Call open() synchronously
    popup.open();

    // This checks call order; native input latency needs a desktop session.
    assert.equal(popup._visible, true);
    assert.equal(stage.get_key_focus(), entry);

    popup.destroy();
});

test('down arrow navigates from entry to search results and between results', async () => {
    const {popup, stage, entry, search, resultItem1, resultItem2, Clutter} = await setupSpotlight();
    popup.open();
    search.visible = true;

    assert.equal(stage.get_key_focus(), entry);

    // First Down arrow: moves from entry to first search result
    const downEvent1 = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent1);
    assert.equal(stage.get_key_focus(), resultItem1);

    // Second Down arrow: moves to second search result
    stage.emit('captured-event', downEvent1);
    assert.equal(stage.get_key_focus(), resultItem2);

    popup.destroy();
});

test('up arrow navigates backwards through search results and returns to search entry', async () => {
    const {popup, stage, entry, search, resultItem1, resultItem2, Clutter} = await setupSpotlight();
    popup.open();
    search.visible = true;

    // Navigate to second result
    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent);
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItem2);

    // First Up arrow: moves back to first search result
    const upEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Up,
    };
    stage.emit('captured-event', upEvent);
    assert.equal(stage.get_key_focus(), resultItem1);

    // Second Up arrow: returns to search entry
    stage.emit('captured-event', upEvent);
    assert.equal(stage.get_key_focus(), entry);

    popup.destroy();
});

test('typing printable character or backspace on focused result redirects focus to search entry', async () => {
    const {popup, stage, entry, search, resultItem1, Clutter} = await setupSpotlight();
    popup.open();
    search.visible = true;

    // Focus first search result
    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItem1);

    // Type character 'a'
    const typeEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_a,
    };
    stage.emit('captured-event', typeEvent);
    assert.equal(stage.get_key_focus(), entry, 'typing "a" must redirect focus to search entry');

    // Move focus back to result
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItem1);

    // Press Backspace
    const backspaceEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_BackSpace,
    };
    stage.emit('captured-event', backspaceEvent);
    assert.equal(stage.get_key_focus(), entry, 'pressing BackSpace must redirect focus to search entry');

    popup.destroy();
});

test('escape closes spotlight popup and cleans up backdrop', async () => {
    const {popup, stage, Clutter, chromeActors, runIdles} = await setupSpotlight();
    popup.open();
    assert.equal(popup._visible, true);
    assert.ok(popup._backdrop, 'backdrop must exist while open');
    assert.ok(chromeActors.has(popup._backdrop._actor), 'backdrop must be added to chrome');

    // Press Escape
    const escapeEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Escape,
    };
    stage.emit('captured-event', escapeEvent);

    // Run scheduled close idle
    runIdles();

    assert.equal(popup._visible, false);
    assert.equal(popup._backdrop, null);

    popup.destroy();
});

test('rapid close then open cancels close idle and keeps popup open', async () => {
    const {popup, stage, entry, runIdles} = await setupSpotlight();
    popup.open();
    assert.equal(popup._visible, true);

    popup.close();
    popup.open();
    runIdles();

    assert.equal(popup._visible, true, 'Popup must remain open');
    assert.equal(stage.get_key_focus(), entry, 'Focus must remain on search entry');

    popup.destroy();
});

test('outside-click surface is transparent and never constructs a blur effect', async () => {
    const chrome = new Set();
    let outsideClicks = 0;
    // No Shell mock: importing the blur API would fail this test.
    const {PopupBackdrop} = await loadModule('spotlight@custom/lib/popup/components/backdrop.js', {
        mocks: {
            'gi://St': {default: {Widget: TestActor}},
            'gi://Clutter': {default: {EVENT_STOP: true}},
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: {
                    addChrome: actor => chrome.add(actor),
                    removeChrome: actor => chrome.delete(actor),
                },
            },
        },
    });
    const backdrop = new PopupBackdrop(() => outsideClicks++, {x: 0, y: 0, width: 1920, height: 1080});
    backdrop.show();
    assert.ok(chrome.has(backdrop._actor));
    assert.equal(backdrop._actor.effects.size, 0);
    const css = await readFile('spotlight@custom/stylesheet.css', 'utf8');
    assert.match(css, /\.spotlight-backdrop\s*\{\s*background-color: transparent;\s*\}/);
    backdrop._actor.emit('button-release-event');
    assert.equal(outsideClicks, 1);
    backdrop.destroy();
    assert.equal(chrome.size, 0);
    assert.equal(backdrop._actor.destroyed, true);
});
