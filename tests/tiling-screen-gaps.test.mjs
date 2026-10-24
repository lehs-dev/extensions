import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

const root = 'tiling-assistant@custom';
const geometry = rect => ({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
const uniform = size => ({top: size, left: size, right: size, bottom: size});
const defaults = {
    'window-gap': 10, 'single-screen-gap': 10, 'panel-edge-gap': 0,
    'screen-top-gap': 0, 'screen-left-gap': 0, 'screen-right-gap': 0, 'screen-bottom-gap': 0,
    'use-individual-screen-gaps': false, 'screen-gaps-panel-monitor-only': true,
    'disable-tile-groups': true,
};

class SettingsStore {
    constructor(values = {}) { this.values = {...values}; this.writes = []; }
    get_user_value(key) { return Object.hasOwn(this.values, key) ? {value: this.values[key]} : null; }
    get_int(key) { return this.values[key] ?? defaults[key] ?? 0; }
    get_boolean(key) { return this.values[key] ?? defaults[key] ?? false; }
    set_int(key, value) { this.values[key] = value; this.writes.push([key, value]); }
    set_boolean(key, value) { this.values[key] = value; this.writes.push([key, value]); }
}

async function setup(preferences = {}) {
    class Rectangle {
        constructor(values = {}) { Object.assign(this, {x: 0, y: 0, width: 0, height: 0}, values); }
        copy() { return new Rectangle(this); }
        equal(other) { return ['x', 'y', 'width', 'height'].every(key => this[key] === other[key]); }
        overlap(other) {
            return this.x < other.x + other.width && this.x + this.width > other.x &&
                this.y < other.y + other.height && this.y + this.height > other.y;
        }
        intersect(other) {
            const x = Math.max(this.x, other.x);
            const y = Math.max(this.y, other.y);
            const width = Math.min(this.x + this.width, other.x + other.width) - x;
            const height = Math.min(this.y + this.height, other.y + other.height) - y;
            return [width > 0 && height > 0, new Rectangle({x, y, width, height})];
        }
    }
    const settings = new SettingsStore({'use-individual-screen-gaps': false, ...preferences});
    const common = await loadModule(`${root}/src/common.js`);
    common.Settings.initialize(settings);
    const monitors = [
        {x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1},
        {x: -1600, y: -100, width: 1600, height: 900, geometry_scale: 2},
    ];
    const workAreas = [
        {x: 0, y: 32, width: 1920, height: 1048},
        {x: -1600, y: -100, width: 1600, height: 900},
    ];
    const panelBox = new Actor({x: 0, y: 0, width: 1920, height: 32});
    const panel = new Actor({width: 1920, height: 32, mapped: true});
    panelBox.add_child(panel);
    const windows = [];
    const workspace = {get_work_area_for_monitor: monitor => new Rectangle(workAreas[monitor])};
    const Main = {
        panel, overview: {visible: false}, wm: {_prepareAnimationInfo() {}},
        layoutManager: {monitors, panelBox, primaryIndex: 0, primaryMonitor: monitors[0]},
    };
    const global = {
        display: {
            list_all_windows: () => windows, get_tab_list: () => windows,
            sort_windows_by_stacking: list => [...list],
            get_monitor_scale: monitor => monitors[monitor].geometry_scale,
            connectObject() {}, disconnectObject() {},
        },
        workspace_manager: {
            get_active_workspace: () => workspace, connectObject() {}, disconnectObject() {},
        },
        window_group: {set_child_below_sibling() {}},
    };
    const Meta = {
        MaximizeFlags: {HORIZONTAL: 1, VERTICAL: 2, BOTH: 3},
        WindowConstraint: {NONE: 0, WINDOW: 1, MONITOR: 2},
        TabList: {NORMAL_ALL: 0}, SizeChange: {MAXIMIZE: 0, UNMAXIMIZE: 1},
        GrabOp: {RESIZING_N: 2, RESIZING_S: 4, RESIZING_W: 8, RESIZING_E: 16},
    };
    const gi = {Gio: {_promisify() {}, File: class {}}, GLib: {},
        Clutter: {AnimationMode: {EASE_OUT_QUAD: 1}}, Meta, Mtk: {Rectangle}, St: {}, Shell: {}};
    const mocks = {
        '../dependencies/gi.js': gi,
        '../dependencies/shell.js': {Config: {PACKAGE_VERSION: '51.0'}, Main},
        '../common.js': {...common},
        '../dependencies/unexported/altTab.js': {getWindows: () => [...windows]},
    };
    const utility = await loadModule(`${root}/src/extension/utility.js`, {mocks, globals: {global}});
    const {TilingWindowManager: twm} = await loadModule(`${root}/src/extension/tilingWindowManager.js`, {
        mocks: {...mocks, './utility.js': utility}, globals: {global},
    });
    twm.initialize();

    function createWindow(monitor = 0) {
        const actor = new Actor();
        let frame = {x: monitors[monitor].x + 100, y: monitors[monitor].y + 100, width: 640, height: 480};
        const window = new Actor();
        Object.assign(window, {
            get_id: () => windows.indexOf(window), get_monitor: () => monitor,
            get_frame_rect: () => new Rectangle(frame),
            get_work_area_for_monitor: index => new Rectangle(workAreas[index]),
            get_work_area_current_monitor: () => new Rectangle(workAreas[monitor]),
            get_compositor_private: () => actor,
            is_skip_taskbar: () => false, is_above: () => false,
            allows_resize: () => true, allows_move: () => true,
            connectObject() {}, disconnectObject() {},
            unmake_fullscreen() {}, unmake_above() {}, unminimize() {},
            raise_and_make_recent_on_workspace() {}, move_to_monitor: index => { monitor = index; },
            override_constraints() {},
            move_frame(userOp, x, y) { Object.assign(frame, {x, y}); },
            move_resize_frame(userOp, x, y, width, height) { frame = {x, y, width, height}; },
            unmaximize() { window.maximizedHorizontally = window.maximizedVertically = false; },
            maximize() { window.maximizedHorizontally = window.maximizedVertically = true; },
            set_maximize_flags(flags) {
                window.maximizedHorizontally ||= Boolean(flags & 1);
                window.maximizedVertically ||= Boolean(flags & 2);
            },
        });
        windows.push(window);
        return window;
    }

    function setPanel(monitor, edge) {
        const m = monitors[monitor];
        const vertical = edge === 'left' || edge === 'right';
        panelBox.set_position(edge === 'right' ? m.x + m.width - 32 : m.x,
            edge === 'bottom' ? m.y + m.height - 32 : m.y);
        panelBox.set_size(vertical ? 32 : m.width, vertical ? m.height : 32);
        panel.set_size(panelBox.width, panelBox.height);
    }

    async function createPreview() {
        class NativePreview extends Actor {
            _init() { this._monitorIndex = -1; this._showing = false; }
            set_x(value) { this.x = value; }
            set_y(value) { this.y = value; }
            set_width(value) { this.width = value; }
            set_height(value) { this.height = value; }
            set_opacity(value) { this.opacity = value; }
        }
        let Preview;
        await loadModule(`${root}/src/extension/moveHandler.js`, {
            mocks: {
                ...mocks, './utility.js': utility, './tilingWindowManager.js': {TilingWindowManager: twm},
                './layoutPicker.js': {LayoutPicker: class {}, LayoutPickerTileType: {}},
                '../dependencies/gi.js': {...gi, GObject: {registerClass: cls => { Preview = cls; return cls; }}},
                '../dependencies/shell.js': {...mocks['../dependencies/shell.js'],
                    WindowManager: {TilePreview: NativePreview}},
            }, globals: {global},
        });
        const preview = new Preview();
        preview._init();
        return preview;
    }

    async function createResizeHandler(window) {
        const {default: ResizeHandler} = await loadModule(`${root}/src/extension/resizeHandler.js`, {
            mocks: {...mocks, './utility.js': utility, './tilingWindowManager.js': {TilingWindowManager: twm}},
            globals: {global},
        });
        const handler = Object.create(ResizeHandler.prototype);
        handler._preGrabRects = new Map([[window, new utility.Rect(window.get_frame_rect())]]);
        handler._resizeOps = new Map();
        return handler;
    }

    return {settings, Main, monitors, workAreas, panel, panelBox, utility, twm,
        createWindow, setPanel, createPreview, createResizeHandler, Meta,
        destroy() { twm.destroy(); common.Settings.destroy(); }};
}

test('the panel edge uses zero while ordinary edges and panel-free monitors keep the uniform gap', async () => {
    const env = await setup();
    const {Util, Rect} = env.utility;
    assert.deepEqual({...Util.getScreenGaps(0)}, {...uniform(10), top: 0});
    assert.deepEqual({...Util.getScreenGaps(1)}, uniform(10));
    const area = new Rect(env.workAreas[0]);
    const left = new Rect(area.x, area.y, area.width / 2, area.height).addGaps(area, 0);
    const right = new Rect(area.x + area.width / 2, area.y, area.width / 2, area.height).addGaps(area, 0);
    assert.deepEqual(geometry(left), {x: 10, y: 32, width: 945, height: 1038});
    assert.equal(right.x - left.x2, 10, 'the panel rule does not change the gap between windows');
    env.settings.set_int('panel-edge-gap', 3);
    assert.deepEqual({...Util.getScreenGaps(0)}, {...uniform(10), top: 3});
    assert.deepEqual({...Util.getScreenGaps(1)}, uniform(10));
    env.destroy();
});

test('panel gaps follow live top, bottom and side positions across monitor changes', async () => {
    const env = await setup();
    for (const edge of ['bottom', 'left', 'right', 'top']) {
        env.setPanel(1, edge);
        assert.deepEqual({...env.utility.Util.getScreenGaps(1)}, {...uniform(10), [edge]: 0}, edge);
        assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10), 'the old host regains uniform gaps');
    }
    env.monitors.splice(1, 1);
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10), 'unplugging the panel host leaves no stale host');
    env.setPanel(0, 'top');
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, {...uniform(10), top: 0});
    env.destroy();
});

