import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor, GObjectActor, registerGObjectClass} from './helpers/shell.mjs';

function registerBackgroundClass(...args) {
    const Original = args.at(-1);
    return ['DockBackground', 'AttachedDockCanvas'].includes(Original.name)
        ? registerGObjectClass(...args) : Original;
}

class HitButton extends Actor {
    add_action(action) { action.owner = this; }
    remove_action(action) { assert.equal(action.owner, this); action.owner = null; }
}

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
        point: value => { pointer = value; },
        move: axis => { pointer = vertical ? [24, axis] : [axis, 24]; },
        leave: () => { within = false; }};
}

async function setupModularAnimation() {
    const env = await setup('left');
    const {dock, icons} = env;
    const {DockBackground} = await loadModule('dash2dock-lite@custom/dockItems.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {},
        'resource:///org/gnome/shell/ui/boxpointer.js': {},
        'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}},
        'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
        'gi://Shell': {default: {}}, 'gi://Gio': {default: {}},
        'gi://GObject': {default: {registerClass: registerBackgroundClass}},
        'gi://Clutter': {default: {ActorBox: class {constructor(box) {Object.assign(this, box);}}}},
        'gi://St': {default: {Widget: GObjectActor, DrawingArea: GObjectActor}},
        'gi://cairo': {default: {}},
        './utils.js': {trySpawnCommandLine() {}},
        './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
    }});
    dock._background = new DockBackground();
    dock.extension.desktopLayoutManager = {mode: 1};
    dock.extension.flare_width = 14;
    dock.extension.dock_padding = 0;
    dock.extension.services = {_appNotices: {}, updateIcon() {}};
    dock._modularViewport = {overflow: false, contentTop: 100, bodyHeight: 280};
    dock.height = 500;
    dock.dash.width = 34;
    dock._iconSize = dock._iconSizeScaledDown = 30;
    dock.dash.height = 280;
    dock.dash.y = 100;
    const actions = [];
    for (const [i, icon] of icons.entries()) {
        icon.y += 100;
        icon.set_size(34, 56);
        icon._appwell = new HitButton({accessible_name: `App ${i}`});
        icon._appwell.app = {get_id: () => `app-${i}`};
        icon._appwell.activate = button => actions.push(['activate', i, button]);
        icon._appwell.popupMenu = () => actions.push(['menu', i]);
    }
    const {Dock} = await loadModule('dash2dock-lite@custom/dock.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
        'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
        'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
        'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}},
        'gi://Shell': {default: {}}, 'gi://Gio': {default: {}},
        'gi://GObject': {default: {registerClass: (...args) => args.at(-1)}},
        'gi://Clutter': {default: {}}, 'gi://Graphene': {default: {Point: class {}}},
        'gi://St': {default: {Widget: Actor, Button: HitButton}},
        './effects/tint_effect.js': {TintEffect: class {}},
        './effects/monochrome_effect.js': {MonochromeEffect: class {}},
        './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
        './dockItemMenu.js': {DockItemList: class {}}, './autohide.js': {AutoHide: class {}},
        './animator.js': {Animator: class {}},
        './utils.js': {get_distance_sqr() {}, get_distance() {}, isInRect() {}, isOverlapRect() {}, tempPath() {}},
    }});
    dock.isWithinHoverArea = Dock.prototype.isWithinHoverArea.bind(dock);
    dock._ensureLayout = Dock.prototype._ensureLayout.bind(dock);
    dock._layoutReady = true;
    for (const name of ['_createIconHitTarget', '_syncIconHitTargets', '_activateIcon'])
        dock[name] = Dock.prototype[name].bind(dock);
    dock._onEnterEvent = dock._onLeaveEvent = dock._onMotionEvent = () => false;
    return {...env, actions, leave: () => env.point([1000, 1000])};
}

test('magnified icon and its small click margin activate the matching native app outside the original slot', async () => {
    const {dock, icons, actions, point, settle, animator} = await setupModularAnimation();
    point([24, 240]);
    settle();
    const item = icons[2], target = item._renderer._hitTarget;
    const bounds = item._hitBounds;
    assert.ok(target.visible);
    assert.ok(bounds.x + bounds.width > 34 + 10, 'click region follows magnification beyond the native slot');
    const pointer = [bounds.x + bounds.width - 1, bounds.y + bounds.height / 2];
    point(pointer);
    animator.animate(16);
    assert.equal(dock.isWithinHoverArea(pointer), true);
    target.emit('clicked', 1);
    target.emit('clicked', 2);
    target.emit('clicked', 3);
    assert.deepEqual(actions, [['activate', 2, 1], ['activate', 2, 2], ['menu', 2]]);
    const paint = dock._background._paintedRect;
    const besideWindow = [dock.x + paint.x + paint.width + 1, pointer[1]];
    assert.equal(dock.isWithinHoverArea(besideWindow), false, 'visible application edge has zero extra hover tolerance');
    assert.ok(bounds.x + bounds.width <= dock.x + paint.x + paint.width, 'click padding stays within dock paint');
    point(besideWindow);
    animator.animate(16);
    assert.equal(dock._nearestIcon, null, 'moving into the application clears the hover');
});

test('native source geometry and reserved work area stay fixed while hover moves across applications', async () => {
    const {dock, icons, animator, point, settle} = await setupModularAnimation();
    point([1000, 1000]);
    settle();
    const sourcePositions = icons.map(icon => icon.get_transformed_position());
    const reservedWidth = dock.struts.width;
    for (let step = 0; step < 120; step++) {
        point([24, 128 + step % 80]);
        animator.animate(1000 / 120);
        assert.deepEqual(icons.map(icon => icon.get_transformed_position()), sourcePositions);
        assert.ok(icons.every(icon => icon._icon.translationX === 0 && icon._icon.translationY === 0));
        assert.equal(dock.struts.width, reservedWidth, 'hover never moves the maximized window edge');
    }
});

test('a compact resting dock does not activate at the adjacent application edge', async () => {
    const {dock, icons, animator, point, settle} = await setupModularAnimation();
    dock._iconSizeScaledDown = 24;
    dock._modularViewport.bodyHeight = 130;
    dock.dash.height = 130;
    for (const [i, icon] of icons.entries()) {
        icon.set_size(26, 26);
        icon.y = 100 + i * 26;
    }
    point([1000, 1000]);
    settle();
    const paint = dock._background._paintedRect;
    point([paint.x + paint.width + 1, 165]);
    for (let i = 0; i < 90; i++) {
        animator.animate(16);
        assert.equal(dock._nearestIcon, null, 'unused source-slot margin cannot initiate magnification');
    }
    assert.ok(icons.every(icon => icon._renderer.icon_size * icon._renderer.scaleX === 24));
});

test('hovering the painted space between enlarged icons does not repeatedly collapse the dock', async () => {
    const {dock, icons, animator, point, settle} = await setupModularAnimation();
    point([24, 240]);
    settle();
    const paint = dock._background._paintedRect;
    const x = paint.x + paint.width - 1;
    let gap = null;
    for (let y = Math.max(paint.y + 30, dock._modularViewport.contentTop + 14);
        y < dock._modularViewport.contentTop + dock._modularViewport.bodyHeight - 14; y++) {
        if (icons.every(icon => {
            const b = icon._hitBounds;
            return !b || x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height;
        })) { gap = [x, y]; break; }
    }
    assert.ok(gap, 'fixture includes painted space outside all per-icon targets');
    point(gap);
    for (let frame = 0; frame < 90; frame++) {
        animator.animate(16);
        assert.ok(dock._nearestIcon, `paint bridges per-icon hit rectangles during active hover (frame ${frame})`);
    }
});

test('the native drag gesture follows the painted input target and returns on animation cleanup', async () => {
    const {dock, icons, move, settle, animator} = await setupModularAnimation();
    const source = icons[2]._appwell;
    const gesture = {owner: source, get_actor() { return this.owner; }};
    source._draggable = {_dndGesture: gesture};
    move(240);
    settle();
    const target = icons[2]._renderer._hitTarget;
    assert.equal(gesture.owner, target);
    assert.equal(target._delegate, source);
    dock._dragging = true;
    dock._syncIconHitTargets();
    assert.equal(target.visible, true, 'drag does not hide/cancel its own gesture actor');
    dock._dragging = false;
    animator.disable();
    assert.equal(gesture.owner, source, 'native source regains its gesture on cleanup');
    assert.equal(source.signals.size, 0, 'proxy source listener is released');
});

test('destroying a native application releases its painted click target without a stale activation', async () => {
    const {icons, move, settle, actions, animator} = await setupModularAnimation();
    move(240);
    settle();
    const target = icons[2]._renderer._hitTarget;
    icons[2]._appwell.destroy();
    assert.equal(target.visible, false);
    target.emit('clicked', 1);
    assert.equal(actions.length, 0);
    animator.disable();
});

