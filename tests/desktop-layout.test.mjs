import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

async function setup() {
    const monitor = {index: 0, x: -1440, y: -80, width: 1440, height: 900, geometry_scale: 1.5};
    const panel = new Actor({visible: true, translation_y: 7, height: 28});
    const uiGroup = new Actor();
    uiGroup.add_child(panel);
    const layout = new Actor({primaryIndex: 0, primaryMonitor: monitor, panelBox: panel, uiGroup});
    layout._trackedActors = [{actor: panel, affectsStruts: true, trackFullscreen: true}];
    layout.untrackChrome = actor => {
        layout._trackedActors = layout._trackedActors.filter(entry => entry.actor !== actor);
    };
    layout.trackChrome = (actor, params) => {
        assert.ok(!layout._trackedActors.some(entry => entry.actor === actor), 'chrome cannot be registered twice');
        layout._trackedActors.push({actor, ...params});
        if (params.trackFullscreen) actor.visible = !monitor.inFullscreen;
    };
    // GNOME 51 derives struts from chrome flags, including hidden actors.
    layout.workAreaTop = () => monitor.y + layout._trackedActors.reduce((height, entry) =>
        height + (entry.affectsStruts ? entry.actor.height : 0), 0);
    const extensionManager = new Actor();
    extensionManager.lookup = () => null;
    const actors = new Set();
    const counts = {states: 0, menus: 0};
    const control = {fail: null, menusAvailable: true, usable: true};
    class State {
        constructor() { counts.states++; }
        destroy() { counts.states--; }
    }
    class Menus {
        constructor() { counts.menus++; }
        get available() { return control.menusAvailable; }
        closeAll() { this.closes = (this.closes ?? 0) + 1; }
        destroy() { counts.menus--; }
    }
    class Pod {
        constructor(params) { this.params = params; this.dockPosition = 'left'; }
        enable() {
            actors.add(this);
            if (control.fail === this.constructor.name) throw new Error('injected enable failure');
        }
        getMeasuredContentHeight() { return this.constructor.name === 'Clock' ? 100 : 150; }
        get hasUsableControls() { return control.usable; }
        place(geometry) { Object.assign(this, geometry); }
        updateLayout() { this.params.onLayoutChanged?.(); }
        updateTheme() {}
        onSettingsChanged() {}
        destroy() { actors.delete(this); this.destroyed = true; }
    }
    class Quick extends Pod {}
    class Clock extends Pod {}
    class Input extends Pod {}
    class Rail extends Pod {}
    const extension = {desktop_layout: 0, enable_system_dock: true,
        modular_show_quicksettings: true, modular_show_clock: true,
        modular_show_appdock: true, modular_min_spacing: 16,
        enable_screen_frame: true, screen_frame_thickness: 6, screen_frame_corner_radius: 12,
        system_dock_hide_topbar: true,
        docks: [{layout() { this.layouts = (this.layouts ?? 0) + 1; }}]};
    const {DesktopLayoutManager} = await loadModule('dash2dock-lite@custom/desktopLayoutManager.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {layoutManager: layout, extensionManager},
        './systemDock/systemState.js': {SystemState: State},
        './systemDock/systemMenus.js': {SystemMenus: Menus},
        './systemDock/modularPods.js': {QuickSettingsPod: Quick, InputMethodPod: Input, ClockPod: Clock},
        './systemDock/systemDock.js': {SystemDock: Rail},
    }});
    const manager = new DesktopLayoutManager({extension});
    extension.desktopLayoutManager = manager;
    return {manager, extension, monitor, panel, actors, counts, control, layout, uiGroup, extensionManager};
}