test('hidden and floating panels and an unrelated dock do not suppress screen gaps', async () => {
    const env = await setup();
    env.panel.visible = false;
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10));
    env.panel.visible = true;
    env.panel.mapped = false;
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10));
    env.panel.mapped = true;
    env.panelBox.set_position(100, 100);
    env.panelBox.set_size(1200, 32);
    env.panel.set_size(1200, 32);
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10), 'a floating actor is not an edge panel');
    env.Main.panel = null;
    env.Main.layoutManager.panelBox = null;
    env.Main.layoutManager.uiGroup = new Actor();
    env.Main.layoutManager.uiGroup.add_child(new Actor({x: 0, y: 1048, width: 1920, height: 32}));
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(10), 'dock geometry is not enough to identify a panel');
    env.destroy();
});

test('custom screen gaps preserve zero and apply to the chosen monitor scope', async () => {
    const env = await setup({
        'use-individual-screen-gaps': true,
        'screen-top-gap': 6, 'screen-left-gap': 0, 'screen-right-gap': 18, 'screen-bottom-gap': 12,
    });
    const custom = {top: 6, left: 0, right: 18, bottom: 12};
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, custom, 'manual top gap overrides automatic panel zero');
    assert.deepEqual({...env.utility.Util.getScreenGaps(1)}, uniform(10));
    env.settings.set_boolean('screen-gaps-panel-monitor-only', false);
    assert.deepEqual({...env.utility.Util.getScreenGaps(1)}, custom);
    for (const key of ['screen-top-gap', 'screen-left-gap', 'screen-right-gap', 'screen-bottom-gap'])
        env.settings.set_int(key, 0);
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, uniform(0), 'all four custom zeroes stay zero');
    assert.deepEqual({...env.utility.Util.getScreenGaps(1)}, uniform(0));
    env.settings.set_boolean('use-individual-screen-gaps', false);
    assert.deepEqual({...env.utility.Util.getScreenGaps(0)}, {...uniform(10), top: 0});
    assert.deepEqual({...env.utility.Util.getScreenGaps(1)}, uniform(10));
    env.destroy();
});

