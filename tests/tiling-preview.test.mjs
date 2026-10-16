import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

const geometry = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
const workArea = {x: 0, y: 32, width: 1920, height: 1040};
const half = {x: 0, y: 32, width: 960, height: 1040};

async function setup(preferences = {}) {
    class Rectangle {
        constructor(params = {}) {
            Object.assign(this, {x: 0, y: 0, width: 0, height: 0}, params);
        }
        copy() { return new Rectangle(this); }
        equal(other) {
            assert.ok(other instanceof Rectangle, 'native equality requires an Mtk.Rectangle');
            return ['x', 'y', 'width', 'height'].every(key => this[key] === other[key]);
        }
        intersect(other) {
            const x = Math.max(this.x, other.x);
            const y = Math.max(this.y, other.y);
            const width = Math.min(this.x + this.width, other.x + other.width) - x;
            const height = Math.min(this.y + this.height, other.y + other.height) - y;
            return [width > 0 && height > 0, new Rectangle({x, y, width, height})];
        }
    }
    class NativePreview extends Actor {
        _init() { this._monitorIndex = -1; this._showing = false; }
        set_x(value) { this.x = value; }
        set_y(value) { this.y = value; }
        set_width(value) { this.width = value; }
        set_height(value) { this.height = value; }
        set_opacity(value) { this.opacity = value; }
    }
    const settings = {'window-gap': 8, ...preferences};
    let Preview;
    await loadModule('tiling-assistant@leleat-on-github/src/extension/moveHandler.js', {
        mocks: {
            '../dependencies/gi.js': {
                Clutter: {AnimationMode: {EASE_OUT_QUAD: 1}}, GLib: {}, Meta: {}, St: {},
                Gio: {_promisify() {}, File: class {}}, Mtk: {Rectangle},
                GObject: {registerClass: cls => { Preview = cls; return cls; }},
            },
            '../dependencies/shell.js': {
                Config: {PACKAGE_VERSION: '51.0'}, WindowManager: {TilePreview: NativePreview},
                Main: {layoutManager: {monitors: [
                    {x: 0, y: 0, width: 1920, height: 1080},
                    {x: 0, y: 0, width: 1920, height: 1080},
                ]}},
            },
            '../common.js': {Direction: {}, MoveModes: {}, Orientation: {}, Settings: {
                getInt: key => settings[key] ?? 0, getBoolean: key => Boolean(settings[key]),
            }},
            './tilingWindowManager.js': {TilingWindowManager: {}},
            './layoutPicker.js': {LayoutPicker: class {}, LayoutPickerTileType: {}},
        },
        globals: {global: {
            display: {get_monitor_scale: () => 1},
            window_group: {set_child_below_sibling() {}},
        }},
    });
    const preview = new Preview();
    preview._init();
    const window = {
        get_compositor_private: () => ({}),
        get_frame_rect: () => new Rectangle({x: 100, y: 132, width: 640, height: 480}),
        get_work_area_for_monitor: () => new Rectangle(workArea),
    };
    return {preview, window, settings, rect: values => new Rectangle(values)};
}

test('preview includes the same inner and outer gaps as the final tiled frame', async () => {
    const {preview, window, settings, rect} = await setup();
    preview.open(window, rect(half), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 0, y: 32, width: 956, height: 1040});
    assert.deepEqual(geometry(preview._rect), half, 'hold detection keeps the ungapped tile');
    preview.open(window, half, 0); // Favorite layouts also pass rectangle wrappers.
    assert.equal(preview.transitions.size, 0, 'normalize the tile before comparing native rectangles');

    settings['single-screen-gap'] = 12;
    preview.open(window, rect(half), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 12, y: 44, width: 944, height: 1016});

    preview.open(window, rect({x: 960, y: 32, width: 960, height: 520}), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 964, y: 44, width: 944, height: 504});
});

test('preview respects individual edge gaps and native versus gapped maximize', async () => {
    const {preview, window, settings, rect} = await setup({
        'single-screen-gap': 12,
        'screen-top-gap': 20, 'screen-bottom-gap': 16,
        'screen-left-gap': 10, 'screen-right-gap': 14,
    });
    preview.open(window, rect(half), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 10, y: 52, width: 946, height: 1004});
    preview.open(window, rect(workArea), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), workArea);
    settings['maximize-with-gap'] = true;
    preview.open(window, rect(workArea), 0);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 10, y: 52, width: 1896, height: 1004});
});

test('custom preview animations and opacity-only previews use the gapped frame', async () => {
    const {preview, window, rect} = await setup();
    const animation = {...half, opacity: 200};
    preview.open(window, rect(half), 0, animation);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 0, y: 32, width: 956, height: 1040});
    assert.equal(preview.opacity, 200);
    assert.deepEqual(animation, {...half, opacity: 200}, 'leave caller animation parameters intact');
    preview.open(window, rect({x: 960, y: 32, width: 960, height: 1040}), 0, {opacity: 255});
    assert.deepEqual(geometry(preview), {x: 964, y: 32, width: 956, height: 1040});
    preview.complete();
    assert.equal(preview.opacity, 255);
});

test('the same tile can reopen after hiding and update on a different monitor', async () => {
    const {preview, window, rect} = await setup();
    preview.open(window, rect(half), 0);
    preview.complete();
    preview._showing = false;
    preview.hide();
    preview.open(window, rect(half), 0);
    assert.equal(preview.visible, true);
    preview.complete();
    preview.open(window, rect(half), 1);
    assert.equal(preview._monitorIndex, 1);
    preview.complete();
    assert.deepEqual(geometry(preview), {x: 0, y: 32, width: 956, height: 1040});
});
