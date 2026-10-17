import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

test('target resolution prefers the live dock, rejects stale geometry and ignores the hidden Overview dash', async () => {
    const monitor = {x: -1280, y: -100, width: 1280, height: 1024};
    const metaIcon = {x: -600, y: 852, width: 48, height: 48};
    let provider = () => ({x: -500, y: 840, width: 72, height: 72, dockPosition: 'bottom'});
    let geometry = [true, metaIcon];
    const Main = {
        layoutManager: {monitors: [monitor]},
        overview: {dash: {_box: {get_children() { throw new Error('Hidden Overview must not be a target'); }}}},
        extensionManager: {lookup: () => ({stateObj: {integrations: {compiz_getIcon: actor => provider(actor)}}})},
    };
    const {default: Extension} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {default: {DeformEffect: class {}}},
                'gi://St': {default: {}},
                'gi://GLib': {default: {}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': Main,
                './settings_data.js': {SettingsData: class {}},
            },
        });
    const extension = new Extension();
    const actor = {meta_window: {get_icon_geometry: () => geometry, get_monitor: () => 0}};
    assert.equal(extension.getIcon(actor).x, -500, 'Magnified live renderer wins over Meta cache');
    provider = () => null;
    assert.equal(extension.getIcon(actor).x, metaIcon.x, 'A real Meta target remains supported');
    provider = () => ({...metaIcon, width: NaN});
    assert.equal(extension.getIcon(actor).x, metaIcon.x, 'Invalid provider continues to Meta');
    provider = () => null;
    for (const invalid of [null, {}, {...metaIcon, width: 0}, {...metaIcon, height: -1},
        {...metaIcon, x: Infinity}, {...metaIcon, x: 8000}, {...metaIcon, width: 8000}]) {
        geometry = [true, invalid];
        assert.equal(extension.getIcon(actor), null, JSON.stringify(invalid));
    }
    geometry = [false, metaIcon];
    assert.equal(extension.getIcon(actor), null, 'No app target stays absent');
    delete actor.meta_window.get_icon_geometry;
    assert.equal(extension.getIcon(actor), null, 'Missing Wayland geometry API stays absent');
});

test('minimize and restore complete without deformation during reduced motion or workspace gestures', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const windowManager = new Actor();
    let minimized = 0;
    let restored = 0;
    const Main = {overview: {visible: false}, wm: {
        _shouldAnimateActor() {}, _workspaceAnimation: {gestureActive: false},
        _shellwm: {completed_minimize: () => minimized++, completed_unminimize: () => restored++},
    }};
    const {default: Extension} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            globals: {global: {window_manager: windowManager, get_window_actors: () => []}},
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {default: {DeformEffect: class {}}},
                'gi://St': {default: {Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}}},
                'gi://GLib': {default: {}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': Main,
                './settings_data.js': {SettingsData: class {}},
            },
        });
    const extension = new Extension();
    extension.getSettings = () => ({});
    extension.enable();
    let animated = 0;
    extension.animate = () => animated++;
    const reasons = ['reducedMotion', 'animationsDisabled', 'gesture', 'heldGesture', 'keyboardSwitch', 'overview'];
    for (const reason of reasons) {
        settings.reducedMotion = reason === 'reducedMotion' ? 1 : 0;
        settings.enable_animations = reason !== 'animationsDisabled';
        Main.wm._workspaceAnimation.gestureActive = reason === 'gesture';
        Main.wm._workspaceAnimation._switchData = ['heldGesture', 'keyboardSwitch'].includes(reason)
            ? {gestureActivated: false, inProgress: reason === 'keyboardSwitch'} : null;
        Main.overview.visible = reason === 'overview';
        windowManager.emit('minimize', new Actor());
        windowManager.emit('unminimize', new Actor());
    }
    assert.equal(animated, 0);
    assert.equal(minimized, reasons.length);
    assert.equal(restored, reasons.length);
    Main.overview.visible = false;
    windowManager.emit('minimize', new Actor());
    assert.equal(animated, 1);
    extension.disable();
});

