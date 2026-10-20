import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup(position = 'bottom') {
    const vertical = ['left', 'right'].includes(position);
    let pointer = vertical ? [24, 52] : [52, 24];
    let within = true;
    const settings = {enable_animations: true, reducedMotion: 0};
    const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    class Overlay extends Actor { update() {} }
    const {Animator} = await loadModule('dash2dock-lite@custom/animator.js', {
        globals: {global: {get_pointer: () => pointer}},
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'gi://St': {default: {Icon: Actor, Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://Clutter': {default: {}},
            'gi://Gio': {default: {}},
            './apps/dot.js': {Dot: class {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            './dockItems.js': {DockItemDotsOverlay: Overlay, DockItemBadgeOverlay: Overlay},
            './utils.js': {get_distance_sqr: distanceSquared,
                get_distance: (a, b) => Math.sqrt(distanceSquared(a, b)), isInRect() {}, isOverlapRect() {}},
        },
    });
    const icons = Array.from({length: 5}, (_, i) => {
        const icon = new Actor({x: vertical ? 0 : i * 56, y: vertical ? i * 56 : 0});
        icon._icon = new Actor({icon_name: 'app', gicon: null});
        icon.add_child(icon._icon);
        return icon;
    });
    const dock = {
        extension: {animate_icons_unmute: true, animation_rise: 0.5, animation_magnify: 0.5,
            animation_spread: 0.6, _config: {speed_up: 1}, autohide_speed: 0.5,
            integrations: {bms_update_size() {}}},
        _icons: icons, _iconSize: 48, _iconSizeScaledDown: 48, _scaleFactor: 1,
        _edge_distance: 0, _position: position, _separators: [],
        opacity: 255, width: 280, height: 280, x: 0, y: 0, animation_fps: 1,
        dash: new Actor(), renderArea: new Actor(), struts: new Actor(),
        _background: {x: 0, y: 0, width: 280, height: 48, _padding: 0, update() {}},
        layout: () => true, isVertical: () => vertical,
        getMonitor: () => ({x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1}),
        _isWithinDash: () => within, _updateTransparenies() {}, _debounceEndAnimation() {},
        autohider: {_debounceCheckHide() {}},
    };
    const animator = new Animator();
    animator.dock = dock;
    animator.enable();
    const settle = () => { for (let i = 0; i < 240; i++) animator.animate(16); };
    return {animator, dock, icons, settings, settle,
        move: axis => { pointer = vertical ? [24, axis] : [axis, 24]; },
        leave: () => { within = false; }};
}

for (const position of ['bottom', 'top', 'left', 'right']) {
    test(`${position}: hover is continuous across an icon midpoint`, async () => {
        const {icons, move, settle} = await setup(position);
        move(51.999);
        settle();
        const before = icons.map(i => [i._renderer.x, i._renderer.y, i._renderer.scaleX]);
        move(52.001);
        settle();
        icons.forEach((icon, index) => {
            const after = [icon._renderer.x, icon._renderer.y, icon._renderer.scaleX];
            after.forEach((value, axis) => assert.ok(Math.abs(value - before[index][axis]) < 0.01,
                `icon ${index}, axis ${axis}: ${before[index][axis]} -> ${value}`));
        });
    });
}

test('invisible source icons retain stable geometry for SVG and PNG textures', async () => {
    const {icons, settle} = await setup();
    icons[1]._icon.gicon = {file: {get_path: () => '/tmp/app.svg'}};
    icons[2]._icon.gicon = {file: {get_path: () => '/tmp/app.png'}};
    settle();
    for (const icon of icons) {
        assert.equal(icon._icon.scaleX, 1);
        assert.equal(icon._icon.scaleY, 1);
    }
    assert.ok(icons[1]._renderer.scaleX > 1);
});

test('stationary hover settles exactly and leaving returns every icon to its base size', async () => {
    const {animator, dock, icons, settle, leave} = await setup();
    settle();
    const before = icons.map(i => [i._renderer.x, i._renderer.y, i._renderer.scaleX]);
    for (let i = 0; i < 30; i++) animator.animate(16);
    assert.deepEqual(icons.map(i => [i._renderer.x, i._renderer.y, i._renderer.scaleX]), before);
    leave();
    settle();
    for (const icon of icons) {
        assert.equal(icon._renderer.icon_size * icon._renderer.scaleX, dock._iconSizeScaledDown);
        assert.ok(Math.abs(icon._icon.translationX) < 1e-10);
        assert.ok(Math.abs(icon._icon.translationY) < 1e-10);
    }
});

test('reduced motion disables magnification while retaining usable renderers', async () => {
    const {settings, icons, settle} = await setup();
    settings.reducedMotion = 1;
    settle();
    for (const icon of icons) {
        assert.equal(icon._targetScale, 1);
        assert.equal(icon._renderer.visible, true);
    }
});

test('timer animation objects can be reused without treating them as frame arrays', async () => {
    const {Timer} = await loadModule('dash2dock-lite@custom/timer.js', {
        mocks: {'gi://GLib': {default: {}}},
    });
    const timer = new Timer('test');
    const animation = {_frames: [], _time: 42};
    assert.equal(timer.runAnimation(animation), animation);
    assert.equal(animation._time, 0);
});

test('SineEaseInOut / CosineBell satisfies macOS Sequoia boundary and crest derivatives', async () => {
    const {SineEaseInOut, CosineBell} = await loadModule(
        'dash2dock-lite@custom/effects/easing.js'
    );

    assert.equal(SineEaseInOut, CosineBell);
    assert.equal(SineEaseInOut(0), 0);
    assert.equal(SineEaseInOut(1), 1);
    assert.equal(SineEaseInOut(0.5), 0.5);

    // Clamping checks
    assert.equal(SineEaseInOut(-0.5), 0);
    assert.equal(SineEaseInOut(1.5), 1);

    // Boundary derivative at p=0: df/dp -> 0
    const eps = 1e-5;
    const boundaryDerivative = (SineEaseInOut(eps) - SineEaseInOut(0)) / eps;
    assert.ok(boundaryDerivative < 1e-4, `Boundary derivative must vanish, got ${boundaryDerivative}`);

    // Apex derivative at p=1: df/dp -> 0
    const apexDerivative = (SineEaseInOut(1) - SineEaseInOut(1 - eps)) / eps;
    assert.ok(apexDerivative < 1e-4, `Apex derivative must vanish, got ${apexDerivative}`);

    // Monotonicity check
    let prev = 0;
    for (let p = 0.05; p <= 1.0; p += 0.05) {
        const val = SineEaseInOut(p);
        assert.ok(val > prev, `Expected strictly monotonic increase at p=${p}`);
        prev = val;
    }
});

test('Dock icon scale transitions smoothly without threshold jumping', async () => {
    const {icons, move, settle} = await setup('bottom');
    // Move pointer to the edge of icon 0 threshold
    // Icon 0 center is at x=24. Threshold is (48+10)*2.5*1 = 145px.
    // Edge of influence is at 24 + 145 = 169.
    move(168.999);
    settle();
    const scaleInside = icons[0]._renderer.scaleX;
    move(169.001);
    settle();
    const scaleOutside = icons[0]._renderer.scaleX;

    // Scale difference across the threshold boundary must be negligible (C1 continuity)
    assert.ok(Math.abs(scaleInside - scaleOutside) < 0.001,
        `Threshold scale step too large: ${scaleInside} vs ${scaleOutside}`);
});

test('compiz_getIcon returns stage coordinates and positive 2D bounding box', async () => {
    const monitors = [
        {index: 0, x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1},
        {index: 1, x: 1920, y: 0, width: 1920, height: 1080, geometry_scale: 1},
    ];
    let registeredCompiz = null;
    const Main = {
        layoutManager: {monitors, primaryIndex: 0},
        extensionManager: {
            lookup(id) {
                if (id === 'compiz-alike-magic-lamp-effect@custom')
                    return registeredCompiz;
                return null;
            },
        },
    };
    const trackedApps = new Map();
    const ShellMock = {
        WindowTracker: {
            get_default() {
                return {
                    get_window_app(win) {
                        return trackedApps.get(win) || null;
                    },
                };
            },
        },
    };

    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': Main,
            'gi://Shell': {default: ShellMock},
        },
    });

    const app0 = {get_id: () => 'app0.desktop', get_pids: () => [100]};
    const app1 = {get_id: () => 'app1.desktop', get_pids: () => [200]};

    // Setup dock on monitor 0 and dock on monitor 1
    const dock0Box = new Actor({x: 500, y: 1032, width: 200, height: 48});
    const dock0Child = new Actor({x: 10, y: 0, width: 48, height: 48});
    dock0Child.child = {_delegate: {app: app0}};
    dock0Box.add_child(dock0Child);

    const dock1Box = new Actor({x: 2400, y: 1032, width: 200, height: 48});
    const dock1Child = new Actor({x: 20, y: 0, width: 48, height: 48});
    dock1Child.child = {_delegate: {app: app1}};
    dock1Box.add_child(dock1Child);

    const mockExtension = {
        lamp_app_animation: true,
        docks: [
            {
                getMonitor: () => monitors[0],
                _position: 'bottom',
                _preferredIconSize: () => 48,
                dash: {_box: dock0Box},
            },
            {
                getMonitor: () => monitors[1],
                _position: 'bottom',
                _preferredIconSize: () => 48,
                dash: {_box: dock1Box},
            },
        ],
    };

    const integrations = new Integrations();
    integrations.extension = mockExtension;

    // Test window targeting app0
    const win0 = {get_monitor: () => 0, get_pid: () => 100};
    trackedApps.set(win0, app0);
    const actor0 = {meta_window: win0};

    const icon0 = integrations.compiz_getIcon(actor0);
    assert.equal(icon0.monitorIndex, 0);
    assert.equal(icon0.dockPosition, 'bottom');
    assert.ok(icon0.width > 0, `Width must be > 0, got ${icon0.width}`);
    assert.equal(icon0.width, 48);
    assert.equal(icon0.height, 48);
    assert.equal(icon0.x, 510);
    assert.equal(icon0.y, 1032);

    // Test window targeting app1 on monitor 1
    const win1 = {get_monitor: () => 1, get_pid: () => 200};
    trackedApps.set(win1, app1);
    const actor1 = {meta_window: win1};

    const icon1 = integrations.compiz_getIcon(actor1);
    assert.equal(icon1.monitorIndex, 1);
    assert.equal(icon1.dockPosition, 'bottom');
    assert.equal(icon1.width, 48);
    assert.equal(icon1.height, 48);
    assert.equal(icon1.x, 2420);
    assert.equal(icon1.y, 1032);

    // Test hookCompiz lifecycle
    const originalGetIcon = () => ({x: 0, y: 0, width: 0, height: 0});
    registeredCompiz = {
        stateObj: {
            getIcon: originalGetIcon,
        },
    };
    integrations.hookCompiz(true);
    assert.notEqual(registeredCompiz.stateObj.getIcon, originalGetIcon);
    assert.equal(integrations._originalCompizGetIcon, originalGetIcon);

    integrations.releaseCompiz();
    assert.equal(registeredCompiz.stateObj.getIcon, originalGetIcon);
});