test('panel-aware previews match final tiled frames on both monitors and after settings change', async () => {
    const env = await setup();
    const preview = await env.createPreview();
    for (const monitor of [0, 1]) {
        const area = new env.utility.Rect(env.workAreas[monitor]);
        const tile = new env.utility.Rect(area.x, area.y, area.width / 2, area.height / 2);
        const window = env.createWindow(monitor);
        preview.open(window, tile, monitor);
        preview.complete();
        await env.twm.tile(window, tile, {openTilingPopup: false});
        assert.deepEqual(geometry(preview), geometry(window.get_frame_rect()));
        assert.equal(preview.y - area.y, monitor === 0 ? 0 : 10);
    }
    const window = env.createWindow();
    const area = new env.utility.Rect(env.workAreas[0]);
    const tile = new env.utility.Rect(area.x, area.y, area.width / 2, area.height / 2);
    preview.open(window, tile, 0);
    preview.complete();
    env.settings.set_int('panel-edge-gap', 8);
    preview.open(window, tile, 0);
    preview.complete();
    await env.twm.tile(window, tile, {openTilingPopup: false});
    assert.deepEqual(geometry(preview), geometry(window.get_frame_rect()));
    assert.equal(preview.y, area.y + 8, 'an unchanged tile redraws when its effective gap changes');
    env.destroy();
});