test('MagicLamp narrows the funnel to the incoming icon edge without folding on all 4 dock sides', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const settingsData = {
        EFFECT: {get: () => 'default'},
        DURATION: {get: () => 400},
        X_TILES: {get: () => 10},
        Y_TILES: {get: () => 10},
    };
    const StSide = {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3};
    const dockPositions = ['top', 'right', 'bottom', 'left'];
    const {MagicLampMinimizeEffect} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {
                    default: {
                        Timeline: class extends Actor {
                            start() {}
                            stop() {}
                        },
                        DeformEffect: class extends Actor {
                            _init() {}
                            constructor(params) {
                                super(params);
                                this._init(params);
                            }
                            vfunc_set_actor(actor) { this.actor = actor; }
                            get_actor() { return this.actor ?? null; }
                            set_n_tiles() {}
                        },
                    },
                },
                'gi://St': {default: {Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}, Side: StSide}},
                'gi://GLib': {default: {}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': {
                    layoutManager: {monitors: [
                        {x: 0, y: 0, width: 1920, height: 1080},
                        {x: 1920, y: 0, width: 1920, height: 1080},
                        {x: -1920, y: -1080, width: 1920, height: 2160},
                        {x: 1920, y: -1080, width: 1920, height: 1080},
                    ]},
                    wm: {_shellwm: {original_completed_minimize() {}}},
                },
                './settings_data.js': {SettingsData: class {}},
            },
        }
    );

    const window = {x: 200, y: 150, width: 800, height: 600, scale: 1};
    const testCases = [
        {side: StSide.BOTTOM, icon: {x: 600, y: 1000, width: 64, height: 48}},
        {side: StSide.TOP, icon: {x: 600, y: 20, width: 64, height: 48}},
        {side: StSide.LEFT, icon: {x: 10, y: 400, width: 48, height: 64}},
        {side: StSide.RIGHT, icon: {x: 1860, y: 400, width: 48, height: 64}},
        // A floating dock can overlap a maximized source window.
        {side: StSide.BOTTOM, icon: {x: 600, y: 680, width: 64, height: 48}},
        {side: StSide.LEFT, icon: {x: 230, y: 400, width: 48, height: 64}},
        {side: StSide.TOP, icon: {x: 600, y: 170, width: 64, height: 48}},
        {side: StSide.RIGHT, icon: {x: 920, y: 400, width: 48, height: 64}},
        // Diagonal targets on outputs to the right, left and above.
        {side: StSide.RIGHT, icon: {x: 2400, y: 960, width: 48, height: 48}},
        {side: StSide.LEFT, icon: {x: -1200, y: -400, width: 64, height: 48}},
        {side: StSide.TOP, icon: {x: 2100, y: -1100, width: 48, height: 48}},
        // The icon box overlaps the opposite window edge, but the incoming
        // aperture lies behind it. Choose the safe side before narrowing.
        {side: StSide.BOTTOM, finalSide: StSide.TOP, icon: {x: 600, y: 100, width: 64, height: 100}},
        {side: StSide.TOP, finalSide: StSide.BOTTOM, icon: {x: 600, y: 700, width: 64, height: 100}},
        {side: StSide.LEFT, finalSide: StSide.RIGHT, icon: {x: 950, y: 400, width: 100, height: 64}},
        {side: StSide.RIGHT, finalSide: StSide.LEFT, icon: {x: 150, y: 400, width: 100, height: 64}},
        {side: StSide.BOTTOM, icon: {x: 600.25, y: 1000.5, width: 0.25, height: 0.5}},
    ];

    for (const {side: dockSide, finalSide, icon} of testCases) {
        const side = finalSide ?? dockSide;
        const effect = new MagicLampMinimizeEffect({settingsData,
            icon: {...icon, dockPosition: dockPositions[dockSide]}});
        const actor = new Actor(window);
        actor.meta_window = {get_monitor: () => 0};
        actor.get_size = () => [window.width, window.height];
        actor.get_x = () => window.x;
        actor.get_y = () => window.y;
        actor.remove_effect = () => {};
        effect.vfunc_set_actor(actor);
        assert.equal(effect.fallback, false, 'Real targets use the funnel');
        assert.equal(effect.toTheBorder, false);
        assert.equal(effect.iconPosition, side, 'The incoming aperture stays ahead of the tail');
        for (const key of ['x', 'y', 'width', 'height'])
            assert.equal(effect.icon[key], icon[key], 'Keep full icon geometry for targeting');

        const aperture = Math.min(1, icon.width, icon.height);
        const target = {
            x: side === StSide.RIGHT ? icon.x
                : side === StSide.LEFT ? icon.x + icon.width - aperture
                : icon.x + (icon.width - aperture) / 2,
            y: side === StSide.BOTTOM ? icon.y
                : side === StSide.TOP ? icon.y + icon.height - aperture
                : icon.y + (icon.height - aperture) / 2,
            width: aperture,
            height: aperture,
        };

        // 1. Check un-deformed geometry at start: k=0, j=0
        effect.k = 0;
        effect.j = 0;
        for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
            const v = {tx, ty, x: 0, y: 0};
            effect.vfunc_deform_vertex(window.width, window.height, v);
            const stageX = window.x + v.x;
            const stageY = window.y + v.y;
            assert.ok(Math.abs(stageX - (window.x + tx * window.width)) < 1e-6,
                `Side ${side} start X mismatch at (${tx}, ${ty}): ${stageX}`);
            assert.ok(Math.abs(stageY - (window.y + ty * window.height)) < 1e-6,
                `Side ${side} start Y mismatch at (${tx}, ${ty}): ${stageY}`);
        }

        // 2. Check full convergence at completion: k=1, j=1
        effect.k = 1;
        effect.j = 1;
        for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
            const v = {tx, ty, x: 0, y: 0};
            effect.vfunc_deform_vertex(window.width, window.height, v);
            const stageX = window.x + v.x;
            const stageY = window.y + v.y;
            const expectedX = target.x + tx * target.width;
            const expectedY = target.y + ty * target.height;
            assert.ok(Math.abs(stageX - expectedX) < 1e-6,
                `Side ${side} complete X mismatch at (${tx}, ${ty}): expected ${expectedX}, got ${stageX}`);
            assert.ok(Math.abs(stageY - expectedY) < 1e-6,
                `Side ${side} complete Y mismatch at (${tx}, ${ty}): expected ${expectedY}, got ${stageY}`);
        }

        // Once the neck reaches the icon, its visible end is almost a point
        // while the rest of the window is still being pulled into the funnel.
        effect._updateProgress(0.6);
        assert.equal(effect.k, 1);
        assert.ok(effect.j < 1);
        for (const effectType of ['default', 'sine']) {
            effect.EFFECT = effectType;
            const horizontal = side === StSide.LEFT || side === StSide.RIGHT;
            const incoming = side === StSide.LEFT || side === StSide.TOP ? 0 : 1;
            const edge = [0, 1].map(cross => {
                const vertex = {tx: horizontal ? incoming : cross,
                    ty: horizontal ? cross : incoming, x: 0, y: 0};
                effect.vfunc_deform_vertex(window.width, window.height, vertex);
                return [window.x + vertex.x, window.y + vertex.y];
            });
            const tipWidth = horizontal ? edge[1][1] - edge[0][1] : edge[1][0] - edge[0][0];
            assert.ok(tipWidth > 0 && tipWidth <= 1 + 1e-6,
                `Side ${side}, ${effectType}: tip must be at most 1 stage unit, got ${tipWidth}`);
            assert.ok(Math.abs(tipWidth - aperture) < 1e-6);
            const tipCenter = horizontal ? (edge[0][1] + edge[1][1]) / 2
                : (edge[0][0] + edge[1][0]) / 2;
            const iconCenter = horizontal ? icon.y + icon.height / 2 : icon.x + icon.width / 2;
            assert.ok(Math.abs(tipCenter - iconCenter) < 1e-6,
                'The narrow tip is centered across the incoming icon edge');
            const tail = [0, 1].map(cross => {
                const vertex = {tx: horizontal ? 1 - incoming : cross,
                    ty: horizontal ? cross : 1 - incoming, x: 0, y: 0};
                effect.vfunc_deform_vertex(window.width, window.height, vertex);
                return horizontal ? vertex.y : vertex.x;
            });
            assert.ok(tail[1] - tail[0] > aperture,
                'The trailing edge stays wider than the narrow tip during the funnel phase');
        }

        // Every mesh cell must keep its orientation throughout the animation;
        // finite endpoints alone miss folded or wildly overshooting meshes.
        for (let p = 0; p <= 1.0; p += 0.1) {
            effect._updateProgress(p);
            for (const effectType of ['default', 'sine']) {
                effect.EFFECT = effectType;
                const point = (tx, ty) => {
                    const v = {tx, ty, x: 0, y: 0};
                    effect.vfunc_deform_vertex(window.width, window.height, v);
                    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
                    const x = window.x + v.x, y = window.y + v.y;
                    assert.ok(x >= Math.min(window.x, icon.x) - 1e-6 &&
                        x <= Math.max(window.x + window.width, icon.x + icon.width) + 1e-6);
                    assert.ok(y >= Math.min(window.y, icon.y) - 1e-6 &&
                        y <= Math.max(window.y + window.height, icon.y + icon.height) + 1e-6);
                    return [x, y];
                };
                const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) -
                    (b[1] - a[1]) * (c[0] - a[0]);
                for (let row = 0; row < 10; row++) {
                    for (let column = 0; column < 10; column++) {
                        const a = point(column / 10, row / 10);
                        const b = point((column + 1) / 10, row / 10);
                        const c = point((column + 1) / 10, (row + 1) / 10);
                        const d = point(column / 10, (row + 1) / 10);
                        assert.ok(area(a, b, c) > 0 && area(a, c, d) > 0,
                            `Folded cell: side=${side}, p=${p}, effect=${effectType}, cell=${column},${row}`);
                    }
                }
            }
        }
        effect.destroy();
        assert.equal(actor.signals.size, 0);
    }

    // 4. Safe fallback with zero-dimension icon
    const effect = new MagicLampMinimizeEffect({settingsData});
    effect.initialized = true;
    effect.window = {...window};
    effect.iconPosition = StSide.BOTTOM;
    effect.icon = {x: 960, y: 1080, width: 0, height: 0};
    effect.k = 1;
    effect.j = 1;
    const vZero = {tx: 0.5, ty: 1, x: 0, y: 0};
    effect.vfunc_deform_vertex(window.width, window.height, vZero);
    assert.ok(Number.isFinite(vZero.x));
    assert.ok(Number.isFinite(vZero.y));
});