test('Compiz integration falls back once with no docks and releases its retained owner', async () => {
    let current;
    const Main = {
        layoutManager: {monitors: [], primaryIndex: 0},
        extensionManager: {lookup: () => current},
    };
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': Main,
            'gi://Shell': {default: {}},
        },
    });
    const integrations = new Integrations();
    integrations.extension = {lamp_app_animation: true, docks: []};
    let fallbackCount = 0;
    const geometry = {x: 10, y: 20, width: 0, height: 0};
    const original = function (actor) {
        fallbackCount++;
        assert.equal(this, owner);
        return integrations.compiz_getIcon(actor) || geometry;
    };
    const owner = {getIcon: original};
    current = {stateObj: owner};
    integrations.hookCompiz();
    assert.equal(owner.getIcon({}), geometry);
    assert.equal(fallbackCount, 1);
    integrations.hookCompiz();
    assert.equal(owner.getIcon({}), geometry);
    assert.equal(fallbackCount, 2, 'Repeated hook must not wrap itself');

    // The manager can lose the state object before the dock disables.
    current = null;
    integrations.releaseCompiz();
    assert.equal(owner.getIcon, original);

    current = {stateObj: owner};
    integrations.hookCompiz();
    const wrapper = owner.getIcon;
    const laterHook = actor => wrapper(actor);
    owner.getIcon = laterHook;
    integrations.releaseCompiz();
    assert.equal(owner.getIcon, laterHook, 'Another extension retains its hook');
    assert.equal(owner.getIcon({}), geometry);

    integrations.extension.lamp_app_animation = false;
    assert.equal(integrations.compiz_getIcon({}), null);
    integrations.hookCompiz();
    assert.equal(owner.getIcon, laterHook);
});