test('resize completion reconstructs tiles with the effective panel edge gap', async () => {
    for (const [edge, direction] of [['top', 'N'], ['top', 'S'], ['left', 'W'], ['left', 'E']]) {
        const env = await setup();
        env.setPanel(0, edge);
        if (edge === 'left')
            env.workAreas[0] = {x: 32, y: 0, width: 1888, height: 1080};
        const area = new env.utility.Rect(env.workAreas[0]);
        const tile = new env.utility.Rect(area.x, area.y, area.width / 2, area.height / 2);
        const window = env.createWindow();
        await env.twm.tile(window, tile, {openTilingPopup: false});
        const handler = await env.createResizeHandler(window);
        const frame = geometry(window.get_frame_rect());
        if (direction === 'N') { frame.y += 100; frame.height -= 100; }
        if (direction === 'S') frame.height += 100;
        if (direction === 'W') { frame.x += 100; frame.width -= 100; }
        if (direction === 'E') frame.width += 100;
        window.move_resize_frame(true, frame.x, frame.y, frame.width, frame.height);
        handler._onResizeFinished(window, env.Meta.GrabOp[`RESIZING_${direction}`]);
        assert.deepEqual(geometry(window.tiledRect.addGaps(area, 0)), frame, `${edge} panel, resize ${direction}`);
        assert.deepEqual(geometry(env.twm.getTileStates().get(window.get_id()).tiledRect), geometry(window.tiledRect));
        assert.equal(handler._preGrabRects.size, 0);
        env.destroy();
    }
});

test('existing per-edge settings migrate once without changing their values or monitor coverage', async () => {
    const {Settings} = await loadModule(`${root}/src/common.js`);
    const settings = new SettingsStore({'screen-top-gap': 0, 'screen-left-gap': 4,
        'screen-right-gap': 16, 'screen-bottom-gap': 10});
    Settings.initialize(settings);
    assert.equal(settings.get_boolean('use-individual-screen-gaps'), true);
    assert.equal(settings.get_boolean('screen-gaps-panel-monitor-only'), false);
    assert.deepEqual(['screen-top-gap', 'screen-left-gap', 'screen-right-gap', 'screen-bottom-gap']
        .map(key => settings.get_int(key)), [0, 4, 16, 10]);
    const writes = [...settings.writes];
    Settings.initialize(settings);
    assert.deepEqual(settings.writes, writes, 'reinitialization does not overwrite migrated preferences');
    Settings.destroy();
});

