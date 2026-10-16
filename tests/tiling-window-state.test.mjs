import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

const workArea = {x: 0, y: 32, width: 1920, height: 1040};
const originalFrame = {x: 100, y: 132, width: 640, height: 480};
const geometry = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});

async function setup(backend = 'ubuntu', preferences = {}) {
    class Rectangle {
        constructor() { Object.assign(this, {x: 0, y: 0, width: 0, height: 0}); }
        copy() { return Object.assign(new Rectangle(), this); }
        equal(other) {
            return ['x', 'y', 'width', 'height'].every(key => this[key] === other[key]);
        }
        overlap(other) {
            return this.x < other.x + other.width && this.x + this.width > other.x &&
                this.y < other.y + other.height && this.y + this.height > other.y;
        }
    }
    const settings = {'window-gap': 8, ...preferences};
    const animations = [];
    const windows = [];
    const workspace = {};
    const global = {
        display: {
            list_all_windows: () => windows,
            get_tab_list: () => windows,
            sort_windows_by_stacking: list => [...list],
            get_monitor_scale: () => 1,
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
            Meta: {MaximizeFlags: {HORIZONTAL: 1, VERTICAL: 2, BOTH: 3},
                WindowConstraint: {NONE: 0, WINDOW: 1, MONITOR: 2},
                TabList: {NORMAL_ALL: 0}, SizeChange: {MAXIMIZE: 0, UNMAXIMIZE: 1}},
        },
        '../dependencies/shell.js': {Config: {PACKAGE_VERSION: '51.0'},
            Main: {overview: {visible: false}, wm: {
                _prepareAnimationInfo: (...args) => animations.push(args),
            }}},
        '../dependencies/unexported/altTab.js': {getWindows: () => [...windows]},
        '../common.js': {Orientation: {}, Direction: {}, Settings: {
            getBoolean: key => Boolean(settings[key]), getInt: key => settings[key] ?? 0,
        }},
    };
    const utility = await loadModule(
        'tiling-assistant@leleat-on-github/src/extension/utility.js', {mocks, globals: {global}});
    const {TilingWindowManager: twm} = await loadModule(
        'tiling-assistant@leleat-on-github/src/extension/tilingWindowManager.js', {
            mocks: {...mocks, './utility.js': utility}, globals: {global},
        });
    twm.initialize();

    function createWindow() {
        const window = new Actor();
        const nativeWorkArea = Object.assign(new Rectangle(), workArea);
        let frame = {...originalFrame};
        let flags = 0;
        Object.assign(window, {
            maximizeCalls: 0, constraints: [0, 0, 0, 0], constraintOverrideCalls: 0,
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
            move_frame(userOp, x, y) { Object.assign(frame, {x, y}); },
            move_resize_frame(userOp, x, y, width, height) { frame = {x, y, width, height}; },
        });
        const setFlags = value => {
            flags = value;
            window.maximizedHorizontally = Boolean(flags & 1);
            window.maximizedVertically = Boolean(flags & 2);
        };
        if (backend === 'legacy') {
            window.maximize = function (directions) {
                this.maximizeCalls++;
                setFlags(flags | directions);
            };
            window.unmaximize = function (directions) { setFlags(flags & ~directions); };
        } else {
            window.maximize = function () {
                this.maximizeCalls++;
                setFlags(3);
            };
            window.unmaximize = function () { setFlags(0); };
            if (backend === 'ubuntu') {
                window.set_maximize_flags = directions => {
                    window.maximizeCalls++;
                    setFlags(flags | directions);
                };
            }
        }
        if (backend === 'ubuntu')
            window.override_constraints = (...edges) => {
                window.constraintOverrideCalls++;
                window.constraints = edges;
            };
        setFlags(0);
        windows.push(window);
        return window;
    }
    return {twm, Rect: utility.Rect, createWindow, settings, animations, utility};
}