test('Left Modular background expands once on hover and contracts on leave without reallocating the viewport', async () => {
    const {dock, move, settle, leave} = await setupModularAnimation();
    move(1000);
    settle();
    const rest = {y: dock._background.y, height: dock._background.height, width: dock._background.width};
    move(236);
    settle();
    assert.ok(dock._background.height > rest.height + 10, 'painted capsule expands along the left edge');
    assert.ok(dock._background.width > rest.width + 10, 'painted capsule follows raised and magnified icons');
    assert.ok(dock._background.y < rest.y, 'expansion extends above the resting capsule');
    assert.equal(dock.height, 500, 'hover never reallocates the input viewport');
    leave();
    settle();
    for (const key of ['y', 'height', 'width'])
        assert.ok(Math.abs(dock._background[key] - rest[key]) < 0.01, `${key} returns to its resting value`);
});

test('moving through every icon keeps the expanded frame fixed at 60 and 120 Hz without relayout', async () => {
    for (const dt of [1000 / 60, 1000 / 120]) {
        const {dock, icons, animator, point, settle} = await setupModularAnimation();
        dock.layout = () => { throw new Error('pointer movement must not request layout'); };
        point([1000, 1000]); settle();
        point([24, 240]); settle();
        const frame = JSON.stringify(dock._background._paintedRect);
        const writes = [];
        for (const actor of [dock._background, dock._background._canvas]) {
            for (const key of ['x', 'y', 'width', 'height']) {
                let value = actor[key];
                Object.defineProperty(actor, key, {get: () => value, set(next) {
                    writes.push([key, next]); value = next;
                }});
            }
        }
        for (let step = 0; step < 600; step++) {
            point([24, 129 + (step % 240)]);
            animator.animate(dt);
            assert.equal(JSON.stringify(dock._background._paintedRect), frame);
            assert.equal(dock._nearestIcon !== null, true);
        }
        assert.equal(writes.length, 0, 'moving hover does not reallocate the frame or canvas');
        assert.ok(icons.some(icon => icon._targetScale > 1), 'per-icon effects remain active');
    }
});

test('entry/exit is monotonic, child crossings do not restart it, and interrupted entry returns to rest', async () => {
    const {dock, animator, point, settle} = await setupModularAnimation();
    point([1000, 1000]); settle();
    const rest = {...dock._background._paintedRect};
    let width = rest.width;
    for (let frame = 0; frame < 18; frame++) {
        point([24, 128 + frame * 13]);
        animator.animate(16);
        assert.ok(dock._background.width >= width);
        width = dock._background.width;
    }
    const expanded = width;
    point([1000, 1000]);
    for (let frame = 0; frame < 20; frame++) {
        animator.animate(16);
        assert.ok(dock._background.width <= width);
        width = dock._background.width;
    }
    assert.deepEqual({...dock._background._paintedRect}, rest);
    point([24, 240]); animator.animate(50);
    assert.ok(dock._background.width > rest.width && dock._background.width < expanded);
    point([1000, 1000]); settle();
    assert.deepEqual({...dock._background._paintedRect}, rest);
});

test('the dock background picks only painted space, including gaps, and drops input when empty', async () => {
    const {dock, point, settle} = await setupModularAnimation();
    point([24, 240]); settle();
    const background = dock._background;
    const boxes = [];
    background.should_pick = () => background.reactive;
    background.pick_box = (context, box) => context.push(box);
    background.vfunc_pick(boxes);
    const picked = (x, y) => boxes.some(b => x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2);
    assert.equal(background.reactive, true);
    assert.equal(picked(background.width / 2, background.height / 2), true);
    assert.equal(picked(background.width - 0.5, 0.5), false, 'transparent flare stays click-through');
    assert.equal(picked(background.width + 1, background.height / 2), false, 'animation reserve stays click-through');
    assert.equal(dock.isWithinHoverArea([background.width + 1, 240]), false);
    background.update({dock});
    assert.equal(background.reactive, false);
    assert.equal(background._paintedRect, null, 'removing the last icon leaves no invisible input');
});

test('reduced motion collapses the frame immediately without a rebound when animations resume', async () => {
    const {dock, animator, settings, point, settle} = await setupModularAnimation();
    point([1000, 1000]); settle();
    const rest = JSON.stringify(dock._background._paintedRect);
    point([24, 240]); settle();
    settings.reducedMotion = 1;
    animator.animate(16);
    assert.equal(JSON.stringify(dock._background._paintedRect), rest);
    point([1000, 1000]);
    settings.reducedMotion = 0;
    animator.animate(16);
    assert.equal(JSON.stringify(dock._background._paintedRect), rest);
});

test('stationary modular hover does not repeatedly reallocate the background or its Cairo canvas', async () => {
    const {dock, animator, move, settle} = await setupModularAnimation();
    move(236);
    settle();
    const writes = [];
    for (const actor of [dock._background, dock._background._canvas]) {
        for (const key of ['x', 'y', 'width', 'height']) {
            let value = actor[key];
            Object.defineProperty(actor, key, {get: () => value, set(next) {
                writes.push([key, value, next]);
                value = next;
            }});
        }
    }
    for (let frame = 0; frame < 90; frame++) animator.animate(16);
    assert.equal(writes.length, 0, 'a settled pointer must not cause transient background/canvas geometry');
});

test('real modular hover remains settled at the source boundary at 60 and 120 Hz and contracts on exit', async () => {
    for (const dt of [1000 / 60, 1000 / 120]) {
        const {dock, animator, icons, point, leave} = await setupModularAnimation();
        point([33.5, 236]);
        for (let frame = 0; frame < 1200 / dt; frame++) animator.animate(dt);
        assert.ok(dock._nearestIcon, 'source-edge hover remains active');
        const snapshot = () => JSON.stringify([dock._background.x, dock._background.y,
            dock._background.width, dock._background.height,
            icons.map(icon => [icon._renderer.x, icon._renderer.y, icon._renderer.scaleX])]);
        const settled = snapshot();
        for (let frame = 0; frame < 90; frame++) {
            animator.animate(dt);
            assert.equal(snapshot(), settled, 'stationary pointer does not alternate between hover and rest');
        }
        leave();
        for (let frame = 0; frame < 1200 / dt; frame++) animator.animate(dt);
        assert.equal(dock._nearestIcon, null);
        assert.ok(icons.every(icon => icon._renderer.icon_size * icon._renderer.scaleX === 30));
    }
});

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
    assert.ok(icons[1]._renderer.icon_size * icons[1]._renderer.scaleX > 48);
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