test('migration preserves explicit mode and scope, and seeds only untouched custom edges', async () => {
    const {migrateScreenGapSettings} = await loadModule(`${root}/src/common.js`);
    const disabled = new SettingsStore({'use-individual-screen-gaps': false, 'screen-left-gap': 14});
    migrateScreenGapSettings(disabled);
    assert.equal(disabled.get_boolean('use-individual-screen-gaps'), false);
    assert.equal(disabled.writes.length, 0);
    const scoped = new SettingsStore({'screen-left-gap': 14, 'screen-gaps-panel-monitor-only': true});
    migrateScreenGapSettings(scoped);
    assert.equal(scoped.get_boolean('screen-gaps-panel-monitor-only'), true);
    const firstCustom = new SettingsStore({'use-individual-screen-gaps': true, 'single-screen-gap': 10});
    migrateScreenGapSettings(firstCustom);
    assert.deepEqual(['screen-top-gap', 'screen-left-gap', 'screen-right-gap', 'screen-bottom-gap']
        .map(key => firstCustom.get_int(key)), [10, 10, 10, 10]);
    const explicitZero = new SettingsStore({'use-individual-screen-gaps': true, 'screen-top-gap': 0});
    migrateScreenGapSettings(explicitZero);
    assert.deepEqual(['screen-top-gap', 'screen-left-gap', 'screen-right-gap', 'screen-bottom-gap']
        .map(key => explicitZero.get_int(key)), [0, 0, 0, 0]);
    const clean = new SettingsStore();
    migrateScreenGapSettings(clean);
    assert.equal(clean.get_boolean('use-individual-screen-gaps'), false);
    assert.equal(clean.get_boolean('screen-gaps-panel-monitor-only'), true);
});

test('Desktop 3 live gap contract shares tile, preview, resize and gapped-maximize without settings writes', async () => {
    const env = await setup({'maximize-with-gap': false});
    const {WindowGapCoordinator} = await loadModule('dash2dock-lite@custom/windowGaps.js', {
        mocks: {'resource:///org/gnome/shell/ui/main.js': env.Main},
    });
    const extension = {enable_window_outer_gap: true, desktopLayoutManager: {mode: 1}, window_outer_gap_size: 8,
        enable_screen_frame: true, screen_frame_thickness: 6, screen_frame_all_monitors: false};
    const coordinator = new WindowGapCoordinator({extension});
    coordinator.enable();
    env.Main.extensionManager = {lookup: uuid => uuid === 'dash2dock-lite@custom'
        ? {stateObj: {windowGapCoordinator: coordinator}} : null};
    const writes = [...env.settings.writes];
    const {Util, Rect} = env.utility;
    assert.deepEqual({...Util.getScreenGaps(0)}, {...uniform(14), top: 0},
        '32px panel strut already satisfies the desired 14px inset');
    assert.deepEqual({...Util.getScreenGaps(1)}, uniform(10), 'unframed monitor keeps TA saved preferences');
    assert.equal(Util.useGappedMaximize(0), true);
    assert.equal(Util.useGappedMaximize(1), false);
    const area = new Rect(env.workAreas[0]);
    const tile = new Rect(area.x, area.y, area.width / 2, area.height / 2);
    const window = env.createWindow();
    const preview = await env.createPreview();
    preview.open(window, tile, 0);
    preview.complete();
    await env.twm.tile(window, tile, {openTilingPopup: false});
    assert.deepEqual(geometry(preview), geometry(window.get_frame_rect()));
    assert.equal(window.get_frame_rect().x, 14);
    const handler = await env.createResizeHandler(window);
    const frame = geometry(window.get_frame_rect());
    frame.x += 100;
    frame.width -= 100;
    window.move_resize_frame(true, frame.x, frame.y, frame.width, frame.height);
    handler._onResizeFinished(window, env.Meta.GrabOp.RESIZING_W);
    assert.deepEqual(geometry(window.tiledRect.addGaps(area, 0)), frame);
    await env.twm.tile(window, area, {openTilingPopup: false});
    assert.equal(window.get_frame_rect().x, 14, 'TA maximize uses the same live provider');
    assert.equal(window.maximizedHorizontally, undefined, 'TA gap-maximize avoids native full maximization');
    assert.deepEqual(env.settings.writes, writes, 'other extensions saved settings stay unchanged');
    coordinator.destroy();
    assert.deepEqual({...Util.getScreenGaps(0)}, {...uniform(10), top: 0});
    assert.equal(Util.useGappedMaximize(0), false);
    env.destroy();
});