test('legacy mode writes keep one Unified Dock, provider/menu owner and application dock identity', async () => {
    const env = await setup();
    const {manager, extension, actors, counts, panel} = env;
    const appDock = extension.docks[0];
    manager.enable();
    assert.equal(actors.size, 3);
    for (let i = 0; i < 30; i++) {
        extension.desktop_layout = i % 2 ? 0 : 1;
        manager.onSettingsChanged('desktop-layout', extension.desktop_layout);
        assert.equal(actors.size, 3);
        assert.equal(manager.mode, 1);
        assert.equal(counts.states, 1);
        assert.equal(counts.menus, 1);
        assert.equal(extension.docks[0], appDock);
    }
    manager.destroy();
    assert.equal(actors.size, 0);
    assert.equal(counts.states, 0);
    assert.equal(counts.menus, 0);
    assert.equal(panel.visible, true);
    assert.equal(panel.translation_y, 7);
    assert.equal(panel.parent, env.uiGroup);
    assert.equal(env.layout.signals.size, 0);
});

test('failed replacement retains old mode, releases pending actors and keeps system controls', async () => {
    const {manager, extension, control, actors, panel} = await setup();
    manager.enable();
    const oldPod = manager.quickSettingsPod;
    control.fail = 'Clock';
    extension.desktop_layout = 1;
    manager.onSettingsChanged('modular-show-clock', true);
    assert.equal(manager.mode, 1);
    assert.equal(manager.quickSettingsPod, oldPod);
    assert.equal(oldPod.destroyed, undefined);
    assert.equal(actors.size, 3);
    assert.equal(panel.visible, false); // retained working rail still controls menus
    manager.destroy();
    assert.equal(panel.visible, true);
});

test('failed initial layout restores panel and cleans shared services', async () => {
    const {manager, extension, control, counts, actors, panel} = await setup();
    extension.desktop_layout = 1;
    control.fail = 'Clock';
    assert.throws(() => manager.enable(), /injected enable failure/);
    assert.equal(actors.size, 0);
    assert.equal(counts.states, 0);
    assert.equal(counts.menus, 0);
    assert.equal(panel.visible, true);
});

test('pods meet the actual screen corners regardless of frame thickness or monitor scale', async () => {
    const {manager, extension, monitor} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    assert.equal(manager.quickSettingsPod.x, monitor.x);
    assert.equal(manager.quickSettingsPod.y, monitor.y);
    assert.equal(manager.quickSettingsPod.width, 34);
    assert.equal(manager.quickSettingsPod.startFlush, true);
    assert.equal(manager.clockPod.endFlush, true);
    assert.equal(manager.quickSettingsPod.contentLeft, 2);
    assert.equal(manager.quickSettingsPod.contentTop, 3);
    assert.equal(manager.inputMethodPod.y, manager.quickSettingsPod.y + manager.quickSettingsPod.height + 3);
    assert.equal(manager.inputMethodPod.x, monitor.x);
    assert.equal(manager.inputMethodPod.startFlush, false);
    assert.equal(manager.inputMethodPod.endFlush, false);
    assert.ok(manager.clockPod.y + manager.clockPod.height <= monitor.y + monitor.height);
    const bounds = manager.getModularConstraints(monitor);
    assert.equal(bounds.topBoundary, manager.inputMethodPod.y + manager.inputMethodPod.height + 16);
    assert.equal(bounds.bottomBoundary, manager.clockPod.y - 16);
    assert.equal(bounds.centerY, (bounds.topBoundary + bounds.bottomBoundary) / 2);
    assert.equal(manager.getModularConstraints({...monitor, index: 1, x: 0}), null);
    manager.destroy();
});

test('disabling a pod releases its actors and restores panel when replacement controls are incomplete', async () => {
    const {manager, extension, actors, panel} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    extension.modular_show_clock = false;
    manager.onSettingsChanged('modular-show-clock', false);
    assert.equal(manager.clockPod, null);
    assert.equal(actors.size, 2);
    assert.equal(panel.visible, true);
    const bounds = manager.getModularConstraints(envMonitor(manager));
    assert.ok(bounds.availableHeight > 0);
    manager.destroy();
});
function envMonitor(manager) { return manager._geometry.monitor; }

