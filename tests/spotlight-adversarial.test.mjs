// Adversarial Stress Harness for Spotlight UX, Latency, Navigation & Popup Lifecycle
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

class MockStageWithSignals extends Actor {
    constructor() {
        super();
        this._keyFocus = null;
        this.objectSignals = [];
    }
    get_key_focus() {
        return this._keyFocus;
    }
    set_key_focus(actor) {
        this._keyFocus = actor;
        this.emit('notify::key-focus');
    }
    connectObject(...args) {
        const owner = args[args.length - 1];
        let i = 0;
        while (i < args.length - 1) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'function') {
                const signalName = args[i];
                const cb = args[i + 1];
                const sid = this.connect(signalName, cb);
                this.objectSignals.push({owner, signalName, sid});
                i += 2;
            } else {
                i++;
            }
        }
    }
    disconnectObject(owner) {
        const remaining = [];
        for (const entry of this.objectSignals) {
            if (entry.owner === owner) {
                try { this.disconnect(entry.sid); } catch (_) {}
            } else {
                remaining.push(entry);
            }
        }
        this.objectSignals = remaining;
    }
}

class TestActorWithObjectSignals extends Actor {
    constructor(params = {}) {
        super(params);
        this.effects = new Map();
        this.can_focus = true;
        this.style_classes = new Set();
        this.objectSignals = [];
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
        const owner = args[args.length - 1];
        let i = 0;
        while (i < args.length - 1) {
            if (typeof args[i] === 'string' && typeof args[i + 1] === 'function') {
                const signalName = args[i];
                const cb = args[i + 1];
                const sid = this.connect(signalName, cb);
                this.objectSignals.push({owner, signalName, sid});
                i += 2;
            } else {
                i++;
            }
        }
    }
    disconnectObject(owner) {
        const remaining = [];
        for (const entry of this.objectSignals) {
            if (entry.owner === owner) {
                try { this.disconnect(entry.sid); } catch (_) {}
            } else {
                remaining.push(entry);
            }
        }
        this.objectSignals = remaining;
    }
    set_width(w) { this.width = w; }
    set_height(h) { this.height = h; }
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
    add_style_class_name(name) { this.style_classes.add(name); }
    remove_style_class_name(name) { this.style_classes.delete(name); }
    has_style_class_name(name) { return this.style_classes.has(name); }
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
    remove_transition(property) {
        const params = this.transitions.get('ease');
        if (params && Object.hasOwn(params, property.replaceAll('-', '_')))
            super.remove_transition('ease');
        super.remove_transition(property);
    }
}

class MockBlurEffect {
    constructor(params) {
        this.params = params;
        this.radius = 0;
    }
}