// Explicit frame expectations include an 8px gap between adjacent windows,
// with no screen-edge gap, matching the reported configuration.
const layouts = [
    ['left', [0, 32, 960, 1040], [0, 32, 956, 1040], 2, [0, 0, 0, 0]],
    ['right', [960, 32, 960, 1040], [964, 32, 956, 1040], 2, [0, 0, 0, 0]],
    ['top', [0, 32, 1920, 520], [0, 32, 1920, 516], 1, [0, 0, 0, 0]],
    ['bottom', [0, 552, 1920, 520], [0, 556, 1920, 516], 1, [0, 0, 0, 0]],
    ['top-left', [0, 32, 960, 520], [0, 32, 956, 516], 0, [2, 2, 1, 1]],
    ['top-right', [960, 32, 960, 520], [964, 32, 956, 516], 0, [2, 1, 2, 1]],
    ['bottom-left', [0, 552, 960, 520], [0, 556, 956, 516], 0, [1, 2, 1, 2]],
    ['bottom-right', [960, 552, 960, 520], [964, 556, 956, 516], 0, [1, 1, 2, 2]],
];
const fromArray = ([x, y, width, height]) => ({x, y, width, height});

for (const backend of ['ubuntu', 'upstream', 'legacy']) {
    test(`half and quarter tiles preserve geometry and native states on ${backend} Mutter`, async () => {
        const {twm, Rect, createWindow} = await setup(backend, {'disable-tile-groups': true});
        const window = createWindow();
        let nativeMaximizeCalls = 0;
        for (const [name, tile, frame, flags, constraints] of layouts) {
            // Use the actual Rect implementation, including its gap calculations.
            await twm.tile(window, new Rect(...tile), {openTilingPopup: false});
            assert.deepEqual(window.get_frame_rect(), fromArray(frame), name);
            const nativeFlags = backend === 'upstream' ? 0 : flags;
            assert.equal(window.maximizedHorizontally, Boolean(nativeFlags & 1), name);
            assert.equal(window.maximizedVertically, Boolean(nativeFlags & 2), name);
            assert.deepEqual(window.constraints, backend === 'ubuntu' ? constraints : [0, 0, 0, 0], name);
            if (nativeFlags)
                nativeMaximizeCalls++;
            assert.equal(window.maximizeCalls, nativeMaximizeCalls, name);
            assert.equal(window.isTiled, true);
            assert.deepEqual(geometry(window.tiledRect), fromArray(tile));
            assert.deepEqual([...twm.getTileGroupFor(window)], [window]);
            assert.deepEqual(geometry(twm.getTileStates().get(window.get_id()).tiledRect), fromArray(tile));
        }
        twm.untile(window, {skipAnim: true});
        assert.deepEqual(window.get_frame_rect(), originalFrame);
        assert.equal(window.isTiled, false);
        assert.equal(window.maximizedHorizontally, false);
        assert.equal(window.maximizedVertically, false);
        assert.deepEqual(window.constraints, [0, 0, 0, 0]);
        assert.equal(twm.getTileStates().size, 0);
        twm.destroy();
    });

    test(`native maximize and restoring to a tile still work on ${backend} Mutter`, async () => {
        const {twm, Rect, createWindow} = await setup(backend, {'disable-tile-groups': true});
        const window = createWindow();
        await twm.tile(window, new Rect(workArea));
        assert.equal(window.maximizeCalls, 1);
        assert.equal(window.maximizedHorizontally, true);
        assert.equal(window.maximizedVertically, true);
        assert.equal(window.isTiled, false);
        assert.equal(window.tiledRect, null);

        await twm.tile(window, new Rect(...layouts[1][1]), {openTilingPopup: false});
        assert.equal(window.maximizedHorizontally, false);
        assert.equal(window.maximizedVertically, backend !== 'upstream');
        assert.deepEqual(window.get_frame_rect(), fromArray(layouts[1][2]));
        twm.untile(window, {skipAnim: true});
        assert.deepEqual(window.get_frame_rect(), originalFrame);
        twm.destroy();
    });
}

test('retiling updates native edge constraints and clears them when restored', async () => {
    const {twm, Rect, createWindow} = await setup('ubuntu', {'disable-tile-groups': true});
    for (const flags of [0, 1, 2]) {
        const window = createWindow();
        window.set_maximize_flags(flags);
        window.constraints = [1, 1, 2, 2];
        await twm.tile(window, new Rect(...layouts[4][1]), {openTilingPopup: false});
        assert.equal(window.maximizedHorizontally, false);
        assert.equal(window.maximizedVertically, false);
        assert.deepEqual(window.constraints, [2, 2, 1, 1]);
        assert.equal(window.constraintOverrideCalls, 1);
        assert.deepEqual(window.get_frame_rect(), fromArray(layouts[4][2]));
        twm.untile(window, {skipAnim: true});
        assert.deepEqual(window.constraints, [0, 0, 0, 0]);
        assert.equal(window.constraintOverrideCalls, 2);
        assert.deepEqual(window.get_frame_rect(), originalFrame);
    }
    twm.destroy();
});