test('unchanged pod geometry does not relayout the application dock; height and monitor changes do', async () => {
    const {manager, extension, monitor} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    manager.updateLayout();
    const dock = extension.docks[0];
    const initial = dock.layouts;
    for (let i = 0; i < 30; i++) manager.updateLayout();
    assert.equal(dock.layouts, initial);
    manager.quickSettingsPod.getMeasuredContentHeight = () => 174;
    manager.updateLayout();
    assert.equal(dock.layouts, initial + 1);
    manager.updateLayout();
    assert.equal(dock.layouts, initial + 1);
    monitor.height += 100;
    manager.updateLayout();
    assert.equal(dock.layouts, initial + 2);
    manager.destroy();
});

test('unavailable menus or empty indicator content keep the native panel accessible', async () => {
    for (const key of ['menusAvailable', 'usable']) {
        const {manager, extension, control, panel} = await setup();
        extension.desktop_layout = 1;
        control[key] = false;
        manager.enable();
        assert.equal(panel.visible, true);
        manager.destroy();
    }
});

test('panel hidden by another owner stays hidden on layout disable', async () => {
    const {manager, panel} = await setup();
    panel.visible = false;
    manager.enable();
    manager.destroy();
    assert.equal(panel.visible, false);
});

test('impossible placement keeps one layout and restores native controls', async () => {
    const {manager, extension, monitor, actors, panel} = await setup();
    manager.enable();
    monitor.height = 200;
    extension.desktop_layout = 1;
    manager.updateLayout();
    assert.equal(manager.mode, 1);
    assert.equal(manager._geometry.fits, false);
    assert.equal(panel.visible, true);
    assert.equal(actors.size, 3);
    manager.destroy();
});

test('native chrome visibility updates cannot reveal an owned hidden panel', async () => {
    const {manager, panel, monitor} = await setup();
    manager.enable();
    panel.visible = true;
    panel.emit('notify::visible');
    assert.equal(panel.visible, false, 'Overview/fullscreen exit reapplies visual preference');
    monitor.inFullscreen = true;
    manager.destroy();
    assert.equal(panel.visible, false, 'disable does not expose a panel above fullscreen content');
    assert.equal(panel.signals.size, 0);
});

test('hidden panel releases its work-area strut and restores original chrome on disable', async () => {
    const {manager, panel, monitor, layout, uiGroup} = await setup();
    const original = {...layout._trackedActors[0]};
    panel.visible = false;
    assert.equal(layout.workAreaTop(), monitor.y + 28, 'hiding alone retains the old top inset');
    panel.visible = true;
    manager.enable();
    assert.equal(layout.workAreaTop(), monitor.y, 'maximized windows regain the full vertical area');
    assert.equal(panel.get_parent(), uiGroup, 'native menu hierarchy remains alive');
    for (let i = 0; i < 5; i++) manager.updateLayout();
    assert.equal(layout._trackedActors.length, 0);
    manager.destroy();
    assert.equal(layout.workAreaTop(), monitor.y + 28);
    assert.deepEqual(layout._trackedActors, [original]);
    assert.equal(panel.visible, true);
});

test('top bar preference restores chrome immediately and preserves nonstandard chrome flags', async () => {
    const {manager, extension, layout, panel} = await setup();
    layout._trackedActors[0].trackFullscreen = false;
    manager.enable();
    assert.equal(layout._trackedActors.length, 0);
    extension.system_dock_hide_topbar = false;
    manager.onSettingsChanged('system-dock-hide-topbar', false);
    assert.equal(layout._trackedActors.length, 1);
    assert.equal(layout._trackedActors[0].trackFullscreen, false);
    assert.equal(panel.visible, true);
    extension.system_dock_hide_topbar = true;
    manager.onSettingsChanged('system-dock-hide-topbar', true);
    assert.equal(layout._trackedActors.length, 0);
    manager.destroy();
    assert.equal(layout._trackedActors.length, 1);
});

test('enabling over a fullscreen window does not permanently hide the native panel on disable', async () => {
    const {manager, panel, monitor, layout} = await setup();
    monitor.inFullscreen = true;
    panel.visible = false;
    manager.enable();
    assert.equal(layout._trackedActors.length, 0);
    monitor.inFullscreen = false;
    manager.destroy();
    assert.equal(panel.visible, true);
    assert.equal(layout._trackedActors[0].trackFullscreen, true);
});