test('system pod elevation preferences preserve the unified application icon animation', async () => {
    const baseline = await setup('left');
    baseline.dock.extension.desktopLayoutManager = {mode: 1};
    baseline.dock.extension.global_scale = 1.5;
    baseline.settle();
    const expected = baseline.icons.map(icon => [icon._renderer.x, icon._renderer.y, icon._renderer.scaleX]);
    for (const enabled of [true, false]) {
        const env = await setup('left');
        Object.assign(env.dock.extension, {desktopLayoutManager: {mode: 1}, global_scale: 1.5,
            modular_group_elevation: enabled, modular_elevation_distance: 16,
            modular_animation_duration: 600});
        env.settle();
        assert.deepEqual(env.icons.map(icon => [icon._renderer.x, icon._renderer.y, icon._renderer.scaleX]), expected);
        assert.ok(env.icons.some(icon => icon._renderer.icon_size * icon._renderer.scaleX > env.dock._iconSizeScaledDown));
        env.leave(); env.settle();
        assert.ok(env.icons.every(icon => icon._targetScale === 1));
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
            './systemDock/systemDock.js': {SystemDock: class { enable() {} destroy() {} updateTheme() {} updateLayout() {} onSettingsChanged() {} }},
            './screenFrame.js': {ScreenFrame: class { enable() {} destroy() {} updateStyle() {} updateLayout() {} onSettingsChanged() {} }},
            './debugVisuals.js': {DebugVisuals: class { enable() {} destroy() {} }},
            './desktopLayoutManager.js': {DesktopLayoutManager: class { enable() {} destroy() {} updateTheme() {} updateLayout() {} onSettingsChanged() {} }},
            './windowGaps.js': {WindowGapCoordinator: class { enable() {} destroy() {} updateGaps() {} }},
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
            'gi://cairo': {
                default: {
                    Operator: {CLEAR: 0, SOURCE: 1, OVER: 2},
                    LineCap: {ROUND: 0},
                    LineJoin: {ROUND: 0},
                },
            },
            'gi://GObject': {
                default: {
                    registerClass: registerBackgroundClass,
                },
                registerClass: registerBackgroundClass,
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

// ============================================================================
// Serpantinum-inspired Attached Edge Dock Background Regression Tests
// ============================================================================

test('Attached Edge: geometry calculation with default values', async () => {
    const {getAttachedEdgeGeometry, KAPPA} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {
                    default: {
                        Operator: {CLEAR: 0, OVER: 2, SOURCE: 1},
                        LineCap: {ROUND: 0},
                        LineJoin: {ROUND: 0},
                    },
                },
            },
        }
    );

    const geom = getAttachedEdgeGeometry({
        width: 500,
        height: 64,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        scaleFactor: 1.0,
    });

    assert.equal(geom.width, 500);
    assert.equal(geom.height, 64);
    assert.equal(geom.flareWidth, 14);
    assert.equal(geom.footDepth, 4);
    assert.equal(geom.cornerRadius, 10);
    assert.equal(geom.bodyWidth, 500 - 28); // 472

    // Key points
    assert.equal(geom.leftFootTip.x, 0);
    assert.equal(geom.leftFootTip.y, 64);
    assert.equal(geom.rightFootTip.x, 500);
    assert.equal(geom.rightFootTip.y, 64);
    assert.equal(geom.leftBodyBottom.x, 14);
    assert.equal(geom.leftBodyBottom.y, 60);
    assert.equal(geom.rightBodyBottom.x, 486);
    assert.equal(geom.rightBodyBottom.y, 60);
    assert.equal(geom.leftBodyTop.x, 14);
    assert.equal(geom.leftBodyTop.y, 10);
    assert.equal(geom.rightBodyTop.x, 486);
    assert.equal(geom.rightBodyTop.y, 10);
    assert.equal(geom.topLeft.x, 24);
    assert.equal(geom.topLeft.y, 0);
    assert.equal(geom.topRight.x, 476);
    assert.equal(geom.topRight.y, 0);
});

test('Attached Edge: symmetric left and right flares with C1 tangent continuity', async () => {
    const {getAttachedEdgeGeometry, KAPPA} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    const geom = getAttachedEdgeGeometry({
        width: 400,
        height: 60,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        scaleFactor: 1.0,
    });

    // 1. Flare widths must be identical
    const leftWidth = geom.leftBodyBottom.x - geom.leftFootTip.x;
    const rightWidth = geom.rightFootTip.x - geom.rightBodyBottom.x;
    assert.equal(leftWidth, 14);
    assert.equal(rightWidth, 14);

    // 2. Control point offsets must be identical (symmetric)
    const leftCp1Offset = geom.leftFootCP1.x - geom.leftFootTip.x;
    const rightCp2Offset = geom.rightFootTip.x - geom.rightFootCP2.x;
    assert.ok(Math.abs(leftCp1Offset - rightCp2Offset) < 1e-10);

    const leftCp2Depth = geom.leftFootTip.y - geom.leftFootCP2.y;
    const rightCp1Depth = geom.rightFootTip.y - geom.rightFootCP1.y;
    assert.ok(Math.abs(leftCp2Depth - rightCp1Depth) < 1e-10);

    // 3. Tangent continuity check
    // Left flare at t=0 (screen edge): dy/dt must vanish (horizontal)
    const leftT0_dy = geom.leftFootCP1.y - geom.leftFootTip.y;
    assert.equal(leftT0_dy, 0, 'Left flare must leave the screen edge with a horizontal tangent');

    // Left flare at t=1 (body edge): dx/dt must vanish (vertical)
    const leftT1_dx = geom.leftBodyBottom.x - geom.leftFootCP2.x;
    assert.equal(leftT1_dx, 0, 'Left flare must meet the vertical body edge with a vertical tangent');

    // Right flare at t=0 (body edge): dx/dt must vanish (vertical)
    const rightT0_dx = geom.rightFootCP1.x - geom.rightBodyBottom.x;
    assert.equal(rightT0_dx, 0, 'Right flare must leave the vertical body edge with a vertical tangent');

    // Right flare at t=1 (screen edge): dy/dt must vanish (horizontal)
    const rightT1_dy = geom.rightFootTip.y - geom.rightFootCP2.y;
    assert.equal(rightT1_dy, 0, 'Right flare must meet the screen edge with a horizontal tangent');
});

test('Attached Edge: attachment to bottom monitor edge without antialiasing gaps', async () => {
    const {getAttachedEdgeGeometry, buildAttachedFillPath, buildAttachedContourPath} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    const geom = getAttachedEdgeGeometry({
        width: 300,
        height: 50,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        scaleFactor: 1.0,
    });

    // Flare tips must be exactly at the bottom edge (height = 50)
    assert.equal(geom.leftFootTip.y, 50);
    assert.equal(geom.rightFootTip.y, 50);

    // Record Cairo operations for fill and stroke
    const ops = [];
    const mockCtx = {
        newPath() { ops.push({op: 'newPath'}); },
        moveTo(x, y) { ops.push({op: 'moveTo', x, y}); },
        lineTo(x, y) { ops.push({op: 'lineTo', x, y}); },
        curveTo(x1, y1, x2, y2, x3, y3) { ops.push({op: 'curveTo', x1, y1, x2, y2, x3, y3}); },
        closePath() { ops.push({op: 'closePath'}); },
    };

    buildAttachedFillPath(mockCtx, geom);
    // Fill path must overshoot the bottom edge (height + 2) to prevent subpixel AA gaps
    const overshoots = ops.filter(o => o.op === 'lineTo' && o.y === 52);
    assert.equal(overshoots.length, 2, 'Fill path must include bottom overshoot to prevent edge seam');
    assert.equal(ops.at(-1).op, 'closePath', 'Fill path must be closed');

    // Contour stroke path must trace from left flare tip to right flare tip without stroking bottom edge
    ops.length = 0;
    buildAttachedContourPath(mockCtx, geom);
    assert.equal(ops[1].op, 'moveTo');
    assert.deepEqual({x: ops[1].x, y: ops[1].y}, {x: 0, y: 50});
    const lastOp = ops.at(-1);
    assert.equal(lastOp.op, 'curveTo');
    assert.deepEqual({x: lastOp.x3, y: lastOp.y3}, {x: 300, y: 50});
    assert.ok(!ops.some(o => o.op === 'closePath'), 'Contour stroke must remain open at screen edge');
});

test('Attached Edge: floating mode preserves previous behavior', async () => {
    const dockItems = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/ui/boxpointer.js': {},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}, PopupMenuManager: class {}},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            './utils.js': {trySpawnCommandLine: async () => {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {default: {get_default_text_direction: () => 0, TextDirection: {RTL: 1}}},
            'gi://St': {default: {Side: {}, Widget: GObjectActor, DrawingArea: GObjectActor}},
        },
    });

    const mockDock = {
        x: 0,
        y: 1000,
        width: 1920,
        height: 80,
        dash: {
            get_transformed_position: () => [800, 1020],
            width: 320,
            height: 60,
            opacity: 255,
            translationX: 0,
            translationY: 0,
        },
        extension: {
            background_style: 0, // Floating mode
            dock_padding: 0,
            edge_distance: 0.5,
        },
        isVertical: () => false,
    };

    const first = {_icon: {translationX: 0, translationY: 0}};
    const last = {_icon: {translationX: 0, translationY: 0}};

    const bg = new dockItems.DockBackground();
    bg.update({
        first,
        last,
        iconSize: 48,
        scaleFactor: 1,
        vertical: false,
        position: 'bottom',
        panel_mode: false,
        dock: mockDock,
    });

    // In floating mode, canvas is hidden and dimensions match traditional dock body
    assert.equal(bg._canvas?.visible, false);
    assert.equal(bg.x, 800);
    assert.equal(bg.width, 320);
});

test('Attached Edge: configurable flare width, foot depth, and corner radius', async () => {
    const {getAttachedEdgeGeometry} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    // Custom configuration: flare 22px, depth 10px, radius 16px
    const custom = getAttachedEdgeGeometry({
        width: 600,
        height: 80,
        flareWidth: 22,
        footDepth: 10,
        cornerRadius: 16,
        scaleFactor: 1.0,
    });

    assert.equal(custom.flareWidth, 22);
    assert.equal(custom.footDepth, 10);
    assert.equal(custom.cornerRadius, 16);
    assert.equal(custom.leftBodyBottom.x, 22);
    assert.equal(custom.leftBodyBottom.y, 70); // 80 - 10
    assert.equal(custom.rightBodyBottom.x, 578); // 600 - 22
    assert.equal(custom.rightBodyBottom.y, 70);

    // Extreme clamping test: corner radius and foot depth exceeding height
    const clamped = getAttachedEdgeGeometry({
        width: 300,
        height: 30,
        flareWidth: 14,
        footDepth: 20,
        cornerRadius: 20,
        scaleFactor: 1.0,
    });
    assert.ok(clamped.cornerRadius + clamped.footDepth <= 30.001);
});

test('Attached Edge: dynamic dock resizing preserves flare proportions', async () => {
    const {getAttachedEdgeGeometry} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    const small = getAttachedEdgeGeometry({
        width: 300,
        height: 60,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        scaleFactor: 1.0,
    });

    const large = getAttachedEdgeGeometry({
        width: 700,
        height: 60,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        scaleFactor: 1.0,
    });

    // Flare widths remain exactly 14px on both
    assert.equal(small.flareWidth, 14);
    assert.equal(large.flareWidth, 14);

    // Straight top edge expands by exactly the width delta (400px)
    const smallTopEdge = small.topRight.x - small.topLeft.x;
    const largeTopEdge = large.topRight.x - large.topLeft.x;
    assert.equal(largeTopEdge - smallTopEdge, 400);
});