test('Compiz targets require a matched app icon with real stage geometry', async () => {
    const monitor = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
    const app = {get_id: () => 'app.desktop', get_pids: () => [100]};
    let trackedApp = app;
    let fallbackCount = 0;
    const fallback = {x: 120, y: 1020, width: 48, height: 48};
    const owner = {getIcon() { fallbackCount++; return fallback; }};
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: {monitors: [monitor], primaryIndex: 0},
                extensionManager: {lookup: () => ({stateObj: owner})},
            },
            'gi://Shell': {default: {WindowTracker: {get_default: () => ({
                get_window_app: () => trackedApp,
            })}}},
        },
    });
    const icon = new Actor({x: 600, y: 1032});
    icon.app = app;
    const dock = {_icons: [icon], getMonitor: () => monitor, _position: 'bottom'};
    const integrations = new Integrations();
    integrations.extension = {lamp_app_animation: true, docks: [dock]};
    const actor = {meta_window: {get_monitor: () => 0}};

    trackedApp = {get_id: () => 'other.desktop'};
    assert.equal(integrations.compiz_getIcon(actor), null,
        'An unrelated dock icon must not invent a center-of-dock destination');
    integrations.hookCompiz();
    assert.equal(owner.getIcon(actor), fallback);
    assert.equal(fallbackCount, 1, 'Missing app target delegates to Magic Lamp once');
    integrations.releaseCompiz();

    trackedApp = app;
    dock._icons = [{app}];
    assert.equal(integrations.compiz_getIcon(actor), null,
        'App identity without actor geometry is not a target');
    dock.dash = {_box: {get_children: () => [icon]}};
    assert.equal(integrations.compiz_getIcon(actor).x, 600,
        'An unallocated cached icon must not hide a valid live app icon');
    delete dock.dash;
    dock._icons = [icon];
    const getPosition = icon.get_transformed_position.bind(icon);
    for (const position of [[NaN, 1032], [600, Infinity], [-500, 1200], [600, -500]]) {
        icon.get_transformed_position = () => position;
        assert.equal(integrations.compiz_getIcon(actor), null,
            `Invalid or unrelated off-screen position ${position}`);
    }
    icon.get_transformed_position = getPosition;
    assert.equal(integrations.compiz_getIcon(actor).x, 600);
    monitor.width = Infinity;
    assert.equal(integrations.compiz_getIcon(actor), null, 'Invalid monitors cannot supply a target');
});

