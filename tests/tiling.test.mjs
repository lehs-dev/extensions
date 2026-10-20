import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadModule, Actor} from './helpers/shell.mjs';

const standardWorkArea = {x: 0, y: 32, width: 1920, height: 1040};
const nonDivisibleWorkArea = {x: 0, y: 32, width: 1366, height: 736};
const originalFrame = {x: 100, y: 132, width: 640, height: 480};
const geometry = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});

async function setupTwm(preferences = {}, workArea = standardWorkArea, monitorScale = 1) {
    class Rectangle {
        constructor(params = {}) {
            Object.assign(this, {x: 0, y: 0, width: 0, height: 0}, params);
        }
        copy() { return new Rectangle(this); }
        equal(other) {
            return ['x', 'y', 'width', 'height'].every(key => this[key] === other[key]);
        }
        overlap(other) {
            return this.x < other.x + other.width && this.x + this.width > other.x &&
                this.y < other.y + other.height && this.y + this.height > other.y;
        }
    }
    const settings = {'window-gap': 8, ...preferences};
    const windows = [];
    const workspace = {};
    const nativeWorkArea = new Rectangle(workArea);
    const global = {
        display: {
            list_all_windows: () => windows,
            get_tab_list: () => windows,
            sort_windows_by_stacking: list => [...list],
            get_monitor_scale: () => monitorScale,
            connectObject() {}, disconnectObject() {},
        },
        workspace_manager: {
            get_active_workspace: () => workspace,
            connectObject() {}, disconnectObject() {},
        },
    };
    const mocks = {
        '../dependencies/gi.js': {
            Gio: {_promisify() {}, File: class {}}, GLib: {}, Clutter: {}, St: {}, Shell: {},
            Mtk: {Rectangle},
            Meta: {
                MaximizeFlags: {HORIZONTAL: 1, VERTICAL: 2, BOTH: 3},
                WindowConstraint: {NONE: 0, WINDOW: 1, MONITOR: 2},
                TabList: {NORMAL_ALL: 0}, SizeChange: {MAXIMIZE: 0, UNMAXIMIZE: 1},
            },
        },
        '../dependencies/shell.js': {
            Config: {PACKAGE_VERSION: '51.0'},
            Main: {overview: {visible: false}, wm: {_prepareAnimationInfo() {}}},
        },
        '../dependencies/unexported/altTab.js': {getWindows: () => [...windows]},
        '../common.js': {
            Orientation: {}, Direction: {},
            Settings: {
                getBoolean: key => Boolean(settings[key]),
                getInt: key => settings[key] ?? 0,
                getString: key => settings[key] ?? '',
                getStrv: key => settings[key] ?? [],
            },
        },
    };
    const utility = await loadModule(
        'tiling-assistant@custom/src/extension/utility.js',
        {mocks, globals: {global}}
    );
    const {TilingWindowManager: twm} = await loadModule(
        'tiling-assistant@custom/src/extension/tilingWindowManager.js',
        {mocks: {...mocks, './utility.js': utility}, globals: {global}}
    );
    twm.initialize();

    function createWindow() {
        const window = new Actor();
        let frame = {...originalFrame};
        let flags = 0;
        Object.assign(window, {
            constraints: [0, 0, 0, 0],
            get_id: () => windows.indexOf(window),
            get_monitor: () => 0,
            get_frame_rect: () => ({...frame}),
            get_work_area_for_monitor: () => nativeWorkArea,
            get_work_area_current_monitor: () => nativeWorkArea,
            get_compositor_private: () => null,
            is_skip_taskbar: () => false,
            is_above: () => false,
            allows_resize: () => true,
            allows_move: () => true,
            connectObject() {}, disconnectObject() {},
            unmake_fullscreen() {}, unmake_above() {}, unminimize() {},
            raise_and_make_recent_on_workspace() {}, move_to_monitor() {},
            override_constraints: (...edges) => { window.constraints = edges; },
            move_frame(userOp, x, y) { Object.assign(frame, {x, y}); },
            move_resize_frame(userOp, x, y, width, height) { frame = {x, y, width, height}; },
            unmaximize() {
                flags = 0;
                window.maximizedHorizontally = window.maximizedVertically = false;
            },
            maximize() {
                flags = 3;
                window.maximizedHorizontally = window.maximizedVertically = true;
            },
            set_maximize_flags(directions) {
                flags |= directions;
                window.maximizedHorizontally = Boolean(flags & 1);
                window.maximizedVertically = Boolean(flags & 2);
            },
        });
        window.maximizedHorizontally = window.maximizedVertically = false;
        windows.push(window);
        return window;
    }

    return {twm, Rect: utility.Rect, createWindow, settings, nativeWorkArea};
}