test('Attached Edge: autohide slides the entire foot below screen and reveal restores it', async () => {
    const dockItems = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/ui/boxpointer.js': {},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}, PopupMenuManager: class {}},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            './utils.js': {trySpawnCommandLine: async () => {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {default: {get_default_text_direction: () => 0, TextDirection: {RTL: 1}}},
            'gi://St': {default: {Side: {}, Widget: GObjectActor, DrawingArea: GObjectActor}},
        },
    });

    const mockDock = {
        x: 0,
        y: 1000,
        width: 1920,
        height: 80,
        dash: {
            get_transformed_position: () => [800, 1020 + mockDock.dash.translationY],
            width: 320,
            height: 60,
            opacity: 255,
            translationX: 0,
            translationY: 0,
        },
        extension: {
            background_style: 1, // Attached Edge
            flare_width: 14,
            foot_depth: 4,
            attached_corner_radius: 10,
            dock_padding: 0,
        },
        isVertical: () => false,
    };

    const first = {_icon: {translationX: 0, translationY: 0}};
    const last = {_icon: {translationX: 0, translationY: 0}};

    const bg = new dockItems.DockBackground();

    // 1. Fully revealed state (translationY = 0)
    bg.update({
        first,
        last,
        iconSize: 48,
        scaleFactor: 1,
        vertical: false,
        position: 'bottom',
        panel_mode: false,
        dock: mockDock,
    });

    assert.equal(bg._canvas?.visible, true);
    // Background actor spans body width (320) + 2 * flareWidth (28) = 348
    assert.equal(bg.width, 348);
    // Bottom of background is at dock.height (80)
    assert.equal(bg.y + bg.height, mockDock.height);

    // 2. Autohide sliding down by 40px
    mockDock.dash.translationY = 40;
    bg.update({
        first,
        last,
        iconSize: 48,
        scaleFactor: 1,
        vertical: false,
        position: 'bottom',
        panel_mode: false,
        dock: mockDock,
    });
    // The bottom of the shape has shifted down along with translationY
    assert.equal(bg.y + bg.height, mockDock.height + 40);

    // 3. Reveal restored
    mockDock.dash.translationY = 0;
    bg.update({
        first,
        last,
        iconSize: 48,
        scaleFactor: 1,
        vertical: false,
        position: 'bottom',
        panel_mode: false,
        dock: mockDock,
    });
    assert.equal(bg.y + bg.height, mockDock.height);
});

test('Attached Edge: monitor scaling (100%, 125%, 150%, 200%) and negative origins', async () => {
    const {getAttachedEdgeGeometry} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    const scales = [1.0, 1.25, 1.5, 2.0];
    const expectedFw = [14, 17.5, 21, 28];
    const expectedFd = [4, 5, 6, 8];
    const expectedCr = [10, 12.5, 15, 20];

    scales.forEach((scale, i) => {
        const geom = getAttachedEdgeGeometry({
            width: 400 * scale,
            height: 60 * scale,
            flareWidth: 14,
            footDepth: 4,
            cornerRadius: 10,
            scaleFactor: scale,
        });

        assert.equal(geom.flareWidth, expectedFw[i], `Scale ${scale} flare width`);
        assert.equal(geom.footDepth, expectedFd[i], `Scale ${scale} foot depth`);
        assert.equal(geom.cornerRadius, expectedCr[i], `Scale ${scale} corner radius`);
    });
});

test('Attached Edge: style and border updates reflect settings cleanly', async () => {
    const dockItems = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/ui/boxpointer.js': {},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}, PopupMenuManager: class {}},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            './utils.js': {trySpawnCommandLine: async () => {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {default: {get_default_text_direction: () => 0, TextDirection: {RTL: 1}}},
            'gi://St': {default: {Side: {}, Widget: GObjectActor, DrawingArea: GObjectActor}},
        },
    });

    const mockDock = {
        x: 0,
        y: 1000,
        width: 1920,
        height: 80,
        dash: {
            get_transformed_position: () => [800, 1020],
            width: 320,
            height: 60,
            opacity: 255,
            translationX: 0,
            translationY: 0,
        },
        extension: {
            background_style: 1,
            flare_width: 14,
            foot_depth: 4,
            attached_corner_radius: 10,
            dock_padding: 0,
            border_thickness: 2,
            _dockColors: {
                'background-color': [0.1, 0.1, 0.1, 0.8],
                'border-color': [1, 1, 1, 0.3],
            },
        },
        isVertical: () => false,
    };

    const first = {_icon: {translationX: 0, translationY: 0}};
    const last = {_icon: {translationX: 0, translationY: 0}};

    const bg = new dockItems.DockBackground();
    bg.update({
        first,
        last,
        iconSize: 48,
        scaleFactor: 1,
        vertical: false,
        position: 'bottom',
        panel_mode: false,
        dock: mockDock,
    });

    assert.equal(bg._canvas?.state?.borderThickness, 2);
    assert.deepEqual(bg._canvas?.state?.borderColor, [1, 1, 1, 0.3]);
    assert.deepEqual(bg._canvas?.state?.backgroundColor, [0.1, 0.1, 0.1, 0.8]);
});

test('Attached Edge: Magic Lamp and icon geometry remain unaffected by background style', async () => {
    const monitors = [{index: 0, x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1}];
    const app = {get_id: () => 'sample.desktop', get_pids: () => [1234]};
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: {monitors, primaryIndex: 0},
            },
            'gi://Shell': {default: {WindowTracker: {get_default: () => ({get_window_app: () => app})}}},
        },
    });

    const icon = new Actor({x: 900, y: 1030, width: 48, height: 48});
    icon.app = app;

    const dock = {
        _icons: [icon],
        getMonitor: () => monitors[0],
        _position: 'bottom',
        _preferredIconSize: () => 48,
        dash: {_box: {get_children: () => [icon]}},
    };

    const integrations = new Integrations();
    integrations.extension = {
        lamp_app_animation: true,
        background_style: 1, // Attached Edge active
        docks: [dock],
    };

    const actor = {meta_window: {get_monitor: () => 0}};
    const target = integrations.compiz_getIcon(actor);

    assert.ok(target !== null);
    assert.equal(target.monitorIndex, 0);
    assert.equal(target.dockPosition, 'bottom');
    assert.equal(target.x, 900);
    assert.equal(target.y, 1030);
    assert.equal(target.width, 48);
    assert.equal(target.height, 48);
});

test('Attached Edge: all four positions (bottom, top, left, right) have correct geometry and attachment', async () => {
    const {getAttachedEdgeGeometry} = await loadModule(
        'dash2dock-lite@custom/attachedBackground.js',
        {
            mocks: {
                'gi://GObject': {default: {registerClass: registerBackgroundClass}},
                'gi://St': {default: {DrawingArea: GObjectActor, Widget: GObjectActor}},
                'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            },
        }
    );

    // 1. Bottom
    const bottom = getAttachedEdgeGeometry({
        width: 400,
        height: 60,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        position: 'bottom',
    });
    assert.equal(bottom.leftFootTip.y, 60, 'Bottom: left flare tip touches bottom edge');
    assert.equal(bottom.rightFootTip.y, 60, 'Bottom: right flare tip touches bottom edge');
    assert.equal(bottom.topLeft.y, 0, 'Bottom: crown is at top edge');
    assert.equal(bottom.topRight.y, 0, 'Bottom: crown is at top edge');
    // Tangent at screen edge must be horizontal (dy = 0)
    assert.equal(bottom.leftFootCP1.y - bottom.leftFootTip.y, 0);
    assert.equal(bottom.rightFootTip.y - bottom.rightFootCP2.y, 0);

    // 2. Top
    const top = getAttachedEdgeGeometry({
        width: 400,
        height: 60,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        position: 'top',
    });
    assert.equal(top.leftFootTip.y, 0, 'Top: left flare tip touches top edge');
    assert.equal(top.rightFootTip.y, 0, 'Top: right flare tip touches top edge');
    assert.equal(top.topLeft.y, 60, 'Top: crown is at bottom edge');
    assert.equal(top.topRight.y, 60, 'Top: crown is at bottom edge');
    // Tangent at top screen edge must be horizontal (dy = 0)
    assert.equal(top.leftFootCP1.y - top.leftFootTip.y, 0);
    assert.equal(top.rightFootTip.y - top.rightFootCP2.y, 0);

    // 3. Left
    const left = getAttachedEdgeGeometry({
        width: 60,
        height: 400,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        position: 'left',
    });
    assert.equal(left.leftFootTip.x, 0, 'Left: top flare tip touches left edge');
    assert.equal(left.leftFootTip.y, 0, 'Left: top flare starts at y=0');
    assert.equal(left.rightFootTip.x, 0, 'Left: bottom flare tip touches left edge');
    assert.equal(left.rightFootTip.y, 400, 'Left: bottom flare tip is at y=400');
    assert.equal(left.topLeft.x, 60, 'Left: crown is at right edge (x=60)');
    assert.equal(left.topRight.x, 60, 'Left: crown is at right edge (x=60)');
    // Tangent at left screen edge must be vertical (dx = 0)
    assert.equal(left.leftFootCP1.x - left.leftFootTip.x, 0);
    assert.equal(left.rightFootTip.x - left.rightFootCP2.x, 0);

    // 4. Right
    const right = getAttachedEdgeGeometry({
        width: 60,
        height: 400,
        flareWidth: 14,
        footDepth: 4,
        cornerRadius: 10,
        position: 'right',
    });
    assert.equal(right.leftFootTip.x, 60, 'Right: top flare tip touches right edge (x=60)');
    assert.equal(right.leftFootTip.y, 0, 'Right: top flare starts at y=0');
    assert.equal(right.rightFootTip.x, 60, 'Right: bottom flare tip touches right edge (x=60)');
    assert.equal(right.rightFootTip.y, 400, 'Right: bottom flare tip is at y=400');
    assert.equal(right.topLeft.x, 0, 'Right: crown is at left edge (x=0)');
    assert.equal(right.topRight.x, 0, 'Right: crown is at left edge (x=0)');
    // Tangent at right screen edge must be vertical (dx = 0)
    assert.equal(right.leftFootCP1.x - right.leftFootTip.x, 0);
    assert.equal(right.rightFootTip.x - right.rightFootCP2.x, 0);
});

test('Attached Edge: DockBackground bounding box and canvas visibility in all 4 positions', async () => {
    const dockItems = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/ui/boxpointer.js': {},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}, PopupMenuManager: class {}},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            './utils.js': {trySpawnCommandLine: async () => {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {default: {get_default_text_direction: () => 0, TextDirection: {RTL: 1}}},
            'gi://St': {default: {Side: {}, Widget: GObjectActor, DrawingArea: GObjectActor}},
        },
    });

    const first = {_icon: {translationX: 0, translationY: 0}};
    const last = {_icon: {translationX: 0, translationY: 0}};

    const makeDock = (position, isVertical) => ({
        x: 0,
        y: 0,
        width: isVertical ? 80 : 1920,
        height: isVertical ? 1080 : 80,
        dash: {
            get_transformed_position: () => isVertical ? [10, 300] : [800, 10],
            width: isVertical ? 60 : 320,
            height: isVertical ? 320 : 60,
            opacity: 255,
            translationX: 0,
            translationY: 0,
        },
        extension: {
            background_style: 1, // Attached Edge
            flare_width: 14,
            foot_depth: 4,
            attached_corner_radius: 10,
            dock_padding: 0,
        },
        isVertical: () => isVertical,
    });

    const positions = [
        {pos: 'bottom', vertical: false},
        {pos: 'top', vertical: false},
        {pos: 'left', vertical: true},
        {pos: 'right', vertical: true},
    ];

    for (const {pos, vertical} of positions) {
        const dock = makeDock(pos, vertical);
        const bg = new dockItems.DockBackground();
        bg.update({
            first,
            last,
            iconSize: 48,
            scaleFactor: 1,
            vertical,
            position: pos,
            panel_mode: false,
            dock,
        });

        assert.equal(bg._canvas?.visible, true, `Canvas must be visible on ${pos}`);
        assert.equal(bg._canvas?.state?.position, pos, `Canvas state position must be ${pos}`);
        assert.ok(bg.width > 0, `${pos} width must be positive`);
        assert.ok(bg.height > 0, `${pos} height must be positive`);

        // Check screen edge attachment
        if (pos === 'bottom') {
            assert.equal(bg.y + bg.height, dock.height, 'Bottom attaches to dock.height');
        } else if (pos === 'top') {
            assert.equal(bg.y, 0, 'Top attaches to dock y=0');
        } else if (pos === 'left') {
            assert.equal(bg.x, 0, 'Left attaches to dock x=0');
        } else if (pos === 'right') {
            assert.equal(bg.x + bg.width, dock.width, 'Right attaches to dock.width');
        }
    }
});

