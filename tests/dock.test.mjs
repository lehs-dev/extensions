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
    const {Animator} = await loadModule('dash2dock-lite@icedman.github.com/animator.js', {
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
    const {Timer} = await loadModule('dash2dock-lite@icedman.github.com/timer.js', {
        mocks: {'gi://GLib': {default: {}}},
    });
    const timer = new Timer('test');
    const animation = {_frames: [], _time: 42};
    assert.equal(timer.runAnimation(animation), animation);
    assert.equal(animation._time, 0);
});
