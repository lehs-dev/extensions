import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

async function setup() {
    const monitor = {index: 0, x: -1440, y: -80, width: 1440, height: 900, geometry_scale: 1.5};
    const panel = new Actor({visible: true, translation_y: 7});
    const uiGroup = new Actor();
    uiGroup.add_child(panel);
    const layout = new Actor({primaryIndex: 0, primaryMonitor: monitor, panelBox: panel, uiGroup});
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
        './systemDock/modularPods.js': {QuickSettingsPod: Quick, ClockPod: Clock},
        './systemDock/systemDock.js': {SystemDock: Rail},
    }});
    const manager = new DesktopLayoutManager({extension});
    extension.desktopLayoutManager = manager;
    return {manager, extension, monitor, panel, actors, counts, control, layout, uiGroup, extensionManager};
}

test('mode transitions keep one provider/menu owner and preserve application dock identity', async () => {
    const env = await setup();
    const {manager, extension, actors, counts, panel} = env;
    const appDock = extension.docks[0];
    manager.enable();
    assert.equal(actors.size, 1);
    for (let i = 0; i < 30; i++) {
        extension.desktop_layout = i % 2 ? 0 : 1;
        manager.onSettingsChanged('desktop-layout', extension.desktop_layout);
        assert.equal(actors.size, extension.desktop_layout === 1 ? 2 : 1);
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
    const oldRail = manager.systemDock;
    control.fail = 'Clock';
    extension.desktop_layout = 1;
    manager.onSettingsChanged('desktop-layout', 1);
    assert.equal(manager.mode, 0);
    assert.equal(manager.systemDock, oldRail);
    assert.equal(oldRail.destroyed, undefined);
    assert.equal(actors.size, 1);
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

test('pod geometry uses frame inset once and leaves monitor scale to St/Cairo', async () => {
    const {manager, extension, monitor} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    assert.equal(manager.quickSettingsPod.x, monitor.x);
    assert.equal(manager.quickSettingsPod.y, monitor.y + 6 + 12);
    assert.equal(manager.quickSettingsPod.width, 44);
    assert.equal(manager.clockPod.y + manager.clockPod.height, monitor.y + monitor.height - 18);
    const bounds = manager.getModularConstraints(monitor);
    assert.equal(bounds.topBoundary, manager.quickSettingsPod.y + manager.quickSettingsPod.height + 16);
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
    assert.equal(actors.size, 1);
    assert.equal(panel.visible, true);
    const bounds = manager.getModularConstraints(envMonitor(manager));
    assert.ok(bounds.availableHeight > 0);
    manager.destroy();
});
function envMonitor(manager) { return manager._geometry.monitor; }

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

test('impossible pod placement fails before replacing the working rail', async () => {
    const {manager, extension, monitor, actors} = await setup();
    manager.enable();
    monitor.height = 200;
    extension.desktop_layout = 1;
    manager.onSettingsChanged('desktop-layout', 1);
    assert.equal(manager.mode, 0);
    assert.equal(actors.size, 1);
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

test('a monitor shrink recovers to Dual Edge with working controls instead of retaining overlapping pods', async () => {
    const {manager, extension, monitor, actors} = await setup();
    extension.desktop_layout = 1;
    manager.enable();
    monitor.height = 250;
    manager.updateLayout();
    assert.equal(manager.mode, 0);
    assert.equal(extension.desktop_layout, 0);
    assert.equal(manager.quickSettingsPod, null);
    assert.equal(manager.clockPod, null);
    assert.equal(actors.size, 1);
    manager.destroy();
});