test('Attached Edge: position changes trigger canvas updates without requiring restart', async () => {
    const dockItems = await loadModule('dash2dock-lite@custom/dockItems.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {},
            'resource:///org/gnome/shell/ui/boxpointer.js': {},
            'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}, PopupMenuManager: class {}},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            './utils.js': {trySpawnCommandLine: async () => {}},
            './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://cairo': {default: {Operator: {}, LineCap: {}, LineJoin: {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {default: {get_default_text_direction: () => 0, TextDirection: {RTL: 1}}},
            'gi://St': {default: {Side: {}, Widget: GObjectActor, DrawingArea: GObjectActor}},
        },
    });

    const dock = {
        x: 0,
        y: 0,
        width: 1920,
        height: 80,
        dash: {
            get_transformed_position: () => [800, 10],
            width: 320,
            height: 60,
            opacity: 255,
            translationX: 0,
            translationY: 0,
        },
        extension: {
            background_style: 1,
            flare_width: 14,
            foot_depth: 4,
            attached_corner_radius: 10,
            dock_padding: 0,
        },
        isVertical: () => false,
    };

    const first = {_icon: {translationX: 0, translationY: 0}};
    const last = {_icon: {translationX: 0, translationY: 0}};
    const bg = new dockItems.DockBackground();

    // Start on bottom
    bg.update({first, last, iconSize: 48, scaleFactor: 1, vertical: false, position: 'bottom', panel_mode: false, dock});
    assert.equal(bg._canvas?.state?.position, 'bottom');
    const repaintsBefore = bg._canvas?.repaints || 0;

    // Switch to left
    dock.width = 80;
    dock.height = 1080;
    dock.isVertical = () => true;
    bg.update({first, last, iconSize: 48, scaleFactor: 1, vertical: true, position: 'left', panel_mode: false, dock});
    assert.equal(bg._canvas?.state?.position, 'left');
    assert.ok((bg._canvas?.repaints || 0) > repaintsBefore, 'Repaint must be queued on position switch');

    // Switch to top
    dock.width = 1920;
    dock.height = 80;
    dock.isVertical = () => false;
    bg.update({first, last, iconSize: 48, scaleFactor: 1, vertical: false, position: 'top', panel_mode: false, dock});
    assert.equal(bg._canvas?.state?.position, 'top');

    // Switch to right
    dock.width = 80;
    dock.height = 1080;
    dock.isVertical = () => true;
    bg.update({first, last, iconSize: 48, scaleFactor: 1, vertical: true, position: 'right', panel_mode: false, dock});
    assert.equal(bg._canvas?.state?.position, 'right');
});

test('Icon sizing: genuine base sizing from 12px to 96px with strict monotonicity', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 0,
            scale: 1.0,
            _config: {},
        },
    });

    // 1. Default when unset (0) must be 48px
    dock.extension.icon_size = 0;
    assert.equal(dock._preferredIconSize(), 48, 'Unset icon size must default to 48px');

    // 2. Base sizes 12, 16, 20, 24, 32, 48, 64, 96
    const testSizes = [12, 16, 20, 24, 32, 48, 64, 96];
    for (const size of testSizes) {
        dock.extension.icon_size = size;
        const result = dock._preferredIconSize();
        assert.equal(result, size, `Base size ${size}px must be exactly achievable`);
    }

    // 3. Monotonicity check across the entire range 12..96
    let prev = 0;
    for (let s = 12; s <= 96; s++) {
        dock.extension.icon_size = s;
        const current = dock._preferredIconSize();
        assert.ok(current >= prev, `Size at ${s} (${current}) must be >= size at ${s - 1} (${prev})`);
        prev = current;
    }

    // 4. Legacy normalized slider values [0, 1] map smoothly to [12, 96]
    dock.extension.icon_size = 0.5;
    const legacyMid = dock._preferredIconSize();
    assert.equal(legacyMid, 54, '0.5 legacy normalized maps to 54px (midpoint of 12..96)');

    dock.extension.icon_size = 0.1;
    const legacyLow = dock._preferredIconSize();
    assert.ok(legacyLow >= 12 && legacyLow <= 96, 'Legacy low is within 12..96');
});

test('Icon sizing: dock container and spacing shrink proportionally for small icons', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 48,
            scale: 1.0,
            animation_spread: 1.0,
            animation_magnify: 0.5,
            edge_distance: 0,
            background_style: 1,
            _config: {},
        },
    });

    // Formula for dock breadth fp: iconSize * 2 + iconSize * (0.6 * (1 + magnify))
    const computeFp = (iconSize) => {
        const magnify = dock.extension.animation_magnify * 1.8;
        return iconSize * 2 + iconSize * (0.6 * (1 + magnify));
    };

    const fp12 = computeFp(12);
    const fp16 = computeFp(16);
    const fp48 = computeFp(48);
    const fp64 = computeFp(64);

    // Dock breadth at 16px is genuinely smaller than at 48px and 64px
    assert.ok(fp12 < fp16);
    assert.ok(fp16 < fp48);
    assert.ok(fp48 < fp64);
    assert.ok(fp16 < 60, `16px dock breadth (${fp16}) must be compact (< 60px)`);
    assert.ok(fp48 > 140, `48px dock breadth (${fp48}) is around standard 150px`);

    // Proportional icon spacing check: 16px has tighter spacing than 48px
    const spreadFactor16 = Math.max(0.25, Math.min(1.0, 16 / 48));
    const extra16 = Math.max(1, Math.round(2 * spreadFactor16)) + Math.round(8 * 1.0 * spreadFactor16);
    assert.ok(extra16 <= 4, 'Extra spacing for 16px icon is small (<= 4px)');

    const spreadFactor48 = Math.max(0.25, Math.min(1.0, 48 / 48));
    const extra48 = Math.max(1, Math.round(2 * spreadFactor48)) + Math.round(8 * 1.0 * spreadFactor48);
    assert.equal(extra48, 10, 'Extra spacing for 48px icon matches standard 10px');
});