async function createHarness(options = {}) {
    const stage = new MockStageWithSignals();
    const entry = new TestActorWithObjectSignals();
    entry.stage = stage;
    const bin = new TestActorWithObjectSignals();
    bin.add_child(entry);

    const resultItems = [];
    const numResults = options.numResults ?? 5;
    for (let i = 0; i < numResults; i++) {
        const item = new TestActorWithObjectSignals({style_class: 'search-result-item'});
        item.stage = stage;
        item.resultIndex = i;
        resultItems.push(item);
    }

    const search = new TestActorWithObjectSignals();
    search._searchResults = {activateDefault() {}};
    let textValue = '';
    const textSignalListeners = new Map();
    let nextTextSigId = 1;

    search._text = {
        event: (event, capture) => {
            assert.equal(capture, false);
            entry.emit('key-press-event', event);
        },
        get_text: () => textValue,
        set_text: t => {
            textValue = t;
            for (const cb of textSignalListeners.values()) cb();
        },
        connect: (sig, cb) => {
            const id = nextTextSigId++;
            textSignalListeners.set(id, cb);
            return id;
        },
        disconnect: id => {
            textSignalListeners.delete(id);
        },
    };

    for (const item of resultItems) {
        search.add_child(item);
    }
    const searchParent = new TestActorWithObjectSignals();
    searchParent.add_child(search);

    // Realistic multi-result navigation state machine
    let currentFocusIndex = -1;
    search.navigate_focus = (from, direction, wrap) => {
        if (resultItems.length === 0) return false;

        // TAB_FORWARD (1) or DOWN (3)
        if (direction === 1 || direction === 3) {
            if (!from || from === entry || !search.contains(from)) {
                currentFocusIndex = 0;
            } else {
                if (currentFocusIndex + 1 < resultItems.length) {
                    currentFocusIndex++;
                } else {
                    // At bottom boundary: cannot navigate forward without wrap
                    return false;
                }
            }
            resultItems[currentFocusIndex].grab_key_focus();
            return true;
        }

        // TAB_BACKWARD (2) or UP (4)
        if (direction === 2 || direction === 4) {
            if (currentFocusIndex > 0) {
                currentFocusIndex--;
                resultItems[currentFocusIndex].grab_key_focus();
                return true;
            } else if (currentFocusIndex === 0) {
                // At top boundary: cannot navigate backward within results
                currentFocusIndex = -1;
                return false;
            }
            return false;
        }

        return false;
    };

    const controls = {_searchEntryBin: bin, _thumbnailsBox: {_maxThumbnailScale: 0.05}};
    const chromeActors = new Set();
    const monitors = options.monitors ?? [
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: 1920, y: 0, width: 2560, height: 1440},
    ];

    const uiGroup = new TestActorWithObjectSignals();
    const Main = {
        uiGroup,
        sessionMode: {colorScheme: options.forcedScheme ?? 'default'},
        overview: {
            searchEntry: entry,
            searchController: search,
            toggle() {},
            _overview: {controls, _controls: controls},
        },
        layoutManager: {
            uiGroup,
            monitors,
            primaryMonitor: monitors[0],
            addChrome(actor) {
                if (!actor.get_parent())
                    uiGroup.add_child(actor);
                chromeActors.add(actor);
            },
            removeChrome(actor) {
                if (actor.get_parent() === uiGroup)
                    uiGroup.remove_child(actor);
                chromeActors.delete(actor);
            },
        },
    };

    const Clutter = {
        BinLayout: class {},
        Orientation: {VERTICAL: 1},
        AnimationMode: {EASE_OUT_QUAD: 1, EASE: 2},
        EventType: {KEY_PRESS: 1, BUTTON_PRESS: 2},
        KEY_Escape: 0xff1b,
        KEY_Return: 0xff0d,
        KEY_KP_Enter: 0xff8d,
        KEY_space: 0x0020,
        KEY_Down: 0xff54,
        KEY_Up: 0xff52,
        KEY_Left: 0xff51,
        KEY_Right: 0xff53,
        KEY_BackSpace: 0xff08,
        KEY_Delete: 0xffff,
        KEY_Tab: 0xff09,
        KEY_a: 0x0061,
        KEY_z: 0x007a,
        KEY_0: 0x0030,
        KEY_9: 0x0039,
        KEY_minus: 0x002d,
        KEY_Cyrillic_ya: 0x06df,
        EVENT_STOP: true,
        EVENT_PROPAGATE: false,
        keysym_to_unicode: sym => {
            if (sym >= 0x20 && sym <= 0x7e) return sym;
            if (sym === 0x06df) return 0x044f; // Cyrillic ya
            return 0;
        },
    };

    const Shell = {
        BlurEffect: options.legacyBlur ? class {
            constructor(params) {
                assert.equal(Object.hasOwn(params, 'radius'), false);
                this.params = params;
                this.sigma = 0;
            }
        } : MockBlurEffect,
        BlurMode: {BACKGROUND: 1},
        AppSystem: {get_default: () => ({connect: () => 1, disconnect() {}})},
    };

    const St = {
        Widget: TestActorWithObjectSignals,
        BoxLayout: TestActorWithObjectSignals,
        DirectionType: {TAB_FORWARD: 1, TAB_BACKWARD: 2, DOWN: 3, UP: 4},
        ThemeContext: {get_for_stage: () => ({scale_factor: options.scale ?? 1})},
        Settings: {get: () => animationSettings},
    };
    const animationSettings = new MockStageWithSignals();
    animationSettings.enable_animations = options.enableAnimations ?? false;
    animationSettings.notify = name => animationSettings.emit(`notify::${name}`);

    const settings = new MockStageWithSignals();
    settings.theme = options.theme ?? 'default';
    settings.get_string = () => settings.theme;

    const idleTasks = new Map();
    let nextIdleId = 1;
    const idleQueue = [];
    const runIdles = () => {
        let count = 0;
        while (idleQueue.length && count < 1000) {
            const fn = idleQueue.shift();
            for (const [id, item] of idleTasks.entries()) {
                if (item === fn) {
                    idleTasks.delete(id);
                    break;
                }
            }
            fn();
            count++;
        }
        return count;
    };

    let pointerCoords = options.pointer ?? [500, 500];
    const displaySignals = new Map();
    let nextDisplaySigId = 1;

    const {SpotlightPopup} = await loadModule('spotlight@nin/lib/popup/widget/spotlightPopup.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': Main,
            'gi://Clutter': {default: Clutter},
            'gi://Shell': {default: Shell},
            'gi://St': {default: St},
            'gi://GLib': {default: {
                idle_add: (prio, fn) => {
                    const id = nextIdleId++;
                    idleTasks.set(id, fn);
                    idleQueue.push(fn);
                    return id;
                },
                source_remove: id => {
                    const fn = idleTasks.get(id);
                    if (fn) {
                        idleTasks.delete(id);
                        const idx = idleQueue.indexOf(fn);
                        if (idx !== -1) {
                            idleQueue.splice(idx, 1);
                        }
                    }
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
                Settings: class extends MockStageWithSignals {
                    constructor() {
                        super();
                        this.scheme = options.colorScheme ?? 'default';
                    }
                    get_string() { return this.scheme; }
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
                    connect(sig, cb) {
                        const id = nextDisplaySigId++;
                        displaySignals.set(id, {sig, cb});
                        return id;
                    },
                    disconnect(id) {
                        displaySignals.delete(id);
                    },
                    emit(sig) {
                        for (const entry of displaySignals.values()) {
                            if (entry.sig === sig) entry.cb();
                        }
                    },
                    focus_window: null,
                },
                get_pointer: () => pointerCoords,
            },
        },
    });

    const popup = new SpotlightPopup(settings);
    await options.beforeSteal?.({entry, entryParent: bin, Main, Clutter});
    popup.stealOverviewSearch();

    return {
        popup, stage, entry, search, resultItems,
        Main, Clutter, Shell, St, chromeActors,
        runIdles, idleQueue, textSignalListeners,
        displaySignals, settings, animationSettings, searchParent, entryParent: bin,
        setPointer: p => { pointerCoords = p; },
        dispatchKey(event) {
            // Clutter builds the event path before stage capture runs.
            const target = stage.get_key_focus();
            for (const {name, callback} of [...stage.signals.values()]) {
                if (name === 'captured-event' && callback(stage, event) === Clutter.EVENT_STOP)
                    return Clutter.EVENT_STOP;
            }
            target?.emit('key-press-event', event);
            return Clutter.EVENT_PROPAGATE;
        },
    };
}