test('dynamic icon geometry follows scaled renderers, hidden dock edges and monitor preference', async () => {
    const monitors = [
        {index: 0, x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1},
        {index: 1, x: -1280, y: -100, width: 1280, height: 1024, geometry_scale: 2},
    ];
    const app = {get_id: () => 'app.desktop'};
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: {monitors, primaryIndex: 0},
            },
            'gi://Shell': {default: {WindowTracker: {get_default: () => ({get_window_app: () => app})}}},
        },
    });
    const icon0 = new Actor({x: 600, y: 1000});
    icon0.app = app;
    const icon1 = new Actor();
    icon1.app = app;
    icon1._renderer = new Actor({x: -500, y: 850, width: 48, height: 48, scaleX: 1.5, scaleY: 1.5});
    const docks = monitors.map((monitor, index) => ({
        getMonitor: () => monitor, _position: 'bottom', _preferredIconSize: () => 48,
        _icons: index ? [new Actor()] : [icon0],
        // Even a populated cached _icons array may omit the newly added app.
        dash: {_box: {get_children: () => index ? [icon1] : [icon0]}},
    }));
    const integrations = new Integrations();
    integrations.extension = {lamp_app_animation: true, docks};
    const actor = {meta_window: {get_monitor: () => 1}};
    const visible = integrations.compiz_getIcon(actor);
    assert.equal(visible.monitorIndex, 1);
    assert.equal(visible.x, -500);
    assert.equal(visible.y, 850);
    assert.equal(visible.width, 72, 'Transformed stage size must not be scaled twice');
    assert.equal(visible.height, 72);

    for (const [side, x, y, expectedX, expectedY] of [
        ['bottom', -500, 1100, -500, 852],
        ['top', -500, -300, -500, -100],
        ['left', -1400, 500, -1280, 500],
        ['right', 100, 500, -72, 500],
    ]) {
        docks[1]._position = side;
        icon1._renderer.set_position(x, y);
        const hidden = integrations.compiz_getIcon(actor);
        assert.equal(hidden.x, expectedX, side);
        assert.equal(hidden.y, expectedY, side);
        assert.equal(hidden.dockPosition, side);
    }

    icon1._renderer.get_transformed_size = () => [Infinity, NaN];
    docks[1]._preferredIconSize = () => NaN;
    const invalid = integrations.compiz_getIcon(actor);
    for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(Number.isFinite(invalid[key]), key);
    assert.ok(invalid.width > 0 && invalid.height > 0);
});