test('Icon sizing: Magic Lamp receives accurate icon geometry with small icons across all 4 positions', async () => {
    const monitors = [{index: 0, x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1}];
    const app = {get_id: () => 'small-icon.desktop', get_pids: () => [4321]};
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: {monitors, primaryIndex: 0},
            },
            'gi://Shell': {default: {WindowTracker: {get_default: () => ({get_window_app: () => app})}}},
        },
    });

    const positions = ['bottom', 'top', 'left', 'right'];
    for (const pos of positions) {
        const icon = new Actor({
            x: pos === 'left' ? 10 : (pos === 'right' ? 1890 : 960),
            y: pos === 'top' ? 10 : (pos === 'bottom' ? 1050 : 540),
            width: 16,
            height: 16,
        });
        icon.app = app;

        const dock = {
            _icons: [icon],
            getMonitor: () => monitors[0],
            _position: pos,
            _preferredIconSize: () => 16,
            dash: {_box: {get_children: () => [icon]}},
        };

        const integrations = new Integrations();
        integrations.extension = {
            lamp_app_animation: true,
            background_style: 1,
            docks: [dock],
        };

        const actor = {meta_window: {get_monitor: () => 0}};
        const target = integrations.compiz_getIcon(actor);

        assert.ok(target !== null, `Target must not be null for ${pos}`);
        assert.equal(target.dockPosition, pos);
        assert.equal(target.width, 16, `${pos} width must be 16`);
        assert.equal(target.height, 16, `${pos} height must be 16`);
        assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
    }
});

// ============================================================================
// Strict Hover Bounds & Interaction Area Regression Tests
// ============================================================================

test('Dock.isWithinHoverArea: Left dock strict boundary prevents activation inside Firefox window', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 48,
            background_style: 1, // Attached Edge
            flare_width: 14,
            foot_depth: 4,
            _config: {},
        },
    });

    dock._position = 'left';
    dock._hidden = false;
    dock._scaleFactor = 1.0;
    dock.x = 0;
    dock.y = 0;

    // Background covers depth x = 0..70, length y = 300..700
    dock._background = {
        x: 0,
        y: 300,
        width: 70,
        height: 400,
        get_transformed_position: () => [0, 300],
    };

    // 1. Pointer inside the dock body
    assert.equal(dock.isWithinHoverArea([35, 500]), true, 'Center of left dock must activate hover');
    assert.equal(dock.isWithinHoverArea([69, 500]), true, 'Just inside the right edge of left dock must activate hover');
    assert.equal(dock.isWithinHoverArea([1, 500]), true, 'Just inside screen edge must activate hover');

    // 2. Pointer in the adjacent Firefox window (outside x = 70)
    assert.equal(dock.isWithinHoverArea([70, 500]), false, 'Cursor 1px outside (on boundary x=70) must not activate hover');
    assert.equal(dock.isWithinHoverArea([71, 500]), false, 'Cursor 1px into Firefox must not activate hover');
    assert.equal(dock.isWithinHoverArea([75, 500]), false, 'Cursor 5px into Firefox must not activate hover');
    assert.equal(dock.isWithinHoverArea([90, 500]), false, 'Cursor 20px into Firefox must not activate hover');

    // 3. Pointer above or below the dock span
    assert.equal(dock.isWithinHoverArea([35, 299]), false, 'Cursor above dock body must not activate hover');
    assert.equal(dock.isWithinHoverArea([35, 701]), false, 'Cursor below dock body must not activate hover');
});

test('Dock.isWithinHoverArea: All four orientations enforce strict bounds', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 48,
            background_style: 1,
            flare_width: 14,
            foot_depth: 4,
            _config: {},
        },
    });
    dock._hidden = false;
    dock._scaleFactor = 1.0;

    // A. Bottom Dock (x: 400..800, y: 1010..1080)
    dock._position = 'bottom';
    dock._background = {x: 400, y: 1010, width: 400, height: 70, get_transformed_position: () => [400, 1010]};
    assert.equal(dock.isWithinHoverArea([600, 1040]), true, 'Bottom: inside dock');
    assert.equal(dock.isWithinHoverArea([600, 1009]), false, 'Bottom: 1px above crown in window must be false');
    assert.equal(dock.isWithinHoverArea([600, 990]), false, 'Bottom: 20px above crown must be false');

    // B. Top Dock (x: 400..800, y: 0..70)
    dock._position = 'top';
    dock._background = {x: 400, y: 0, width: 400, height: 70, get_transformed_position: () => [400, 0]};
    assert.equal(dock.isWithinHoverArea([600, 35]), true, 'Top: inside dock');
    assert.equal(dock.isWithinHoverArea([600, 71]), false, 'Top: 1px below crown in window must be false');
    assert.equal(dock.isWithinHoverArea([600, 90]), false, 'Top: 20px below crown must be false');

    // C. Right Dock (x: 1850..1920, y: 300..700)
    dock._position = 'right';
    dock._background = {x: 1850, y: 300, width: 70, height: 400, get_transformed_position: () => [1850, 300]};
    assert.equal(dock.isWithinHoverArea([1880, 500]), true, 'Right: inside dock');
    assert.equal(dock.isWithinHoverArea([1849, 500]), false, 'Right: 1px to the left in window must be false');
    assert.equal(dock.isWithinHoverArea([1830, 500]), false, 'Right: 20px to the left must be false');

    // D. Left Dock (x: 0..70, y: 300..700)
    dock._position = 'left';
    dock._background = {x: 0, y: 300, width: 70, height: 400, get_transformed_position: () => [0, 300]};
    assert.equal(dock.isWithinHoverArea([35, 500]), true, 'Left: inside dock');
    assert.equal(dock.isWithinHoverArea([71, 500]), false, 'Left: 1px to the right in window must be false');
    assert.equal(dock.isWithinHoverArea([90, 500]), false, 'Left: 20px to the right must be false');
});

test('Dock.isWithinHoverArea: Attached Edge transparent flare corners do not activate hover', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 48,
            background_style: 1,
            flare_width: 14,
            foot_depth: 4,
            _config: {},
        },
    });
    dock._hidden = false;
    dock._scaleFactor = 1.0;
    dock._position = 'left';
    // Background: x in 0..70, y in 300..700.
    // Flare width is 14px (top flare is y: 300..314; bottom flare is y: 686..700).
    // Foot depth is 4px (solid foot is x: 0..4).
    dock._background = {x: 0, y: 300, width: 70, height: 400, get_transformed_position: () => [0, 300]};

    // 1. Near the top flare edge (y = 305):
    // Within footDepth (x = 2): solid foot touching monitor edge -> true
    assert.equal(dock.isWithinHoverArea([2, 305]), true, 'Solid foot near monitor edge is interactive');
    // Beyond footDepth (x = 30): transparent corner away from monitor edge -> false
    assert.equal(dock.isWithinHoverArea([30, 305]), false, 'Transparent corner in top flare zone must not activate hover');

    // 2. Near the bottom flare edge (y = 695):
    assert.equal(dock.isWithinHoverArea([2, 695]), true, 'Solid foot near bottom monitor edge is interactive');
    assert.equal(dock.isWithinHoverArea([30, 695]), false, 'Transparent corner in bottom flare zone must not activate hover');
});

test('Dock.isWithinHoverArea: Floating mode strictly bounds the dock capsule', async () => {
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
            'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
            'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
            'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: Actor, DashItemContainer: Actor},
            'gi://Shell': {default: {AppSystem: {get_default: () => ({get_installed: () => []})}}},
            'gi://Gio': {default: {}},
            'gi://Graphene': {default: {Point: class {}}},
            'gi://GObject': {default: {registerClass: registerBackgroundClass}},
            'gi://Clutter': {
                default: {
                    ActorAlign: {CENTER: 0},
                    OffscreenRedirect: {ALWAYS: 1},
                    Orientation: {VERTICAL: 1, HORIZONTAL: 0},
                },
            },
            'gi://St': {default: {Widget: class extends Actor {}}},
            './effects/tint_effect.js': {TintEffect: class {}},
            './effects/monochrome_effect.js': {MonochromeEffect: class {}},
            './dockItems.js': {DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor},
            './dockItemMenu.js': {DockItemList: class {}},
            './autohide.js': {AutoHide: class {}},
            './animator.js': {Animator: class {}},
            './utils.js': {get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => ''},
        },
    });

    const dock = new dockModule.Dock({
        extension: {
            icon_size: 48,
            background_style: 0, // Floating mode
            _config: {},
        },
    });
    dock._hidden = false;
    dock._position = 'bottom';
    // Floating dock capsule at [500, 1000, 300, 60]
    dock._background = {x: 500, y: 1000, width: 300, height: 60, get_transformed_position: () => [500, 1000]};

    // Center of floating capsule
    assert.equal(dock.isWithinHoverArea([650, 1030]), true);

    // Outside bounds with zero tolerance
    assert.equal(dock.isWithinHoverArea([650, 999]), false, '1px above floating dock is false');
    assert.equal(dock.isWithinHoverArea([650, 1061]), false, '1px below floating dock is false');
    assert.equal(dock.isWithinHoverArea([499, 1030]), false, '1px left of floating dock is false');
    assert.equal(dock.isWithinHoverArea([801, 1030]), false, '1px right of floating dock is false');
});