// ---------------------------------------------------------------------------
// These tests verify control flow with mocked Shell boundaries. Frame timing,
// rendering and native key navigation still require a desktop session.
// SUITE 1: SYNCHRONOUS FOCUS CONTROL FLOW
// ---------------------------------------------------------------------------
for (const completed of [true, false]) {
    test(`[Interop] borrowed entry recovers from a ${completed ? 'completed' : 'pending'} Overview hide`, async () => {
        const {API} = await loadModule('just-perfection-desktop@just-perfection/lib/API.js');
        const borrowedOpacity = completed ? 0 : 127;
        const {popup, entry, entryParent, search, Clutter, dispatchKey} = await createHarness({
            beforeSteal: ({entry, entryParent, Main, Clutter}) => {
                Main.overview._overview.controls.layout_manager = {
                    _computeWorkspacesBoxForState: (_state, box) => box,
                };
                Main.overview.dash = {showAppsButton: new TestActorWithObjectSignals()};
                const api = new API({Main, Clutter}, 51);
                assert.equal(entry.get_parent(), entryParent);
                api.searchEntryHide(false);
                assert.equal(entry.transitions.get('ease').opacity, 0);
                if (completed)
                    entry.complete();
                else
                    entry.opacity = borrowedOpacity;
                assert.equal(entry.opacity, borrowedOpacity);
            },
        });

        try {
            popup.open();
            assert.equal(entry.transitions.size, 0, 'the inherited opacity fade must be cancelled');
            assert.equal(entry.opacity, 255, 'the entire entry must be opaque while Spotlight owns it');

            entry.connect('key-press-event', (_, event) => {
                assert.equal(event.get_key_symbol(), Clutter.KEY_a);
                search._text.set_text('a');
            });
            assert.equal(dispatchKey({
                type: () => Clutter.EventType.KEY_PRESS,
                get_key_symbol: () => Clutter.KEY_a,
            }), Clutter.EVENT_PROPAGATE);
            assert.equal(search._text.get_text(), 'a');
            assert.equal(search.visible, true, 'typing still exposes search results');

            popup.returnOverviewSearch();
            assert.equal(entry.get_parent(), entryParent);
            assert.equal(entry.opacity, borrowedOpacity, 'returning the entry restores its borrowed opacity');
        } finally {
            popup.destroy();
        }
    });
}

test('[Focus] open requests focus synchronously without an idle', async () => {
    const {popup, stage, entry, idleQueue} = await createHarness();

    assert.equal(stage.get_key_focus(), null, 'Pre-condition: stage has no focus');

    popup.open();
    assert.equal(popup._visible, true, 'popup._visible must be true immediately');
    assert.equal(stage.get_key_focus(), entry, 'entry must possess stage key focus synchronously at frame 0');
    assert.equal(idleQueue.length, 0, 'No idle tasks should be queued for focus acquisition');

    popup.destroy();
});

test('[Focus] 100 consecutive open/close cycles request entry focus', async () => {
    const {popup, stage, entry, runIdles} = await createHarness();

    for (let i = 0; i < 100; i++) {
        popup.open();

        assert.equal(stage.get_key_focus(), entry, `Cycle ${i}: focus grabbed synchronously`);
        popup.close();
        runIdles();
    }

    popup.destroy();
});

test('[Focus] recover entry focus when the stage focus becomes null', async () => {
    const {popup, stage, entry} = await createHarness();
    popup.open();
    assert.equal(stage.get_key_focus(), entry);

    // Simulate external blur setting stage key focus to null
    stage.set_key_focus(null);

    // Defense layer 2 'notify::key-focus' must immediately restore focus to entry
    assert.equal(stage.get_key_focus(), entry, 'Stage key focus must automatically restore to entry when nulled');

    popup.destroy();
});