test('invalid or missing targets use a short local shrink and fade instead of an invented dock destination', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const settingsData = {
        EFFECT: {get: () => 'default'},
        DURATION: {get: () => 400},
        X_TILES: {get: () => 10},
        Y_TILES: {get: () => 10},
    };
    const StSide = {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3};
    const monitors = [
        {x: 0, y: 0, width: 1920, height: 1080},
        {x: 1920, y: 0, width: 1920, height: 1080},
    ];
    const {MagicLampMinimizeEffect} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {
                    default: {
                        Timeline: class extends Actor {
                            start() {}
                            stop() {}
                            get_progress() { return 0; }
                        },
                        DeformEffect: class extends Actor {
                            _init() {}
                            constructor(params) {
                                super(params);
                                this._init(params);
                            }
                            vfunc_set_actor() {}
                            get_actor() { return this.actor; }
                            set_n_tiles() {}
                            invalidate() {}
                        },
                    },
                },
                'gi://St': {default: {Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}, Side: StSide}},
                'gi://GLib': {default: {idle_add: () => 1, source_remove() {}}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': {
                    overview: {visible: false, dash: null},
                    layoutManager: {monitors},
                    wm: {_shellwm: {original_completed_minimize() {}, original_completed_unminimize() {}}},
                },
                './settings_data.js': {SettingsData: class {}},
            },
        }
    );

    const winActor = new Actor({width: 800, height: 600, x: 200, y: 150});
    winActor.meta_window = {get_monitor: () => 0};
    winActor.get_size = () => [800, 600];
    winActor.get_x = () => 200;
    winActor.get_y = () => 150;
    winActor.remove_effect = () => {};

    const fallbackScenarios = [
        {
            name: 'undefined dimensions on BOTTOM dock',
            icon: {x: 500, y: 1000, width: undefined, height: undefined, dockPosition: 'bottom'},
        },
        {
            name: 'undefined dimensions on LEFT dock',
            icon: {x: 0, y: 500, width: undefined, height: undefined, dockPosition: 'left'},
        },
        {
            name: 'undefined dimensions on TOP dock',
            icon: {x: 500, y: 0, width: undefined, height: undefined, dockPosition: 'top'},
        },
        {
            name: 'undefined dimensions on RIGHT dock',
            icon: {x: 1920, y: 500, width: undefined, height: undefined, dockPosition: 'right'},
        },
        {
            name: 'empty icon object {}',
            icon: {},
        },
        {
            name: 'asymmetric non-positive width (-10) with positive height (48)',
            icon: {x: 500, y: 1000, width: -10, height: 48, dockPosition: 'bottom'},
        },
        {
            name: 'asymmetric positive width (48) with non-positive height (-10)',
            icon: {x: 0, y: 500, width: 48, height: -10, dockPosition: 'left'},
        },
        {
            name: 'non-finite coordinates (x: NaN, y: NaN) with valid dimensions',
            icon: {x: NaN, y: NaN, width: 48, height: 48, dockPosition: 'bottom'},
        },
        {
            name: 'non-finite coordinates (x: NaN, y: NaN) with undefined dimensions',
            icon: {x: NaN, y: NaN},
        },
        {
            name: 'cross-monitor icon with undefined dimensions',
            icon: {x: 2500, y: 1000, width: undefined, height: undefined, monitorIndex: 1, dockPosition: 'bottom'},
        },
        {
            name: 'null icon object',
            icon: null,
        },
    ];

    for (const scenario of fallbackScenarios) {
        const effect = new MagicLampMinimizeEffect({settingsData, icon: scenario.icon});
        effect.actor = winActor;
        effect.vfunc_set_actor(winActor);

        assert.equal(effect.fallback, true, scenario.name);
        assert.equal(effect.timerId.duration, 160, 'A fallback should be brief regardless of window area');
        assert.equal(effect.icon.x + effect.icon.width / 2,
            effect.window.x + effect.window.width / 2, 'Fallback keeps the window center');
        assert.equal(effect.icon.y + effect.icon.height / 2,
            effect.window.y + effect.window.height / 2, 'Fallback keeps the window center');
        assert.equal(effect.icon.width, effect.window.width * 0.94);
        assert.equal(effect.icon.height, effect.window.height * 0.94);

        // 1. Post-sanitization coordinate and dimension integrity
        assert.ok(Number.isFinite(effect.icon.x),
            `${scenario.name}: effect.icon.x must be finite, got ${effect.icon.x}`);
        assert.ok(Number.isFinite(effect.icon.y),
            `${scenario.name}: effect.icon.y must be finite, got ${effect.icon.y}`);
        assert.ok(Number.isFinite(effect.icon.width) && effect.icon.width >= 0,
            `${scenario.name}: effect.icon.width must be finite and >= 0, got ${effect.icon.width}`);
        assert.ok(Number.isFinite(effect.icon.height) && effect.icon.height >= 0,
            `${scenario.name}: effect.icon.height must be finite and >= 0, got ${effect.icon.height}`);

        // 2. Continuous mesh deformation across animation timeline (p from 0 to 1) produces 100% finite coordinates
        for (let p = 0; p <= 1.0; p += 0.2) {
            effect._updateProgress(p);
            for (const shader of ['default', 'sine']) {
                effect.EFFECT = shader;
                for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
                    const v = {tx, ty, x: 0, y: 0};
                    effect.vfunc_deform_vertex(winActor.width, winActor.height, v);
                    assert.ok(Number.isFinite(v.x),
                        `${scenario.name} [shader=${shader}, p=${p}, tx=${tx}, ty=${ty}]: v.x must be finite, got ${v.x}`);
                    assert.ok(Number.isFinite(v.y),
                        `${scenario.name} [shader=${shader}, p=${p}, tx=${tx}, ty=${ty}]: v.y must be finite, got ${v.y}`);
                }
            }
        }

        // 3. Final convergence at completion (k=1, j=1) into sanitized non-negative target boundary
        effect._updateProgress(1);
        assert.equal(winActor.opacity, 0);
        for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
            const v = {tx, ty, x: 0, y: 0};
            effect.vfunc_deform_vertex(winActor.width, winActor.height, v);
            const stageX = effect.window.x + v.x;
            const stageY = effect.window.y + v.y;
            const expectedX = effect.icon.x + tx * effect.icon.width;
            const expectedY = effect.icon.y + ty * effect.icon.height;
            assert.ok(Math.abs(stageX - expectedX) < 1e-5,
                `${scenario.name} completion convergence: stageX=${stageX} != expectedX=${expectedX}`);
            assert.ok(Math.abs(stageY - expectedY) < 1e-5,
                `${scenario.name} completion convergence: stageY=${stageY} != expectedY=${expectedY}`);
        }
        effect.destroy();
        assert.equal(winActor.opacity, 255, 'Cleanup restores original actor opacity');
        assert.equal(winActor.signals.size, 0, 'Fallback releases actor signals');
    }
});