test('Just Perfection can take panel ownership and keeps its hidden state after disable', async () => {
    const {manager, extensionManager, panel} = await setup();
    const settings = new Actor();
    let panelEnabled = true;
    settings.get_boolean = () => panelEnabled;
    extensionManager.lookup = () => ({state: 1, stateObj: {getSettings: () => settings}});
    manager.enable();
    assert.equal(panel.visible, false);
    panelEnabled = false;
    settings.emit('changed::panel');
    manager.destroy();
    assert.equal(panel.visible, false);
    assert.equal(settings.signals.size, 0);
});

test('a monitor shrink restores the panel and recovers the same pods when space returns', async () => {
    const {manager, extension, monitor, actors, panel} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    const quick = manager.quickSettingsPod;
    monitor.height = 250;
    manager.updateLayout();
    assert.equal(manager.mode, 1);
    assert.equal(extension.desktop_layout, 1);
    assert.equal(manager.quickSettingsPod, quick);
    assert.equal(quick.visible, false);
    assert.equal(manager._geometry.appDock.visible, false);
    assert.equal(panel.visible, true);
    assert.equal(actors.size, 3);
    monitor.height = 900;
    manager.updateLayout();
    assert.equal(quick.visible, true);
    assert.equal(panel.visible, false);
    manager.destroy();
});


test('all four edges retain actors and anchor system pods at opposite screen corners', async () => {
    const {manager, extension, monitor, actors, counts} = await setup();
    manager.enable();
    const pods = [manager.quickSettingsPod, manager.inputMethodPod, manager.clockPod];
    for (let i = 0; i < 24; i++) {
        const position = i % 4;
        const edge = ['top', 'bottom', 'left', 'right'][position];
        const vertical = position >= 2;
        extension.unified_edge = position;
        manager.onSettingsChanged('unified-edge', position);
        const g = manager._geometry;
        assert.equal(g.fits, true);
        assert.equal(manager.quickSettingsPod, pods[0]);
        assert.equal(manager.inputMethodPod, pods[1]);
        assert.equal(manager.clockPod, pods[2]);
        assert.equal(actors.size, 3);
        assert.equal(counts.states, 1);
        for (const item of [g.quickSettings, g.inputMethod, g.appDock, g.clock]) {
            assert.equal(item.position, edge);
            assert.ok(item.x >= monitor.x && item.x + item.width <= monitor.x + monitor.width);
            assert.ok(item.y >= monitor.y && item.y + item.height <= monitor.y + monitor.height);
        }
        const axis = vertical ? 'y' : 'x', length = vertical ? 'height' : 'width';
        assert.equal(g.quickSettings[axis], monitor[axis]);
        assert.equal(g.clock[axis] + g.clock[length], monitor[axis] + monitor[length]);
        assert.equal(g.inputMethod[axis] - g.quickSettings[axis] - g.quickSettings[length], 3);
        assert.ok(g.appDock[axis] >= g.inputMethod[axis] + g.inputMethod[length] + 16);
        assert.ok(g.appDock[axis] + g.appDock[length] + 16 <= g.clock[axis]);
        assert.equal(g.quickSettings.startFlush, true);
        assert.equal(g.clock.endFlush, true);
    }
    manager.destroy();
});

test('selected monitor routes the entire group and disconnects monitor signals on disable', async () => {
    const {manager, extension, layout, monitor} = await setup();
    layout.monitors = [monitor, {...monitor, index: 1, x: 320, y: 150}];
    extension.preferred_monitor = 2;
    manager.enable();
    assert.equal(manager._geometry.monitor, layout.monitors[1]);
    assert.equal(manager.quickSettingsPod.x, 320);
    assert.equal(manager.getModularConstraints(monitor), null);
    layout.monitors.pop();
    layout.emit('monitors-changed');
    assert.equal(manager._geometry.monitor, monitor);
    manager.destroy();
    assert.equal(layout.signals.size, 0);
});