// ---------------------------------------------------------------------------
// SUITE 2: KEYSTROKE DELIVERY & DISPATCH ADVERSARIAL STRESS TESTS
// ---------------------------------------------------------------------------
test('[Keystroke] successive captured keys propagate while opening animation is pending', async () => {
    const {popup, stage, entry, Clutter} = await createHarness({enableAnimations: true});

    const deliveredKeys = [];
    entry.connect('key-press-event', (actor, event) => {
        deliveredKeys.push(event.get_key_symbol());
        return Clutter.EVENT_STOP;
    });

    popup.open();

    const keys = [Clutter.KEY_a, Clutter.KEY_z, Clutter.KEY_0, Clutter.KEY_9];

    for (const key of keys) {
        // Dispatch key to stage while popup is open / animating
        const event = {
            type: () => Clutter.EventType.KEY_PRESS,
            get_key_symbol: () => key,
        };

        // Emit captured-event on stage
        let stopped = false;
        for (const {name, callback} of [...stage.signals.values()]) {
            if (name === 'captured-event') {
                if (callback(stage, event) === Clutter.EVENT_STOP) {
                    stopped = true;
                    break;
                }
            }
        }

        // If not stopped by stage pre-filter, route to active key focus
        if (!stopped) {
            const currentFocus = stage.get_key_focus();
            assert.ok(currentFocus, 'Focus must exist during the opening animation');
            currentFocus.emit('key-press-event', event);
        }
    }

    assert.deepEqual(
        deliveredKeys,
        [Clutter.KEY_a, Clutter.KEY_z, Clutter.KEY_0, Clutter.KEY_9],
        'Successive keystrokes must be delivered to the entry during animation',
    );

    popup.destroy();
});

test('[Adversarial Keystroke] Non-ASCII / International unicode keys redirect correctly', async () => {
    const {popup, stage, entry, search, resultItems, Clutter} = await createHarness();
    popup.open();
    search.visible = true;

    // Move to result 0
    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[0]);

    // Dispatch Cyrillic 'ya' (0x06df) -> unicode 0x044f >= 0x20
    const cyrillicEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Cyrillic_ya,
    };
    const propResult = stage.emit('captured-event', cyrillicEvent);
    assert.equal(stage.get_key_focus(), entry, 'Cyrillic keystroke must redirect focus to entry');

    popup.destroy();
});

// ---------------------------------------------------------------------------
// SUITE 3: ARROW KEY NAVIGATION & CYCLING ADVERSARIAL STRESS TESTS
// ---------------------------------------------------------------------------
test('[Adversarial Cycling] Full bidirectional cycling: down through all, boundary clamp, up back to entry, boundary clamp', async () => {
    const {popup, stage, entry, search, resultItems, Clutter} = await createHarness({numResults: 5});
    popup.open();
    search.visible = true;

    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    const upEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Up,
    };

    assert.equal(stage.get_key_focus(), entry, 'Starts at entry');

    // 1. Step Down through all 5 items
    for (let i = 0; i < 5; i++) {
        stage.emit('captured-event', downEvent);
        assert.equal(stage.get_key_focus(), resultItems[i], `Down step ${i + 1} focuses item ${i}`);
    }

    // 2. Stress-test Down past last result (10 extra Down presses)
    for (let i = 0; i < 10; i++) {
        stage.emit('captured-event', downEvent);
        assert.equal(stage.get_key_focus(), resultItems[4], `Down past bottom (${i + 1}) must clamp at last item`);
    }

    // 3. Step Up backwards through results
    for (let i = 3; i >= 0; i--) {
        stage.emit('captured-event', upEvent);
        assert.equal(stage.get_key_focus(), resultItems[i], `Up step focuses item ${i}`);
    }

    // 4. Step Up from first result back to entry
    stage.emit('captured-event', upEvent);
    assert.equal(stage.get_key_focus(), entry, 'Up from first result must focus entry');

    // 5. Stress-test Up past entry (10 extra Up presses)
    for (let i = 0; i < 10; i++) {
        stage.emit('captured-event', upEvent);
        assert.equal(stage.get_key_focus(), entry, `Up past entry (${i + 1}) must clamp at entry`);
    }

    popup.destroy();
});

test('[Adversarial Cycling] Down arrow with empty / hidden search results propagates safely to entry', async () => {
    const {popup, stage, entry, search, Clutter} = await createHarness({numResults: 0});
    popup.open();
    search.visible = false; // no results

    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };

    // When search is not visible, Down arrow must not crash and focus must remain on entry
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), entry, 'Focus must remain on entry when no results');

    popup.destroy();
});

test('[Adversarial Typing Redirection] Complex intermixed typing and arrow navigation', async () => {
    const {popup, stage, entry, search, resultItems, Clutter} = await createHarness({numResults: 4});
    popup.open();
    search.visible = true;

    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    const upEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Up,
    };
    const typeAEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_a,
    };
    const backspaceEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_BackSpace,
    };

    // Down to result 1
    stage.emit('captured-event', downEvent);
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[1]);

    // Up through the first result returns to the entry.
    stage.emit('captured-event', upEvent);
    stage.emit('captured-event', upEvent);
    assert.equal(stage.get_key_focus(), entry);

    // Down to result 0
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[0]);

    // Type 'a' -> redirects to entry
    stage.emit('captured-event', typeAEvent);
    assert.equal(stage.get_key_focus(), entry, 'Letter "a" redirects to entry');

    // Down to result 2
    stage.emit('captured-event', downEvent);
    stage.emit('captured-event', downEvent);
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[2]);

    // Backspace -> redirects to entry
    stage.emit('captured-event', backspaceEvent);
    assert.equal(stage.get_key_focus(), entry, 'BackSpace redirects to entry');

    popup.destroy();
});