test('cross-monitor effects stop on gestures and disable drains detached snapshots exactly once', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const settingsData = Object.fromEntries(Object.entries({EFFECT: 'default', DURATION: 400,
        X_TILES: 10, Y_TILES: 10}).map(([name, value]) => [name, {get: () => value}]));
    const idles = new Map();
    let nextIdle = 1;
    const timelines = [];
    class WindowActor extends Actor {
        get_size() { return [this.width, this.height]; }
        get_x() { return this.x; }
        get_y() { return this.y; }
        queue_redraw() {}
        paint_to_content() { return {}; }
        get_effect(name) { return this.effects?.get(name) ?? null; }
        add_effect_with_name(name, effect) {
            this.effects ??= new Map();
            this.effects.set(name, effect);
            effect.vfunc_set_actor(this);
        }
        remove_effect(effect) {
            for (const [name, current] of this.effects ?? []) {
                if (current === effect) this.effects.delete(name);
            }
            effect.vfunc_set_actor(null);
        }
    }
    class DeformEffect extends Actor {
        constructor(params) { super(); this._init(params); }
        _init() {}
        vfunc_set_actor(actor) { this.actor = actor; }
        get_actor() { return this.actor; }
        set_n_tiles() {}
        invalidate() { this.invalidations = (this.invalidations || 0) + 1; }
    }
    class Timeline extends Actor {
        constructor(params) { super(params); timelines.push(this); }
        start() { this.playing = true; }
        stop() { this.playing = false; }
        get_progress() { return this.progress ?? 0.5; }
    }
    const manager = new Actor();
    const windowGroup = new WindowActor();
    const uiGroup = new WindowActor();
    uiGroup.add_child(windowGroup);
    let minimized = 0;
    let restored = 0;
    const originalMinimize = () => minimized++;
    const originalUnminimize = () => restored++;
    const Main = {
        uiGroup, overview: {visible: false},
        layoutManager: {monitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1080},
            {index: 1, x: 1920, y: 0, width: 1280, height: 1024},
        ]},
        wm: {_shouldAnimateActor() {}, _workspaceAnimation: {gestureActive: false},
            _shellwm: {completed_minimize: originalMinimize, completed_unminimize: originalUnminimize}},
    };
    const {default: Extension} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            globals: {global: {window_manager: manager, window_group: windowGroup,
                get_window_actors: () => [source]}},
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {default: {Timeline, DeformEffect}},
                'gi://St': {default: {Widget: WindowActor, Settings: {get: () => settings},
                    ReducedMotion: {REDUCE: 1}, Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3}}},
                'gi://GLib': {default: {PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
                    idle_add(_priority, callback) { const id = nextIdle++; idles.set(id, callback); return id; },
                    source_remove(id) { return idles.delete(id); }}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': Main,
                './settings_data.js': {SettingsData: class {constructor() { Object.assign(this, settingsData); }}},
            },
        });
    const source = new WindowActor({x: 200, y: 150, width: 800, height: 600, opacity: 230});
    source.meta_window = {get_monitor: () => 0};
    windowGroup.add_child(source);
    const extension = new Extension();
    extension.getSettings = () => ({});
    const dockIcon = {x: 2400, y: 960, width: 48, height: 48,
        monitorIndex: 1, dockPosition: 'bottom'};
    let target = dockIcon;
    extension.getIcon = () => target;
    extension.enable();

    for (const [signal, stopReason] of [['minimize', 'gesture'], ['unminimize', 'heldGesture'],
        ['minimize', 'keyboardSwitch'], ['unminimize', 'reducedMotion']]) {
        manager.emit(signal, source);
        const [effect] = extension._activeEffects;
        const snapshot = effect._animationActor;
        const timeline = timelines.at(-1);
        assert.notEqual(snapshot, source);
        assert.equal(source.opacity, 0);
        assert.equal(timeline.actor, snapshot);
        timeline.emit('new-frame', 16);
        assert.equal(effect.invalidations, 1);
        Main.wm._workspaceAnimation.gestureActive = stopReason === 'gesture';
        Main.wm._workspaceAnimation._switchData = ['heldGesture', 'keyboardSwitch'].includes(stopReason)
            ? {gestureActivated: false, inProgress: stopReason === 'keyboardSwitch'} : null;
        settings.reducedMotion = stopReason === 'reducedMotion' ? 1 : 0;
        timeline.emit('new-frame', 32);
        assert.equal(extension._activeEffects.size, 0);
        assert.equal(source.opacity, 230);
        assert.equal(snapshot.destroyed, true);
        assert.equal(source.signals.size, 0);
        assert.equal(timeline.signals.size, 0);
        assert.equal(timeline.playing, false);
        Main.wm._workspaceAnimation.gestureActive = false;
        Main.wm._workspaceAnimation._switchData = null;
        settings.reducedMotion = 0;
    }
    assert.equal(minimized, 2);
    assert.equal(restored, 2);

    // Restore must retrace the very same geometry and opacity, including a
    // fallback on the original surface rather than a detached texture actor.
    for (target of [dockIcon, null]) {
        const minimizeFrames = new Map();
        for (const signal of ['minimize', 'unminimize']) {
            manager.emit(signal, source);
            const [effect] = extension._activeEffects;
            const animation = effect._animationActor;
            const timeline = timelines.at(-1);
            assert.equal(effect.fallback, target === null);
            if (target)
                assert.equal(effect.iconPosition, 1, 'A diagonal cross-output target follows the actual rightward direction');
            assert.equal(timeline.duration, target ? 400 : 160);
            assert.equal(animation.opacity, signal === 'minimize' ? (target ? 255 : 230) : 0,
                'Restore starts at the hidden target before its first frame');
            for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
                timeline.progress = signal === 'minimize' ? tick : 1 - tick;
                timeline.emit('new-frame', 16);
                const vertices = [];
                for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
                    const vertex = {tx, ty, x: 0, y: 0};
                    effect.vfunc_deform_vertex(source.width, source.height, vertex);
                    vertices.push([vertex.x, vertex.y]);
                }
                const frame = {vertices, opacity: animation.opacity};
                if (target)
                    assert.equal(source.opacity, 0, 'The source stays hidden while only the snapshot fades');
                if (signal === 'minimize')
                    minimizeFrames.set(tick, frame);
                else
                    assert.deepEqual(frame, minimizeFrames.get(tick), `Reverse trajectory at ${tick}`);
            }
            timeline.emit('completed');
            assert.equal(source.opacity, 230, 'Completion restores the source opacity');
            assert.equal(extension._activeEffects.size, 0);
            assert.equal(source.signals.size, 0);
        }
    }
    assert.equal(minimized, 4);
    assert.equal(restored, 4);

    target = dockIcon;
    manager.emit('minimize', source);
    const [detached] = extension._activeEffects;
    const snapshot = detached._animationActor;
    snapshot.remove_effect(detached);
    assert.equal(idles.size, 1, 'Native detach defers snapshot disposal');
    assert.equal(snapshot.visible, false);
    extension.disable();
    assert.equal(idles.size, 0, 'Disable drains deferred cleanup');
    assert.equal(snapshot.destroyed, true);
    assert.equal(source.opacity, 230);
    assert.equal(minimized, 5);
    detached.destroy();
    assert.equal(minimized, 5, 'Completion runs exactly once');
    assert.equal(manager.signals.size, 0);
    assert.equal(source.signals.size, 0);
    assert.equal(uiGroup.children.length, 1, 'Only the original window group remains');
    assert.equal(Main.wm._shellwm.completed_minimize, originalMinimize);
    assert.equal(Main.wm._shellwm.completed_unminimize, originalUnminimize);
});

