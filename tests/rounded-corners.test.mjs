import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup(modern = true) {
    const display = new Actor();
    const wm = new Actor();
    const windows = [];
    let scale = 1;
    let uploads = 0;
    class ShaderEffect {
        constructor() { this.values = new Map(); this._init(); }
        _init() {}
        set_uniform_value(name, value) {
            this.values.set(name, value instanceof Value ? value.value : value);
            uploads++;
        }
        get_texture() { return {get_width: () => this.actor.textureWidth}; }
        queue_repaint() { this.repaint = true; }
        vfunc_paint_target() { this.painted = true; }
    }
    class Value {
        init(type) { assert.equal(type, 'float'); }
        set_float(value) { this.value = value; }
    }
    if (modern) {
        ShaderEffect.new_with_snippet = () => {};
        // GJS resolves inherited native vfuncs during assignment and throws
        // for abstract ones before a subclass override can be installed.
        Object.setPrototypeOf(ShaderEffect.prototype, new Proxy(Object.prototype, {
            set(target, name, value, receiver) {
                if (name === 'vfunc_get_static_snippet')
                    throw new Error("Virtual function not implemented: Class ClutterShaderEffect doesn't implement get_static_snippet");
                return Reflect.set(target, name, value, receiver);
            },
        }));
        ShaderEffect.prototype.set_uniform_float = function (name, components, values) {
            assert.equal(components, 1);
            assert.equal(values.length, 1);
            this.set_uniform_value(name, values[0]);
        };
    } else {
        ShaderEffect.prototype.set_shader_source = function (source) { this.source = source; };
    }
    class WindowActor extends Actor {
        constructor() { super(); this.effects = new Map(); this.textureWidth = 1000; }
        add_effect_with_name(name, effect) {
            assert.equal(this.effects.has(name), false);
            this.effects.set(name, effect);
            effect.actor = this;
        }
        remove_effect(effect) {
            const entry = [...this.effects].find(([, value]) => effect === value);
            assert.ok(entry, 'only remove an attached effect');
            this.effects.delete(entry[0]);
            effect.actor = null;
        }
    }
    function createWindow({mapped = true, maximized = false, fullscreen = false, type = 0} = {}) {
        const window = new Actor();
        window.actor = mapped ? new WindowActor() : null;
        window.frame = {x: -1920, y: 32, width: 960, height: 800};
        window.buffer = {x: -1940, y: 12, width: 1000, height: 840};
        window.maximizedHorizontally = window.maximizedVertically = maximized;
        window.fullscreen = fullscreen;
        window.get_window_type = () => type;
        window.get_compositor_private = () => window.actor;
        window.get_frame_rect = () => window.frame;
        window.get_buffer_rect = () => window.buffer;
        window.is_fullscreen = () => window.fullscreen;
        windows.push(window);
        return window;
    }
    display.list_all_windows = () => windows;
    const {default: Manager} = await loadModule(
        'tiling-assistant@leleat-on-github/src/extension/roundedCornersManager.js', {
            globals: {global: {display, window_manager: wm, stage: {}}},
            mocks: {
                'gi://Clutter': {default: {ShaderEffect}},
                'gi://Cogl': {default: {SnippetHook: {FRAGMENT: 1}, Snippet: {
                    new(hook, declarations) {
                        assert.equal(hook, 1);
                        return {declarations, set_replace(body) { this.body = body; }};
                    },
                }}},
                'gi://GObject': {default: {registerClass: (meta, cls) => cls, Value, TYPE_FLOAT: 'float'}},
                'gi://Meta': {default: {WindowType: {NORMAL: 0, DIALOG: 1, MODAL_DIALOG: 2}}},
                'gi://St': {default: {ThemeContext: {get_for_stage: () => ({scale_factor: scale})}}},
            },
        });
    const effectFor = window => window.actor?.effects.get('tiling-assistant-rounded-corners');
    return {Manager, display, wm, windows, createWindow, WindowActor, effectFor,
        setScale: value => { scale = value; }, getUploads: () => uploads};
}