test('macOS Sequoia 1/3 and 2/3 presets geometry calculations on standard 1080p display', async () => {
    const {twm, Rect} = await setupTwm();
    const area = new Rect(standardWorkArea);

    const leftThird = twm.getDefaultTileFor('tile-left-third', area);
    const rightTwoThirds = twm.getDefaultTileFor('tile-right-two-thirds', area);
    const leftTwoThirds = twm.getDefaultTileFor('tile-left-two-thirds', area);
    const rightThird = twm.getDefaultTileFor('tile-right-third', area);
    const centerThird = twm.getDefaultTileFor('tile-center-third', area);

    // Exact expected coordinates on 1920x1040 work area
    assert.deepEqual(geometry(leftThird), {x: 0, y: 32, width: 640, height: 1040});
    assert.deepEqual(geometry(rightTwoThirds), {x: 640, y: 32, width: 1280, height: 1040});
    assert.deepEqual(geometry(leftTwoThirds), {x: 0, y: 32, width: 1280, height: 1040});
    assert.deepEqual(geometry(rightThird), {x: 1280, y: 32, width: 640, height: 1040});
    assert.deepEqual(geometry(centerThird), {x: 640, y: 32, width: 640, height: 1040});

    // Partitioning invariants: zero gaps and zero overlaps
    assert.equal(leftThird.width + rightTwoThirds.width, area.width);
    assert.equal(leftThird.x + leftThird.width, rightTwoThirds.x);

    assert.equal(leftTwoThirds.width + rightThird.width, area.width);
    assert.equal(leftTwoThirds.x + leftTwoThirds.width, rightThird.x);

    assert.equal(leftThird.width + centerThird.width + rightThird.width, area.width);
    assert.equal(leftThird.x + leftThird.width, centerThird.x);
    assert.equal(centerThird.x + centerThird.width, rightThird.x);

    twm.destroy();
});

test('macOS Sequoia 1/3 and 2/3 presets geometry on non-divisible resolution (1366x768)', async () => {
    const {twm, Rect} = await setupTwm({}, nonDivisibleWorkArea);
    const area = new Rect(nonDivisibleWorkArea);

    const leftThird = twm.getDefaultTileFor('tile-left-third', area);
    const rightTwoThirds = twm.getDefaultTileFor('tile-right-two-thirds', area);
    const leftTwoThirds = twm.getDefaultTileFor('tile-left-two-thirds', area);
    const rightThird = twm.getDefaultTileFor('tile-right-third', area);
    const centerThird = twm.getDefaultTileFor('tile-center-third', area);

    // 1366 / 3 rounds to 455; remainder 1px is cleanly absorbed by center third (456px)
    assert.deepEqual(geometry(leftThird), {x: 0, y: 32, width: 455, height: 736});
    assert.deepEqual(geometry(rightThird), {x: 911, y: 32, width: 455, height: 736});
    assert.deepEqual(geometry(centerThird), {x: 455, y: 32, width: 456, height: 736});
    assert.deepEqual(geometry(leftTwoThirds), {x: 0, y: 32, width: 911, height: 736});
    assert.deepEqual(geometry(rightTwoThirds), {x: 455, y: 32, width: 911, height: 736});

    // Verify perfect tiling without gap or overlap
    assert.equal(leftThird.width + rightTwoThirds.width, area.width);
    assert.equal(leftThird.x + leftThird.width, rightTwoThirds.x);

    assert.equal(leftTwoThirds.width + rightThird.width, area.width);
    assert.equal(leftTwoThirds.x + leftTwoThirds.width, rightThird.x);

    assert.equal(leftThird.width + centerThird.width + rightThird.width, area.width);
    assert.equal(leftThird.x + leftThird.width, centerThird.x);
    assert.equal(centerThird.x + centerThird.width, rightThird.x);

    twm.destroy();
});

test('preset tiling preserves uniform gaps and native vertical maximization', async () => {
    const {twm, Rect, createWindow} = await setupTwm({'window-gap': 8, 'single-screen-gap': 0});
    const area = new Rect(standardWorkArea);

    const leftWindow = createWindow();
    const rightWindow = createWindow();

    const leftThirdTile = twm.getDefaultTileFor('tile-left-third', area);
    const rightTwoThirdsTile = twm.getDefaultTileFor('tile-right-two-thirds', area);

    await twm.tile(leftWindow, leftThirdTile, {openTilingPopup: false});
    await twm.tile(rightWindow, rightTwoThirdsTile, {openTilingPopup: false});

    for (const w of [leftWindow, rightWindow]) {
        assert.equal(w.isTiled, true);
        assert.equal(w.maximizedHorizontally, false);
        assert.equal(w.maximizedVertically, true);
        assert.deepEqual(w.constraints, [0, 0, 0, 0]);
    }

    // 2. Uniform gap verification
    const leftFrame = leftWindow.get_frame_rect();
    const rightFrame = rightWindow.get_frame_rect();

    // Left third: outer edges touch x=0, inner edge has windowGap/2 = 4px inset (width = 640 - 4 = 636)
    assert.deepEqual(leftFrame, {x: 0, y: 32, width: 636, height: 1040});
    // Right 2/3: inner edge has windowGap/2 = 4px inset (x = 640 + 4 = 644, width = 1280 - 4 = 1276)
    assert.deepEqual(rightFrame, {x: 644, y: 32, width: 1276, height: 1040});

    // Exact 8px gap between adjacent tiles
    assert.equal(rightFrame.x - (leftFrame.x + leftFrame.width), 8);

    twm.destroy();
});