test('frame timer advances animations by elapsed time at 60/120 Hz and releases its timeline', async () => {
    const timelines = [];
    class Timeline extends Actor {
        constructor(params) { super(params); timelines.push(this); }
        start() { this.playing = true; }
        stop() { this.playing = false; }
        get_delta() { return this.delta; }
        tick(delta) { this.delta = delta; this.emit('new-frame'); }
    }
    const stage = new Actor();
    const {FrameTimer} = await loadModule('dash2dock-lite@custom/frameTimer.js', {
        mocks: {
            'gi://Clutter': {default: {Timeline}},
            'gi://GLib': {default: {timeout_add() { throw new Error('Unexpected GLib animation timer'); }}},
        },
    });
    for (const hz of [60, 120]) {
        const timer = new FrameTimer('test', stage);
        timer.initialize(15);
        let elapsed = 0;
        let frames = 0;
        const loop = timer.runLoop((_sequence, dt) => { elapsed += dt; frames++; }, 15);
        const timeline = timelines.at(-1);
        assert.equal(timeline.actor, stage);
        assert.equal(timeline.repeat_count, -1);
        timer.runLoop(loop);
        assert.equal(timelines.at(-1), timeline, 'Reusing a loop must not start another timeline');
        for (let frame = 0; frame < hz; frame++) timeline.tick(1000 / hz);
        assert.equal(frames, hz);
        assert.ok(Math.abs(elapsed - 1000) < 1e-6, `${hz} Hz: elapsed=${elapsed}`);
        timeline.tick(30000);
        assert.ok(Math.abs(elapsed - 1064) < 1e-6, 'Suspend delta is bounded');
        timer.cancel(loop);
        for (let frame = 0; frame < hz; frame++) timeline.tick(1000 / hz);
        assert.equal(timer.is_running(), false, 'Idle animation timer hibernates');
        assert.equal(timeline.playing, false);
        assert.equal(timeline.signals.size, 0);
        timer.runLoop(loop);
        const resumed = timelines.at(-1);
        assert.notEqual(resumed, timeline);
        timer.shutdown();
        assert.equal(resumed.playing, false);
        assert.equal(resumed.signals.size, 0);
        assert.equal(timer._subscribers.length, 0);
    }
});

test('Sequoia colors follow light/dark mode while explicit user colors retain their alpha', async () => {
    const {dockColor} = await loadModule('dash2dock-lite@custom/appearance.js');
    const custom = [0.1, 0.2, 0.3, 0.125];
    for (const name of ['background-color', 'border-color', 'separator-color', 'running-indicator-color']) {
        for (const scheme of ['dark', 'light'])
            assert.equal(dockColor(name, custom, scheme, true), custom);
    }
    const dark = dockColor('running-indicator-color', custom, 'dark');
    const light = dockColor('running-indicator-color', custom, 'light');
    assert.ok(dark[0] > light[0], 'Indicators contrast with the light/dark dock');
    assert.equal(dockColor('border-color', custom, 'dark')[3], 0.25);

    const {Style} = await loadModule('dash2dock-lite@custom/style.js', {
        mocks: {
            'gi://Gio': {default: {}}, 'gi://GLib': {default: {}}, 'gi://St': {default: {}},
            './utils.js': {tempPath() {}},
        },
    });
    const style = new Style();
    assert.equal(style.rgba([1, 1, 1, 0.25]), '255,255,255,0.25');
    assert.equal(style.rgba(custom), '25,51,76,0.125');
});