for (const modern of [true, false]) {
    const backend = modern ? 'GNOME 51' : 'GNOME 50';

    test(`native maximize and fullscreen retain rounded corners on ${backend}`, async () => {
        const {Manager, createWindow, effectFor} = await setup(modern);
        const window = createWindow({maximized: true});
        const manager = new Manager();
        const effect = effectFor(window);
        assert.ok(effect, 'also handle windows already maximized when enabled');
        assert.equal(window.maximizedHorizontally, true);
        assert.equal(window.maximizedVertically, true);
        window.fullscreen = true;
        window.emit('notify::fullscreen');
        assert.equal(effectFor(window), effect);
        window.maximizedHorizontally = window.maximizedVertically = false;
        window.emit('notify::maximized-horizontally');
        assert.equal(effectFor(window), effect, 'fullscreen remains rounded after maximize flags clear');
        assert.equal(window.fullscreen, true);
        window.fullscreen = false;
        window.emit('notify::fullscreen');
        assert.equal(effectFor(window), undefined, 'restore the normal client decoration on exit');
        assert.equal(effect.window, null);
        manager.destroy();
    });

    test(`maximize via titlebar or shortcuts toggles the effect without accumulating it on ${backend}`, async () => {
        const {Manager, createWindow, effectFor} = await setup(modern);
        const window = createWindow();
        const manager = new Manager();
        assert.equal(effectFor(window), undefined);
        const otherEffect = {};
        window.actor.add_effect_with_name('other-effect', otherEffect);
        for (let i = 0; i < 20; i++) {
            window.maximizedVertically = true;
            window.emit('notify::maximized-vertically');
            assert.ok(effectFor(window));
            window.maximizedHorizontally = true;
            window.emit('notify::maximized-horizontally');
            assert.equal(window.actor.effects.size, 2);
            window.maximizedHorizontally = window.maximizedVertically = false;
            window.emit('notify::maximized-vertically');
            assert.deepEqual([...window.actor.effects.keys()], ['other-effect']);
        }
        manager.destroy();
        assert.equal(window.actor.effects.get('other-effect'), otherEffect);
        assert.equal(window.signals.size, 0);
    });

    test(`fullscreen created before mapping and actor replacement are covered on ${backend}`, async () => {
        const {Manager, display, wm, createWindow, WindowActor, effectFor} = await setup(modern);
        const manager = new Manager();
        const window = createWindow({mapped: false, fullscreen: true});
        display.emit('window-created', window);
        assert.equal(effectFor(window), undefined);
        window.actor = new WindowActor();
        window.actor.meta_window = window;
        wm.emit('map', window.actor);
        const effect = effectFor(window);
        assert.ok(effect);
        const oldActor = window.actor;
        oldActor.destroy();
        assert.equal(effect.window, null);
        window.actor = new WindowActor();
        window.actor.meta_window = window;
        wm.emit('map', window.actor);
        assert.ok(effectFor(window));
        assert.notEqual(effectFor(window), effect);
        manager.destroy();
        assert.equal(window.actor.effects.size, 0);
        assert.equal(window.actor.signals.size, 0);
        assert.equal(window.signals.size, 0);
        assert.equal(display.signals.size, 0);
        assert.equal(wm.signals.size, 0);
    });

    test(`shader uses the frame inside the buffer and adapts to scale and resize on ${backend}`, async () => {
        const {Manager, createWindow, effectFor, setScale, getUploads} = await setup(modern);
        const window = createWindow({maximized: true});
        const manager = new Manager();
        const effect = effectFor(window);
        effect.vfunc_paint_target();
        assert.deepEqual(Object.fromEntries(effect.values), {tex: 0,
            buffer_width: 1000, buffer_height: 840,
            frame_left: 20, frame_top: 20, frame_right: 980, frame_bottom: 820,
            corner_radius: 12, pixel_size: 1});
        setScale(2);
        window.actor.textureWidth = 1250; // A 1.25x render target.
        effect.vfunc_paint_target();
        assert.equal(effect.values.get('corner_radius'), 24);
        assert.equal(effect.values.get('pixel_size'), 0.8);
        window.frame.width = 10;
        window.emit('size-changed');
        assert.equal(effect.repaint, true);
        effect.vfunc_paint_target();
        assert.equal(effect.values.get('frame_right'), 30);
        assert.equal(effect.values.get('corner_radius'), 5, 'clamp radius for small frames');
        const before = getUploads();
        effect.vfunc_paint_target();
        assert.equal(getUploads() - before, 1, 'only the integer sampler is sent again');
        if (modern) {
            const snippet = effect.vfunc_get_static_snippet();
            assert.match(snippet.declarations, /uniform sampler2D tex/);
            assert.match(snippet.body, /cogl_color_out = .* \* coverage;/);
            assert.doesNotMatch(snippet.body, /void main/);
        } else {
            assert.match(effect.source, /void main\(\)/);
            assert.equal(effect.vfunc_get_static_snippet, undefined);
        }
        manager.destroy();
    });
}

test('closing windows and disabling releases effects without changing window state or geometry', async () => {
    const {Manager, createWindow, effectFor} = await setup();
    const window = createWindow({maximized: true});
    const fullscreen = createWindow({fullscreen: true});
    const desktop = createWindow({maximized: true, type: 3});
    const manager = new Manager();
    assert.equal(desktop.signals.size, 0);
    assert.equal(effectFor(desktop), undefined);
    window.emit('unmanaging');
    assert.equal(window.signals.size, 0);
    assert.equal(window.actor.signals.size, 0);
    assert.equal(window.actor.effects.size, 0);
    manager.destroy();
    assert.equal(fullscreen.actor.effects.size, 0);
    assert.equal(fullscreen.fullscreen, true);
    assert.equal(window.maximizedHorizontally, true);
    assert.deepEqual(window.frame, {x: -1920, y: 32, width: 960, height: 800});
});