test('animating window in tiled layout is raised above siblings and kept on top across restack events', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const settingsData = {
        EFFECT: {get: () => 'default'},
        DURATION: {get: () => 400},
        X_TILES: {get: () => 10},
        Y_TILES: {get: () => 10},
    };
    class WindowActor extends Actor {
        get_size() { return [this.width, this.height]; }
        get_x() { return this.x; }
        get_y() { return this.y; }
        queue_redraw() {}
        paint_to_content() { return {}; }
        get_effect(name) { return this.effects?.get(name) ?? null; }
        add_effect_with_name(name, effect) {
            this.effects ??= new Map();
            this.effects.set(name, effect);
            effect.vfunc_set_actor(this);
        }
        remove_effect(effect) {
            for (const [name, current] of this.effects ?? []) {
                if (current === effect) this.effects.delete(name);
            }
            effect.vfunc_set_actor(null);
        }
    }
    class DeformEffect extends Actor {
        constructor(params) { super(); this._init(params); }
        _init() {}
        vfunc_set_actor(actor) { this.actor = actor; }
        get_actor() { return this.actor; }
        set_n_tiles() {}
        invalidate() {}
    }
    class Timeline extends Actor {
        constructor(params) { super(params); this.actor = params?.actor; }
        start() { this.playing = true; }
        stop() { this.playing = false; }
        get_progress() { return 0.5; }
    }

    const windowGroup = new Actor();
    const uiGroup = new Actor();
    uiGroup.add_child(windowGroup);
    const manager = new Actor();
    const display = new Actor();
    let minimized = 0;
    const Main = {
        overview: {visible: false},
        uiGroup,
        layoutManager: {
            monitors: [{index: 0, x: 0, y: 0, width: 1920, height: 1080}],
        },
        wm: {
            _shouldAnimateActor() {},
            _workspaceAnimation: {gestureActive: false},
            _shellwm: {
                completed_minimize: () => minimized++,
                completed_unminimize: () => {},
            },
        },
    };

    const {default: Extension} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            globals: {
                global: {
                    window_manager: manager,
                    window_group: windowGroup,
                    display,
                    get_window_actors: () => [appA, appB],
                },
            },
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {default: {Timeline, DeformEffect}},
                'gi://St': {default: {
                    Widget: WindowActor,
                    Settings: {get: () => settings},
                    ReducedMotion: {REDUCE: 1},
                    Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3},
                }},
                'gi://GLib': {default: {
                    PRIORITY_DEFAULT_IDLE: 0,
                    SOURCE_REMOVE: false,
                    idle_add: () => 0,
                    source_remove: () => {},
                }},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': Main,
                './settings_data.js': {SettingsData: class {constructor() { Object.assign(this, settingsData); }}},
            },
        });

    // App A is on the left half (0 to 960), App B is on the right half (960 to 1920)
    const appA = new WindowActor({x: 0, y: 0, width: 960, height: 1040});
    appA.meta_window = {get_monitor: () => 0};
    const appB = new WindowActor({x: 960, y: 0, width: 960, height: 1040});
    appB.meta_window = {get_monitor: () => 0};

    // In windowGroup, App B is at index 0 and App A is at index 1 (App A is above App B in stack)
    windowGroup.add_child(appB);
    windowGroup.add_child(appA);
    assert.deepEqual(windowGroup.get_children(), [appB, appA]);

    const extension = new Extension();
    extension.getSettings = () => ({});
    // App B's dock icon is located on App A's side (left half: x: 300, y: 1040)
    const dockIconForB = {x: 300, y: 1040, width: 48, height: 48, monitorIndex: 0, dockPosition: 'bottom'};
    extension.getIcon = actor => (actor === appB ? dockIconForB : null);
    extension.enable();

    // Trigger minimize on App B
    manager.emit('minimize', appB);

    // App B's snapshot is created and placed in uiGroup above windowGroup
    const [effect] = extension._activeEffects;
    const snapshot = effect._animationActor;
    assert.notEqual(snapshot, appB, 'Snapshot widget is used for animation');
    assert.equal(appB.opacity, 0, 'Original window actor is hidden during animation');
    assert.equal(uiGroup.get_children().at(-1), snapshot, 'Snapshot is rendered above the entire window_group');

    // Complete the effect
    effect.destroy();
    assert.equal(minimized, 1);
    assert.equal(appB.opacity, 255, 'Original window opacity restored on completion');
    assert.equal(snapshot.destroyed, true, 'Snapshot actor destroyed on completion');
    assert.deepEqual(uiGroup.get_children(), [windowGroup], 'Only windowGroup remains in uiGroup');
    assert.equal(extension._activeEffects.size, 0);

    extension.disable();
});