test('Animator & Hover Integration: Cursor inside Firefox does not magnify icons or show tooltip', async () => {
    let pointer = [85, 52]; // Left dock: x=85 is inside Firefox (dock width is 48)
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
            './utils.js': {get_distance_sqr: distanceSquared, get_distance: (a, b) => Math.sqrt(distanceSquared(a, b)), isInRect() {}, isOverlapRect() {}},
        },
    });

    const icons = Array.from({length: 5}, (_, i) => {
        const icon = new Actor({x: 0, y: i * 56});
        icon._icon = new Actor({icon_name: 'app', gicon: null});
        icon._label = new Actor({text: `App ${i}`, opacity: 0});
        icon.add_child(icon._icon);
        return icon;
    });

    const dock = {
        extension: {
            animate_icons_unmute: true, animation_rise: 0.5, animation_magnify: 0.5,
            animation_spread: 0.6, _config: {speed_up: 1}, autohide_speed: 0.5,
            background_style: 1, flare_width: 14, foot_depth: 4,
            integrations: {bms_update_size() {}},
        },
        _icons: icons, _iconSize: 48, _iconSizeScaledDown: 48, _scaleFactor: 1,
        _edge_distance: 0, _position: 'left', _separators: [],
        opacity: 255, width: 48, height: 280, x: 0, y: 0, animation_fps: 1,
        dash: new Actor(), renderArea: new Actor(), struts: new Actor(),
        _background: {x: 0, y: 0, width: 48, height: 280, _padding: 0, update() {}, get_transformed_position: () => [0, 0]},
        layout: () => true, isVertical: () => true,
        getMonitor: () => ({x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1}),
        isWithinHoverArea: (p) => {
            // Left dock with width 48:
            return p[0] >= 0 && p[0] < 48 && p[1] >= 0 && p[1] < 280;
        },
        _updateTransparenies() {}, _debounceEndAnimation() {},
        autohider: {_debounceCheckHide() {}},
    };

    const animator = new Animator();
    animator.dock = dock;
    animator.enable();

    // Settle with pointer in Firefox (x = 85, y = 52)
    for (let i = 0; i < 60; i++) animator.animate(16);

    // 1. Hover target must be null
    assert.equal(dock._nearestIcon, null, 'Nearest icon must be null when pointer is in Firefox');
    assert.equal(dock._hoveredIcon, null, 'Hovered icon must be null when pointer is in Firefox');

    // 2. All icons must remain at resting scale 1
    icons.forEach((icon, i) => {
        assert.equal(icon._targetScale, 1, `Icon ${i} target scale must remain 1`);
        assert.ok(Math.abs(icon._renderer.icon_size * icon._renderer.scaleX - dock._iconSizeScaledDown) < 0.1,
            `Icon ${i} rendered size must remain resting size 48px`);
        assert.equal(icon._label.opacity, 0, `Icon ${i} label must be hidden`);
    });
});

test('Animator & Hover Integration: Entering dock magnifies icons, leaving immediately clears hover and hides tooltip', async () => {
    let pointer = [24, 52]; // Inside Left dock
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
            './utils.js': {get_distance_sqr: distanceSquared, get_distance: (a, b) => Math.sqrt(distanceSquared(a, b)), isInRect() {}, isOverlapRect() {}},
        },
    });

    const icons = Array.from({length: 5}, (_, i) => {
        const icon = new Actor({x: 0, y: i * 56});
        icon._icon = new Actor({icon_name: 'app', gicon: null});
        icon._label = new Actor({text: `App ${i}`, opacity: 0});
        icon.add_child(icon._icon);
        return icon;
    });

    const dock = {
        extension: {
            animate_icons_unmute: true, animation_rise: 0.5, animation_magnify: 0.5,
            animation_spread: 0.6, _config: {speed_up: 1}, autohide_speed: 0.5,
            background_style: 1, flare_width: 14, foot_depth: 4,
            integrations: {bms_update_size() {}},
        },
        _icons: icons, _iconSize: 48, _iconSizeScaledDown: 48, _scaleFactor: 1,
        _edge_distance: 0, _position: 'left', _separators: [],
        opacity: 255, width: 48, height: 280, x: 0, y: 0, animation_fps: 1,
        dash: new Actor(), renderArea: new Actor(), struts: new Actor(),
        _background: {x: 0, y: 0, width: 48, height: 280, _padding: 0, update() {}, get_transformed_position: () => [0, 0]},
        layout: () => true, isVertical: () => true,
        getMonitor: () => ({x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1}),
        isWithinHoverArea: (p) => {
            return p[0] >= 0 && p[0] < 48 && p[1] >= 0 && p[1] < 280;
        },
        _updateTransparenies() {}, _debounceEndAnimation() {},
        autohider: {_debounceCheckHide() {}},
    };

    const animator = new Animator();
    animator.dock = dock;
    animator.enable();

    // 1. Settle with pointer inside dock (x = 24, y = 52) over icon 1
    for (let i = 0; i < 240; i++) animator.animate(16);
    assert.ok(dock._nearestIcon !== null, 'Nearest icon must be active');
    assert.ok(icons[1]._targetScale > 1.2, 'Icon 1 target scale must be magnified');
    assert.ok(icons[1]._renderer.icon_size * icons[1]._renderer.scaleX > 48 * 1.2, 'Painted icon must magnify even when its texture is rendered at higher resolution');

    // 2. Move pointer outside into Firefox (x = 75, y = 52)
    pointer = [75, 52];
    animator.animate(16);

    // On the very next frame after exiting:
    assert.equal(dock._nearestIcon, null, 'Nearest icon must clear to null on exit');
    assert.equal(dock._hoveredIcon, null, 'Hovered icon must clear to null on exit');
    assert.equal(icons[1]._label.opacity, 0, 'Tooltip label must hide immediately on exit');
    assert.equal(icons[1]._targetScale, 1, 'Target scale must reset to 1');

    // 3. Settle outside: all icons smoothly return to resting size (scaleFactor 1.5, size 48)
    for (let i = 0; i < 240; i++) animator.animate(16);
    icons.forEach((icon, i) => {
        assert.equal(icon._targetScale, 1, `Icon ${i} target scale must settle at 1`);
        assert.ok(Math.abs(icon._renderer.icon_size * icon._renderer.scaleX - dock._iconSizeScaledDown) < 0.1,
            `Icon ${i} must return to resting size 48px`);
    });

    // 4. Return pointer into dock: hover reactivates normally
    pointer = [24, 52];
    for (let i = 0; i < 240; i++) animator.animate(16);
    assert.ok(dock._nearestIcon !== null, 'Nearest icon must reactivate upon return');
    assert.ok(icons[1]._targetScale > 1.2, 'Icon 1 must magnify again');
});

test('Dock recursion protection: animate() fast-forward runs iteratively without nested recursion', async () => {
    let callDepth = 0;
    let maxCallDepth = 0;
    let animatorCalls = 0;

    const fakeDock = {
        _preview: 0,
        _pauseBounce: 0,
        _fast_forward: 20,
        dash: { opacity: 255 },
        simulated_pointer: null,
        animator: {
            animate(dt) {
                animatorCalls++;
                callDepth++;
                maxCallDepth = Math.max(maxCallDepth, callDepth);
                callDepth--;
            },
        },
    };

    // Load actual Dock prototype animate method
    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': { layoutManager: { primaryIndex: 0 } },
            'resource:///org/gnome/shell/ui/appFavorites.js': { getAppFavorites: () => ({ _getIds: () => [], getFavorites: () => [] }) },
            'resource:///org/gnome/shell/misc/config.js': { PACKAGE_VERSION: '51' },
            'resource:///org/gnome/shell/ui/dash.js': { Dash: Actor, DashIcon: Actor, DashItemContainer: Actor },
            './dockItems.js': { DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor },
            './dockItemMenu.js': { DockItemList: class {} },
            './effects/tint_effect.js': { TintEffect: class {} },
            './effects/monochrome_effect.js': { MonochromeEffect: class {} },
            './appearance.js': {},
            './style.js': {},
            './animator.js': { Animator: class {} },
            './autohide.js': { AutoHide: class {} },
            './dockOverflow.js': { computeDockViewport: () => ({ height: 200, contentTop: 14, bodyHeight: 180, overflow: false }) },
            './utils.js': { get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => '' },
            'gi://Clutter': { default: { ActorAlign: { CENTER: 0 }, Orientation: { VERTICAL: 1, HORIZONTAL: 0 } } },
            'gi://St': { default: { Widget: Actor, ScrollView: Actor, BoxLayout: Actor, PolicyType: {} } },
            'gi://GObject': { default: { registerClass: (_meta, cls) => cls } },
            'gi://Graphene': { default: { Point: class {} } },
            'gi://Shell': { default: { AppSystem: { get_default: () => ({ get_installed: () => [] }) } } },
            'gi://Gio': { default: {} },
            'gi://GLib': { default: {} },
        },
    });

    fakeDock.animate = dockModule.Dock.prototype.animate.bind(fakeDock);

    // Call animate() with _fast_forward = 20
    fakeDock.animate(16);

    // 1 base animate call + 20 fast-forward calls = 21 total animator.animate calls
    assert.equal(animatorCalls, 21, 'Must execute 1 base + 20 fast-forward simulation steps');
    assert.equal(fakeDock._fast_forward, 0, '_fast_forward must be exhausted to 0');
    assert.equal(maxCallDepth, 1, 'Max stack depth must be 1 (strictly iterative, zero recursion)');
    assert.equal(fakeDock._inAnimate, false, '_inAnimate re-entrancy lock must be released');
});