test('default running indicator paints one 4px dot and repaints only when appearance changes', async () => {
    const arcs = [];
    const context = Object.fromEntries(['setOperator', 'paint', 'setLineWidth', 'setLineCap',
        'save', 'restore', 'translate', 'rotate', 'newSubPath', 'fill', '$dispose'].map(name => [name, () => {}]));
    context.arc = (...args) => arcs.push(args);
    class Widget extends Actor {
        constructor(...args) { super(); this._init(...args); }
        _init() {}
    }
    class DrawingArea extends Widget {
        get_context() { return context; }
        get_surface_size() { return [this.width, this.height]; }
        queue_repaint() { this.repaints = (this.repaints || 0) + 1; }
    }
    const {Dot} = await loadModule('dash2dock-lite@custom/apps/dot.js', {
        mocks: {
            'gi://GObject': {default: {registerClass: (...args) => args.at(-1)}},
            'gi://Clutter': {default: {}},
            'gi://cairo': {default: {Operator: {CLEAR: 0, SOURCE: 1}, LineCap: {ROUND: 0}}},
            'gi://St': {default: {Widget, DrawingArea}},
            '../drawing.js': {Drawing: {set_color() {}}},
        },
    });
    const dot = new Dot(96);
    const canvas = dot._canvas;
    const state = {style: 'default', count: 3, color: [1, 1, 1, 0.75], diameter: 8};
    dot.set_state(state);
    assert.equal(canvas.repaints, 1);
    dot.set_state({...state, color: [...state.color]});
    assert.equal(canvas.repaints, 1, 'Equivalent appearance must not schedule another repaint');
    canvas.vfunc_repaint();
    assert.equal(arcs.length, 1, 'Default style uses a single running dot');
    assert.equal(arcs[0][2] * 2 * (48 / 96), 4, 'Diameter after canvas scaling is 4 logical px');
    dot.set_state({...state, diameter: 16});
    assert.equal(canvas.repaints, 2, 'A changed scale must repaint the dot');
    dot.set_state({...state, count: 0});
    canvas.vfunc_repaint();
    assert.equal(arcs.length, 1, 'Closed apps do not paint a running dot');
});

test('Dock follows real light-style St notifications over interface preferences and releases the listener', async () => {
    class Signals extends Actor {
        connectObject(...args) {
            const owner = args.at(-1);
            for (let i = 0; i < args.length - 1; i += 2) {
                const id = this.connect(args[i], args[i + 1]);
                this.signals.get(id).owner = owner;
            }
        }
        disconnectObject(owner) {
            for (const [id, signal] of this.signals) {
                if (signal.owner === owner) this.disconnect(id);
            }
        }
        notify(name) { this.emit(`notify::${name}`); }
    }
    const stSettings = new Signals();
    const textureCache = new Signals();
    const themeContext = new Signals();
    const appSystem = new Signals();
    const appFavorites = new Signals();
    const Main = Object.fromEntries(['sessionMode', 'extensionManager', 'layoutManager',
        'messageTray', 'overview'].map(name => [name, new Signals()]));
    Main.sessionMode.colorScheme = 'default';
    const St = {Settings: {get: () => stSettings}, TextureCache: {get_default: () => textureCache},
        ThemeContext: {get_for_stage: () => themeContext}};
    const globalMock = {display: new Signals(), stage: new Signals()};
    const sharedMocks = {
        'resource:///org/gnome/shell/ui/main.js': Main,
        'gi://St': {default: St},
    };
    const {default: DockExtension} = await loadModule('dash2dock-lite@custom/extension.js', {
        globals: {global: globalMock},
        mocks: {
            ...sharedMocks,
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => appFavorites},
            'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}, gettext: value => value},
            'gi://Shell': {default: {AppSystem: {get_default: () => appSystem}}},
            'gi://Graphene': {default: {}}, 'gi://Gio': {default: {}}, 'gi://GLib': {default: {}},
            './utils.js': {tempPath() {}, trySpawnCommandLine() {}, loadFile() {}},
            './timer.js': {Timer: class {}}, './frameTimer.js': {FrameTimer: class {}},
            './style.js': {Style: class {}}, './dock.js': {Dock: class {}},
            './services.js': {Services: class {}}, './integrations.js': {Integrations: class {}},
            './diagnostics.js': {runTests() {}},
            './preferences/keys.js': {schemaId: 'test', SettingsKeys() {}},
        },
    });
    const {default: LightStyle} = await loadModule(
        'light-style@custom/extension.js', {mocks: sharedMocks});
    const dock = new DockExtension();
    let interfacePreference = 'prefer-dark';
    dock._interfaceSettings = {get_string: () => interfacePreference};
    dock._timer = {runLoop() {}};
    const updates = [];
    dock._updateStyle = () => updates.push(dock._getPreferredColorScheme());
    dock.animate = () => {};
    dock._addEvents();
    assert.equal(dock._getPreferredColorScheme(), 'dark');
    const lightStyle = new LightStyle();
    lightStyle.enable();
    assert.equal(updates.at(-1), 'light', 'Session override wins over the dark interface preference');
    lightStyle.disable();
    assert.equal(updates.at(-1), 'dark', 'Disabling light-style restores the effective preference');
    interfacePreference = 'prefer-light';
    Main.sessionMode.colorScheme = 'prefer-dark';
    stSettings.notify('color-scheme');
    assert.equal(updates.at(-1), 'dark', 'Explicit dark session mode also wins');
    const updateCount = updates.length;
    dock._removeEvents();
    lightStyle.enable();
    assert.equal(updates.length, updateCount, 'Disabled dock no longer responds to St notifications');
    assert.equal(stSettings.signals.size, 0);
    lightStyle.disable();
});