test('screen gaps and maximization with gaps preserve configured geometry', async () => {
    const {twm, Rect, createWindow} = await setup('ubuntu', {
        'disable-tile-groups': true, 'single-screen-gap': 12, 'maximize-with-gap': true,
    });
    const window = createWindow();
    await twm.tile(window, new Rect(...layouts[0][1]), {openTilingPopup: false});
    assert.deepEqual(window.get_frame_rect(), {x: 12, y: 44, width: 944, height: 1016});
    assert.equal(window.maximizedHorizontally, false);
    assert.equal(window.maximizedVertically, false);
    assert.deepEqual(window.constraints, [2, 2, 1, 2]);
    await twm.tile(window, new Rect(workArea));
    assert.deepEqual(window.get_frame_rect(), {x: 12, y: 44, width: 1896, height: 1016});
    assert.equal(window.maximizeCalls, 0);
    assert.equal(window.isTiled, false);
    assert.equal(twm.isMaximized(window), true);
    twm.untile(window, {skipAnim: true});
    assert.deepEqual(window.get_frame_rect(), originalFrame);
    assert.deepEqual(window.constraints, [0, 0, 0, 0]);
    twm.destroy();
});

test('tiling preserves tile groups and the tiling popup request', async () => {
    const {twm, Rect, createWindow} = await setup();
    const left = createWindow();
    const right = createWindow();
    const popupRequests = [];
    twm.tryOpeningTilingPopup = async (window, rect) => { popupRequests.push({window, rect}); };
    await twm.tile(left, new Rect(...layouts[0][1]));
    await twm.tile(right, new Rect(...layouts[1][1]));
    assert.deepEqual([...twm.getTileGroupFor(left)], [left, right]);
    assert.deepEqual([...twm.getTileGroupFor(right)], [left, right]);
    assert.equal(popupRequests.length, 2);
    assert.equal(popupRequests[1].window, right);
    assert.deepEqual(geometry(popupRequests[1].rect), fromArray(layouts[1][2]));
    twm.untile(right, {skipAnim: true});
    assert.deepEqual([...twm.getTileGroupFor(left)], [left]);
    twm.destroy();
});

test('dragging a tile restores its size immediately even with untile animations enabled', async () => {
    const {twm, Rect, createWindow, animations, utility} = await setup('ubuntu', {
        'disable-tile-groups': true, 'enable-untile-animations': true,
    });
    const {default: MoveHandler} = await loadModule(
        'tiling-assistant@leleat-on-github/src/extension/moveHandler.js', {
            mocks: {
                '../dependencies/gi.js': {Clutter: {}, GLib: {}, Gio: {}, Meta: {}, Mtk: {},
                    GObject: {registerClass: cls => cls}},
                '../dependencies/shell.js': {Main: {}, WindowManager: {TilePreview: Actor}},
                '../common.js': {MoveModes: {}, Orientation: {}, Settings: {}},
                './utility.js': utility,
                './tilingWindowManager.js': {TilingWindowManager: twm},
                './layoutPicker.js': {LayoutPicker: class {}, LayoutPickerTileType: {}},
            },
        });
    const window = createWindow();
    const actor = new Actor();
    window.get_compositor_private = () => actor;
    await twm.tile(window, new Rect(...layouts[4][1]), {openTilingPopup: false});
    const handler = Object.create(MoveHandler.prototype);
    handler._wasMaximizedOnStart = false;
    let resumed = false;
    handler._onMoveStarted = restoredWindow => {
        assert.equal(restoredWindow, window);
        assert.equal(window.isTiled, false);
        assert.deepEqual(window.get_frame_rect(), {x: 0, y: 32, width: 640, height: 480});
        resumed = true;
    };
    handler._restoreSizeAndRestartGrab(window, 1);
    assert.equal(resumed, true);
    assert.equal(animations.length, 0, 'a live drag must not start a Shell resize clone');
    // Keyboard restoration still uses the configured untile animation.
    await twm.tile(window, new Rect(...layouts[4][1]), {openTilingPopup: false});
    twm.untile(window);
    assert.equal(animations.length, 1);
    twm.destroy();
});