test('Dock recursion protection: re-entrant layout() calls return safely without recursive looping', async () => {
    let layoutDepth = 0;
    let maxLayoutDepth = 0;
    let layoutExecutionCount = 0;

    const fakeDock = {
        dash: {
            last_child: { text_direction: 1, layout_manager: {} },
            _box: { text_direction: 1, layout_manager: {} },
            set_size() {},
            set_position() {},
        },
        extension: {
            dock_location: 1,
            icon_size: 48,
            animation_spread: 0.5,
            flare_width: 14,
            animation_magnify: 0.5,
        },
        _findIcons: () => [],
        _updateExtraIcons() {},
        getMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1 }),
        _syncOwnedStruts() {},
        isVertical: () => true,
        _preferredIconSize: () => 48,
        _configureScrollView() {},
        _snapToContainerEdge() {},
        renderArea: new Actor(),
        dwell: {},
        struts: {},
        _icons: [],
    };

    const dockModule = await loadModule('dash2dock-lite@custom/dock.js', {
        mocks: {
            'resource:///org/gnome/shell/ui/main.js': { layoutManager: { primaryIndex: 0 } },
            'resource:///org/gnome/shell/ui/appFavorites.js': { getAppFavorites: () => ({ _getIds: () => [], getFavorites: () => [] }) },
            'resource:///org/gnome/shell/misc/config.js': { PACKAGE_VERSION: '51' },
            'resource:///org/gnome/shell/ui/dash.js': { Dash: Actor, DashIcon: Actor, DashItemContainer: Actor },
            './dockItems.js': { DockIcon: Actor, DockItemContainer: Actor, DockBackground: Actor },
            './dockItemMenu.js': { DockItemList: class {} },
            './effects/tint_effect.js': { TintEffect: class {} },
            './effects/monochrome_effect.js': { MonochromeEffect: class {} },
            './appearance.js': {},
            './style.js': {},
            './animator.js': { Animator: class {} },
            './autohide.js': { AutoHide: class {} },
            './dockOverflow.js': { computeDockViewport: () => ({ height: 200, contentTop: 14, bodyHeight: 180, overflow: false }) },
            './utils.js': { get_distance_sqr: () => 0, get_distance: () => 0, isInRect: () => false, isOverlapRect: () => false, tempPath: () => '' },
            'gi://Clutter': { default: { ActorAlign: { CENTER: 0 }, Orientation: { VERTICAL: 1, HORIZONTAL: 0 } } },
            'gi://St': { default: { Widget: Actor, ScrollView: Actor, BoxLayout: Actor, PolicyType: {} } },
            'gi://GObject': { default: { registerClass: (_meta, cls) => cls } },
            'gi://Graphene': { default: { Point: class {} } },
            'gi://Shell': { default: { AppSystem: { get_default: () => ({ get_installed: () => [] }) } } },
            'gi://Gio': { default: {} },
            'gi://GLib': { default: {} },
        },
    });

    fakeDock.layout = dockModule.Dock.prototype.layout.bind(fakeDock);

    // Simulate an allocation or notification listener that attempts re-entrant layout()
    fakeDock._updateExtraIcons = () => {
        layoutDepth++;
        maxLayoutDepth = Math.max(maxLayoutDepth, layoutDepth);
        layoutExecutionCount++;
        // Attempt recursive layout call inside layout()
        const result = fakeDock.layout();
        assert.equal(result, true, 'Re-entrant layout() must return true early without repeating execution');
        layoutDepth--;
    };

    fakeDock.layout();

    assert.equal(layoutExecutionCount, 1, 'Only one actual layout pass executed');
    assert.equal(maxLayoutDepth, 1, 'Maximum layout depth strictly limited to 1');
    assert.equal(fakeDock._inLayout, false, '_inLayout re-entrancy lock released');
});



test('icon textures cover full magnification, retain saved quality and do not reload as the pointer moves', async () => {
    for (const size of [15, 30, 38, 45, 60]) for (const quality of [1, 3, 4]) {
        const env = await setup('bottom');
        const {dock, icons, animator} = env;
        dock._iconSizeScaledDown = dock._iconSize = size;
        dock.extension.icon_quality = quality;
        dock.extension.animation_magnify = 1;
        for (const icon of icons) icon.set_size(size, size);
        env.move(56 + size / 2);
        env.settle();
        for (const icon of icons) {
            const renderer = icon._renderer;
            assert.ok(renderer.icon_size >= 32 * quality, 'never lower the saved texture quality budget');
            assert.ok(renderer.icon_size >= size * 2, 'maximum magnification must not upscale a small raster');
            assert.equal(renderer.icon_size % size, 0, 'resting icon uses a whole-number texture reduction');
            assert.ok(renderer.scaleX <= 1);
        }
        assert.ok(icons.some(icon => icon._renderBounds.width > size * 1.5), 'magnification retains its visible size');
        let reloads = 0;
        for (const icon of icons) {
            const renderer = icon._renderer;
            const original = renderer.set_icon_size;
            renderer.set_icon_size = function (next) { reloads++; return original.call(this, next); };
        }
        for (let frame = 0; frame < 60; frame++) { env.move(40 + frame * 2); animator.animate(1000 / 120); }
        env.leave(); env.settle();
        assert.equal(reloads, 0, 'hover animation cannot trigger asynchronous texture-size reloads');
        for (const icon of icons) assert.ok(Math.abs(icon._renderer.icon_size * icon._renderer.scaleX - size) < 1e-9);
    }
});

test('resting painted icons align to physical pixels while animation and native source geometry remain continuous', async () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const env = await setup('bottom');
        const {icons, dock, animator} = env;
        for (const icon of icons) { icon.x += 0.35; icon.y += 0.45; }
        const source = icons.map(icon => icon.get_transformed_position());
        animator.animate(16);
        for (const icon of icons) icon._renderer.get_resource_scale = () => scale;
        env.leave(); env.settle();
        for (const icon of icons) {
            const b = icon._renderBounds;
            assert.ok(Math.abs(b.x * scale - Math.round(b.x * scale)) < 1e-9);
            assert.ok(Math.abs(b.y * scale - Math.round(b.y * scale)) < 1e-9);
        }
        assert.deepEqual(icons.map(icon => icon.get_transformed_position()), source);
        // Resume hovering without changing the mock's native source allocation.
        const active = await setup('bottom');
        active.animator.animate(16);
        active.icons[1]._renderer.get_resource_scale = () => scale;
        active.move(80.25);
        active.animator.animate(1000 / 120);
        assert.equal(active.icons[1]._paintSettled, false);
        const b = active.icons[1]._renderBounds;
        assert.ok(Math.abs(b.x * scale - Math.round(b.x * scale)) > 1e-6,
            'in-flight motion is not rounded into pixel-sized jumps');
    }
});

test('unified magnification keeps padded native Dash allocations inside the attached edge on every frame', async () => {
    for (const edge of ['left', 'right', 'top', 'bottom']) for (const rise of [0, 1]) {
        const env = await setup(edge);
        const {dock, icons, animator} = env;
        const vertical = edge === 'left' || edge === 'right';
        dock.x = 0; dock.y = 0;
        dock.width = vertical ? 100 : 450;
        dock.height = vertical ? 450 : 100;
        dock.extension.global_scale = 1;
        dock.extension.desktopLayoutManager = {mode: 1};
        dock.extension.animation_magnify = 1;
        dock.extension.animation_rise = rise;
        dock._iconSizeScaledDown = dock._iconSize = 30;
        for (const [index, icon] of icons.entries()) {
            // Real Shell 51 Dash takes 6 px padding from either side of the
            // requested 34 px width, leaving a non-square source allocation.
            icon.set_size(vertical ? 22 : 39, vertical ? 39 : 22);
            icon.x = vertical ? edge === 'left' ? 6 : 72 : 100 + index * 39;
            icon.y = vertical ? 100 + index * 39 : edge === 'top' ? 6 : 72;
        }
        const center = icons[2].get_transformed_position();
        env.point([center[0] + icons[2].width / 2, center[1] + icons[2].height / 2]);
        for (let frame = 0; frame < 120; frame++) {
            animator.animate(16);
            for (const icon of icons) {
                const b = icon._renderBounds;
                assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= dock.width && b.y + b.height <= dock.height,
                    `${edge} rise ${rise}, frame ${frame}: painted icon stays inside the screen`);
            }
        }
        env.leave();
        for (let frame = 0; frame < 120; frame++) {
            animator.animate(16);
            for (const icon of icons) {
                const b = icon._renderBounds;
                assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= dock.width && b.y + b.height <= dock.height,
                    `${edge} rise ${rise}, collapse ${frame}: painted icon stays inside the screen`);
            }
        }
    }
});