test('tiling respects reserved work area edges while applying inner gaps', async () => {
    // Shell struts shrink the work area before tiling geometry is calculated.
    const struttedWorkArea = {x: 16, y: 48, width: 1888, height: 1008};
    const {twm, Rect, createWindow} = await setupTwm({'window-gap': 8, 'single-screen-gap': 0}, struttedWorkArea);
    const area = new Rect(struttedWorkArea);

    const win1 = createWindow();
    const win2 = createWindow();

    const leftTwoThirds = twm.getDefaultTileFor('tile-left-two-thirds', area);
    const rightThird = twm.getDefaultTileFor('tile-right-third', area);

    await twm.tile(win1, leftTwoThirds, {openTilingPopup: false});
    await twm.tile(win2, rightThird, {openTilingPopup: false});

    const frame1 = win1.get_frame_rect();
    const frame2 = win2.get_frame_rect();

    // Left 2/3 starts at strut border x=16; right edge is inset by 4px
    assert.equal(frame1.x, 16);
    // Right 1/3 ends at strut border x=16+1888=1904; left edge is offset by 4px
    assert.equal(frame2.x + frame2.width, 1904);
    // Exact 8px uniform gap between the two windows
    assert.equal(frame2.x - (frame1.x + frame1.width), 8);

    twm.destroy();
});

test('schema defaults give 12px logical inner gaps without double scaling or extra outer margins', async () => {
    const tilingSchema = await readFile('tiling-assistant@custom/schemas/org.gnome.shell.extensions.tiling-assistant.gschema.xml', 'utf8');
    const defaultValue = (xml, key) => {
        const match = xml.match(new RegExp(`<key name="${key}"[^>]*>[\\s\\S]*?<default>([^<]+)</default>`));
        assert.ok(match, `schema defines ${key}`);
        return match[1].trim() === 'true' ? true : Number(match[1]);
    };
    const tilingDefaults = Object.fromEntries(['window-gap', 'single-screen-gap', 'screen-top-gap',
        'screen-bottom-gap', 'screen-left-gap', 'screen-right-gap']
        .map(key => [key, defaultValue(tilingSchema, key)]));
    assert.equal(tilingDefaults['window-gap'], 12);
    for (const key of ['single-screen-gap', 'screen-top-gap', 'screen-bottom-gap', 'screen-left-gap', 'screen-right-gap'])
        assert.equal(tilingDefaults[key], 0, `${key} defaults to no additional work area margin`);

    for (const scale of [1, 1.25, 2]) {
        const area = {x: -1920, y: -168, width: 1920, height: 1048};
        const {twm, Rect, createWindow} = await setupTwm(tilingDefaults, area, scale);
        const first = createWindow();
        const second = createWindow();
        await twm.tile(first, twm.getDefaultTileFor('tile-left-third', new Rect(area)), {openTilingPopup: false});
        await twm.tile(second, twm.getDefaultTileFor('tile-right-two-thirds', new Rect(area)), {openTilingPopup: false});
        const a = first.get_frame_rect();
        const b = second.get_frame_rect();
        const inner = b.x - a.x - a.width;
        assert.deepEqual([a.x - area.x, a.y - area.y,
            area.x + area.width - b.x - b.width,
            area.y + area.height - a.y - a.height], [0, 0, 0, 0], `${scale}x outer margins`);
        assert.equal(inner, 12, `${scale}x gap stays in logical stage coordinates`);
        twm.destroy();
    }
});

test('getTileFor finds adaptive thirds and preserves fallback to default', async () => {
    const {twm, Rect, createWindow} = await setupTwm();
    const area = new Rect(standardWorkArea);

    // Initial tile query without existing tiled windows returns default geometry
    const leftThird = twm.getTileFor('tile-left-third', area, 0);
    assert.equal(leftThird.width, 640);
    assert.equal(leftThird.height, 1040);

    const rightTwoThirds = twm.getTileFor('tile-right-two-thirds', area, 0);
    assert.equal(rightTwoThirds.width, 1280);
    assert.equal(rightTwoThirds.height, 1040);

    const centerThird = twm.getTileFor('tile-center-third', area, 0);
    assert.equal(centerThird.width, 640);
    assert.equal(centerThird.x, 640);

    twm.destroy();
});