// ---------------------------------------------------------------------------
// SUITE 4: BACKDROP BLUR LIFECYCLE & RESOURCE MANAGEMENT ADVERSARIAL STRESS TESTS
// ---------------------------------------------------------------------------
test('[Backdrop lifecycle] outside-click surface has no effects and is freed on close', async () => {
    const {popup, chromeActors, runIdles} = await createHarness();

    popup.open();
    assert.ok(popup._backdrop, 'Backdrop instance must exist while open');
    const backdropActor = popup._backdrop._actor;
    assert.ok(chromeActors.has(backdropActor), 'Backdrop actor must be in layoutManager chrome');

    assert.equal(backdropActor.effects.size, 0, 'Desktop must have no blur effect');
    assert.equal(popup._content.effects.size, 0, 'Panel text must stay sharp');

    // Close and verify teardown
    popup.close();
    runIdles();

    assert.equal(popup._backdrop, null, 'popup._backdrop reference cleared');
    assert.equal(chromeActors.has(backdropActor), false, 'Backdrop removed from chrome');
    assert.equal(backdropActor.effects.size, 0, 'BlurEffect removed from backdrop actor');
    assert.equal(backdropActor.destroyed, true, 'Backdrop actor destroyed');

    popup.destroy();
});

test('[Adversarial Blur Lifecycle] Multi-monitor geometry: backdrop precisely covers cursor monitor', async () => {
    const monitors = [
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: 1920, y: 0, width: 2560, height: 1440},
    ];

    // Cursor on monitor 2 (x=2500, y=500)
    const {popup, setPointer, runIdles} = await createHarness({monitors, pointer: [2500, 500]});

    popup.open();
    const backdropActor = popup._backdrop._actor;

    assert.equal(backdropActor.x, 1920, 'Backdrop X must match monitor 2 X');
    assert.equal(backdropActor.y, 0, 'Backdrop Y must match monitor 2 Y');
    assert.equal(backdropActor.width, 2560, 'Backdrop width must match monitor 2 width');
    assert.equal(backdropActor.height, 1440, 'Backdrop height must match monitor 2 height');

    popup.close();
    runIdles();
    popup.destroy();
});

test('[Adversarial Leak Stress] 100 rapid open/close cycles do not leak chrome actors or stage signals', async () => {
    const {popup, stage, chromeActors, runIdles} = await createHarness();

    const initialSignals = stage.signals.size;

    for (let i = 0; i < 100; i++) {
        popup.open();
        assert.ok(chromeActors.size >= 1, `Cycle ${i}: chrome actors present while open`);
        popup.close();
        runIdles();
        assert.equal(chromeActors.size, 0, `Cycle ${i}: chrome actors must be 0 after close idle`);
        assert.equal(popup._backdrop, null, `Cycle ${i}: backdrop must be destroyed`);
    }

    assert.equal(chromeActors.size, 0, 'All chrome actors cleaned up after 100 cycles');
    assert.equal(stage.signals.size, initialSignals, 'Stage signals must not leak or accumulate');

    popup.destroy();
});

test('[Adversarial Idempotence] Double open, double close, and destroy while open', async () => {
    const {popup, chromeActors, runIdles} = await createHarness();

    // 1. Double open
    popup.open();
    const firstBackdrop = popup._backdrop;
    popup.open(); // second open should be no-op
    assert.equal(popup._backdrop, firstBackdrop, 'Second open() is idempotent');

    // 2. Destroy while open (mid-lifecycle teardown)
    popup.destroy();
    assert.equal(popup._backdrop, null, 'Backdrop cleaned up by destroy()');
    assert.equal(chromeActors.size, 0, 'All chrome actors freed by destroy()');

    // 3. Double close after destroy should not throw
    assert.doesNotThrow(() => {
        popup.close();
        runIdles();
    });
});

test('[Adversarial Modifiers] Non-character modifier keys (Ctrl, Alt, Shift, Tab) on focused result do not redirect focus', async () => {
    const {popup, stage, entry, search, resultItems, Clutter} = await createHarness({numResults: 3});
    popup.open();
    search.visible = true;

    // Focus result 0
    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[0]);

    // Send Control_L (0xffe3)
    const ctrlEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => 0xffe3,
    };
    stage.emit('captured-event', ctrlEvent);
    assert.equal(stage.get_key_focus(), resultItems[0], 'Control key must not redirect focus to entry');

    // Send Tab (0xff09)
    const tabEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Tab,
    };
    stage.emit('captured-event', tabEvent);
    assert.equal(stage.get_key_focus(), resultItems[0], 'Tab key must not redirect focus to entry');

    popup.destroy();
});