test('DockItemMenu initializes completely hidden with zero opacity and stays invisible on startup', async () => {
    class MockPopupMenu {
        constructor() {
            this.actor = new Actor();
            this.isOpen = false;
        }
        addAction(name, cb) {
            return {name, cb, emit() {}};
        }
        open() {
            this.isOpen = true;
            this.actor.visible = true;
        }
        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.actor.visible = false;
        }
    }
    class MockPopupMenuManager {
        addMenu() {}
        ignoreRelease() {}
    }
    const uiGroup = new Actor();
    const Main = {
        uiGroup,
        overview: {d2dl: {}},
    };
    const desktopAppMock = {
        get_name: () => 'Trash',
        get_icon: () => ({ get_names: () => ['user-trash'] }),
        list_actions: () => ['trash'],
        get_action_name: () => 'Empty Trash',
        launch: () => {},
        launch_action: () => {},
    };

    const dockItemsModule = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': Main,
            'resource:///org/gnome/shell/ui/boxpointer.js': {PopupAnimation: {FULL: 1}},
            'resource:///org/gnome/shell/ui/popupMenu.js': {
                PopupMenu: MockPopupMenu,
                PopupMenuManager: MockPopupMenuManager,
            },
            './utils.js': {trySpawnCommandLine: async () => {}},
            'resource:///org/gnome/shell/ui/dash.js': {
                Dash: class {},
                DashIcon: class extends Actor {},
                DashItemContainer: class extends Actor {
                    constructor(...args) {
                        super(...args);
                        if (typeof this._init === 'function')
                            this._init(...args);
                    }
                    _init(params) { Object.assign(this, params); }
                    setChild(c) { this.child = c; }
                    setLabelText() {}
                },
            },
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom'}},
            'gi://Shell': {
                default: {AppSystem: {get_default: () => ({get_installed: () => []})}},
                AppSystem: {get_default: () => ({get_installed: () => []})},
            },
            'gi://Gio': {default: {}},
            'gi://GObject': {
                default: {
                    registerClass: (meta, cls) => cls,
                },
                registerClass: (meta, cls) => cls,
            },
            'gi://Clutter': {
                default: {
                    get_default_text_direction: () => 0,
                    TextDirection: {RTL: 1},
                },
                get_default_text_direction: () => 0,
                TextDirection: {RTL: 1},
            },
            'gi://St': {
                default: {
                    Side: {TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3},
                    Widget: class extends Actor {},
                },
                Side: {TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3},
                Widget: class extends Actor {},
            },
        },
    });

    const item = new dockItemsModule.DockItemContainer({
        appinfo_filename: 'trash-dash2dock-lite.desktop',
        app: desktopAppMock,
    });

    // 1. Verify that menu actor was added to uiGroup but is completely hidden with 0 opacity
    assert.equal(uiGroup.children.includes(item._menu.actor), true);
    assert.equal(item._menu.actor.visible, false, 'Menu actor must be hidden on startup');
    assert.equal(item._menu.actor.opacity, 0, 'Menu actor must have 0 opacity on startup');

    // 2. Calling popup() should open and restore opacity
    item._menu.popup();
    assert.equal(item._menu.isOpen, true);
    assert.equal(item._menu.actor.opacity, 255);

    // 3. Calling close() should hide and reset opacity
    item._menu.close();
    assert.equal(item._menu.actor.visible, false);
    assert.equal(item._menu.actor.opacity, 0);
});