test('[Adversarial Multi-Monitor Negative Origins] Backdrop on negative coordinate monitor (-1920, 0)', async () => {
    const monitors = [
        {x: -1920, y: 0, width: 1920, height: 1080},
        {x: 0, y: 0, width: 2560, height: 1440},
    ];

    // Pointer on negative monitor (-500, 400)
    const {popup, runIdles} = await createHarness({monitors, pointer: [-500, 400]});

    popup.open();
    const backdropActor = popup._backdrop._actor;

    assert.equal(backdropActor.x, -1920, 'Backdrop X covers negative monitor X');
    assert.equal(backdropActor.y, 0, 'Backdrop Y covers negative monitor Y');
    assert.equal(backdropActor.width, 1920, 'Backdrop width matches negative monitor');
    assert.equal(backdropActor.height, 1080, 'Backdrop height matches negative monitor');

    popup.close();
    runIdles();
    popup.destroy();
});

test('[Adversarial Backdrop Click] Click outside on backdrop triggers close defense', async () => {
    const {popup, chromeActors, runIdles, Clutter} = await createHarness({enableAnimations: true});

    popup.open();
    assert.equal(popup._visible, true);
    const backdropActor = popup._backdrop._actor;

    // Simulate click-outside on backdrop actor
    const clickEvent = {
        type: () => Clutter.EventType.BUTTON_RELEASE,
        get_button: () => 1,
    };
    backdropActor.emit('button-release-event', clickEvent);

    // Idle queue processes close
    runIdles();

    assert.equal(popup._visible, false, 'Popup must close after backdrop click');
    assert.equal(popup._backdrop, null, 'Backdrop must be destroyed');

    popup.destroy();
});

test('[Adversarial Race] open() called while close idle is pending', async () => {
    const {popup, stage, entry, runIdles, idleQueue} = await createHarness();
    popup.open();
    assert.equal(popup._visible, true);
    assert.equal(stage.get_key_focus(), entry);

    // Call close() -> schedules idle _closeIdleId
    popup.close();
    assert.equal(idleQueue.length, 1, 'Close idle task is scheduled');

    // Immediately call open() before idleQueue runs!
    popup.open();

    // Now run idle queue
    runIdles();

    // If popup.open() was called, user intends the popup to be open!
    // But does it stay open or did _doClose close it?
    assert.equal(popup._visible, true, 'Popup should remain open if open() was called before close idle ran');
    assert.equal(stage.get_key_focus(), entry, 'Focus should remain on entry');

    popup.destroy();
});

test('[Adversarial Hotkey] Rapid multi-toggle inversion preserves correct terminal state', async () => {
    const {popup, stage, entry, runIdles} = await createHarness();

    // 1. Single toggle opens
    popup.toggle();
    assert.equal(popup._visible, true, 'First toggle must open');
    assert.equal(stage.get_key_focus(), entry);

    // 2. Rapid double toggle (Close then Open before idle fires)
    popup.toggle(); // schedules close
    assert.ok(popup._closeIdleId !== 0, 'Close idle scheduled');
    popup.toggle(); // should cancel close idle and retain open state
    assert.equal(popup._closeIdleId, 0, 'Close idle cancelled by toggle');
    assert.equal(popup._visible, true, 'Popup remains visible');

    // Run idles: no close task should execute
    runIdles();
    assert.equal(popup._visible, true, 'Popup still open after idles');
    assert.equal(stage.get_key_focus(), entry);

    // 3. Rapid triple toggle (Close -> Open -> Close)
    popup.toggle(); // close
    popup.toggle(); // open
    popup.toggle(); // close
    assert.ok(popup._closeIdleId !== 0, 'Final close idle scheduled');

    runIdles();
    assert.equal(popup._visible, false, 'Popup closes after odd close toggle');
    assert.equal(popup._backdrop, null);

    popup.destroy();
});

test('[Adversarial Hotkey] Escape dismissal race cancelled by immediate hotkey reopen', async () => {
    const {popup, stage, entry, runIdles, Clutter} = await createHarness();
    popup.open();

    // User presses Escape -> defense schedules close
    const escapeEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Escape,
    };
    stage.emit('captured-event', escapeEvent);
    assert.ok(popup._closeIdleId !== 0, 'Escape scheduled close idle');

    // User immediately presses hotkey toggle before next frame
    popup.toggle();
    assert.equal(popup._closeIdleId, 0, 'Hotkey toggle cancelled escape close');

    runIdles();
    assert.equal(popup._visible, true, 'Popup remains open');
    assert.equal(stage.get_key_focus(), entry, 'Focus retained on entry');

    popup.destroy();
});

test('[Adversarial Hotkey] Rapid toggle with focused result item reclaims entry focus', async () => {
    const {popup, stage, entry, search, resultItems, Clutter, runIdles} = await createHarness({numResults: 3});
    popup.open();
    search.visible = true;

    // Navigate to result item 0
    const downEvent = {
        type: () => Clutter.EventType.KEY_PRESS,
        get_key_symbol: () => Clutter.KEY_Down,
    };
    stage.emit('captured-event', downEvent);
    assert.equal(stage.get_key_focus(), resultItems[0]);

    // Rapid toggle off then on
    popup.close();
    popup.open();
    runIdles();

    assert.equal(popup._visible, true);
    assert.equal(stage.get_key_focus(), entry, 'Entry focus re-acquired after rapid toggle');

    popup.destroy();
});

test('[Lifecycle] disable while open restores Overview after cancelling all popup work', async () => {
    const {popup, entry, search, stage, entryParent, searchParent,
        chromeActors, idleQueue, runIdles, textSignalListeners, displaySignals,
        settings} = await createHarness({enableAnimations: true});
    popup.open();
    search._searchResults.activateDefault();
    assert.equal(idleQueue.length, 1);

    // The extension calls these methods in this order from disable().
    popup.returnOverviewSearch();
    assert.equal(entry.get_parent(), entryParent);
    assert.equal(search.get_parent(), searchParent);
    assert.equal(popup._visible, false);
    assert.equal(chromeActors.size, 0);
    assert.equal(textSignalListeners.size, 0);
    assert.equal(idleQueue.length, 0);
    assert.equal(popup.transitions.size, 0);
    popup.destroy();
    assert.equal(runIdles(), 0);
    assert.equal(stage.signals.size, 0);
    assert.equal(search.signals.size, 0);
    assert.equal(displaySignals.size, 0);
    assert.equal(settings.signals.size, 0);
});

test('[Lifecycle] a queued result click cannot close a reopened popup', async () => {
    const {popup, search, runIdles} = await createHarness();
    popup.open();
    search._searchResults.activateDefault();
    popup.open();
    runIdles();
    assert.equal(popup._visible, true);
    popup.destroy();
});

test('[Lifecycle] reopening with animations disabled cancels an old close completion', async () => {
    const {popup, animationSettings, runIdles, chromeActors} = await createHarness({enableAnimations: true});
    popup.open();
    popup.close();
    runIdles();
    assert.equal(popup.transitions.size, 1, 'close animation is pending');
    animationSettings.enable_animations = false;
    popup.open();
    assert.equal(popup.transitions.size, 0, 'old completion must be cancelled');
    assert.equal(popup.visible, true);
    assert.equal(popup.opacity, 255);
    assert.equal(chromeActors.size, 2);
    popup.destroy();
    assert.equal(chromeActors.size, 0);
});

test('[Keystroke] redirected text and Backspace reach the entry once and stop the original target', async () => {
    const {popup, entry, search, resultItems, Clutter, dispatchKey} = await createHarness();
    const entryKeys = [];
    const resultKeys = [];
    entry.connect('key-press-event', (_, event) => entryKeys.push(event.get_key_symbol()));
    resultItems[0].connect('key-press-event', (_, event) => resultKeys.push(event.get_key_symbol()));
    popup.open();
    search.visible = true;
    const keys = [Clutter.KEY_a, Clutter.KEY_BackSpace, Clutter.KEY_Cyrillic_ya];
    for (const key of keys) {
        resultItems[0].grab_key_focus();
        assert.equal(dispatchKey({
            type: () => Clutter.EventType.KEY_PRESS,
            get_key_symbol: () => key,
        }), Clutter.EVENT_STOP);
    }
    assert.deepEqual(entryKeys, keys);
    assert.deepEqual(resultKeys, []);
    assert.equal(popup._closeIdleId, 0, 'typing must not activate the original result');
    popup.destroy();
});

test('[Theme] panel follows system style while outside-click surface stays transparent', async () => {
    const {popup, settings} = await createHarness({colorScheme: 'prefer-light'});
    popup.open();
    const backdrop = popup._backdrop;
    const assertTheme = light => {
        assert.equal(popup._content.has_style_class_name('theme-light'), light);
        assert.equal(backdrop._actor.has_style_class_name('theme-light'), false);
        assert.equal(backdrop._actor.effects.size, 0);
    };
    assertTheme(true);
    popup._ifaceSettings.scheme = 'prefer-dark';
    popup._ifaceSettings.emit('changed::color-scheme');
    assertTheme(false);
    settings.theme = 'light';
    settings.emit('changed::theme-preference');
    assertTheme(true);
    popup._ifaceSettings.emit('changed::color-scheme');
    assertTheme(true);
    settings.theme = 'dark';
    settings.emit('changed::theme-preference');
    assertTheme(false);
    popup.destroy();
});

test('[Keystroke] Space activates a focused result and remains text in the entry', async () => {
    const {popup, search, entry, resultItems, stage, Clutter, dispatchKey, runIdles} = await createHarness();
    const space = {type: () => Clutter.EventType.KEY_PRESS, get_key_symbol: () => Clutter.KEY_space};
    let activations = 0;
    let entryKeys = 0;
    resultItems[0].connect('key-press-event', () => { activations++; });
    entry.connect('key-press-event', () => { entryKeys++; });
    popup.open();
    search.visible = true;
    resultItems[0].grab_key_focus();
    assert.equal(dispatchKey(space), Clutter.EVENT_PROPAGATE);
    assert.equal(activations, 1);
    assert.equal(entryKeys, 0);
    assert.equal(stage.get_key_focus(), resultItems[0]);
    assert.ok(popup._closeIdleId !== 0);
    runIdles();
    assert.equal(popup._visible, false);

    popup.open();
    dispatchKey(space);
    assert.equal(entryKeys, 1);
    assert.equal(activations, 1);
    assert.equal(popup._closeIdleId, 0);
    popup.destroy();
});

test('[Theme] Light Style enables and disables update an open popup and clean up Shell settings tracking', async () => {
    const {popup, Main, St, animationSettings, settings} = await createHarness({colorScheme: 'prefer-dark'});
    const {default: LightStyle} = await loadModule(
        'light-style@gnome-shell-extensions.gcampax.github.com/extension.js', {
            mocks: {
                'gi://St': {default: St},
                'resource:///org/gnome/shell/ui/main.js': Main,
            },
        });
    const lightStyle = new LightStyle();
    const assertLight = light => {
        assert.equal(popup._content.has_style_class_name('theme-light'), light);
        assert.equal(popup._backdrop._actor.has_style_class_name('theme-light'), false);
        assert.equal(popup._backdrop._actor.effects.size, 0);
    };
    popup.open();
    assertLight(false);
    lightStyle.enable();
    assert.equal(popup._ifaceSettings.scheme, 'prefer-dark', 'Light Style does not change interface settings');
    assertLight(true);
    lightStyle.disable();
    assertLight(false);

    popup._ifaceSettings.scheme = 'prefer-light';
    Main.sessionMode.colorScheme = 'prefer-dark';
    animationSettings.notify('color-scheme');
    assertLight(false);
    settings.theme = 'light';
    settings.emit('changed::theme-preference');
    assertLight(true);

    const shellSignals = animationSettings.signals.size;
    assert.equal(shellSignals, 1);
    popup.destroy();
    assert.equal(animationSettings.signals.size, 0);
    animationSettings.notify('color-scheme');
});



test('[Mouse activation] holding a result press keeps it mapped until native release activation', async () => {
    const {popup, Main, search, resultItems, runIdles} = await createHarness({enableAnimations: true});
    popup.open();
    popup.complete();
    search.visible = true;
    let activations = 0;
    resultItems[0].connect('button-release-event', () => {
        activations++;
        Main.overview.toggle();
    });
    resultItems[0].emit('button-press-event');
    search.emit('button-press-event');
    runIdles();
    assert.equal(popup._visible, true, 'a held click must not remove the result');
    assert.equal(resultItems[0].get_parent(), search);
    resultItems[0].emit('button-release-event');
    runIdles();
    assert.equal(activations, 1);
    assert.equal(popup._visible, false);
    assert.equal(search.get_parent(), popup._content, 'keep the full panel during its fade');
    popup.complete();
    assert.equal(search.get_parent(), null);
    popup.destroy();
});

test('[Menu focus] result context menu descendants keep focus and handle their own keys', async () => {
    const {popup, search, stage, Clutter, runIdles, dispatchKey} = await createHarness();
    popup.open();
    const menu = new TestActorWithObjectSignals({style_class: 'popup-menu'});
    const menuItem = new TestActorWithObjectSignals({style_class: 'popup-menu-item'});
    menu.add_child(menuItem);
    search.emit('button-press-event', {get_button: () => 3});
    stage.set_key_focus(menuItem);
    runIdles();
    assert.equal(popup._visible, true, 'right-click and menu focus must keep the panel open');
    for (const key of [Clutter.KEY_Escape, Clutter.KEY_Down, Clutter.KEY_a]) {
        assert.equal(dispatchKey({type: () => Clutter.EventType.KEY_PRESS, get_key_symbol: () => key}),
            Clutter.EVENT_PROPAGATE);
    }
    assert.equal(stage.get_key_focus(), menuItem);
    assert.equal(popup._closeIdleId, 0);
    popup.destroy();
});

test('[Sizing] narrow and scaled monitors constrain panel width and result height', async () => {
    for (const scale of [1, 2]) {
        const monitors = [{x: -900, y: -400, width: 900, height: 600}];
        const {popup} = await createHarness({monitors, pointer: [-500, -200], scale});
        popup.open();
        assert.equal(popup.width, Math.min(640 * scale, Math.floor(900 * 0.85)));
        assert.equal(popup.x, Math.floor(-900 + (900 - popup.width) / 2));
        const height = Number(popup._content.get_style().match(/max-height: (\d+)px/)[1]);
        assert.ok(popup.y + height * scale < 200, 'expanded results must fit below the entry');
        assert.deepEqual(popup.pivot, [0.5, 0]);
        popup.destroy();
    }
});

test('[Reopen layout] old results are hidden before measuring the entry position', async () => {
    const {popup, search, runIdles} = await createHarness();
    popup.open();
    const initialY = popup.y;
    search.visible = true;
    popup.close();
    runIdles();
    popup.get_preferred_height = () => [65, search.visible ? 400 : 65];
    popup.open();
    assert.equal(popup.y, initialY);
    assert.equal(search.visible, false);
    popup.destroy();
});
