import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup(mode = 2) {
    const sources = new Map();
    let nextSource = 1;
    const GLib = {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
        timeout_add(_priority, _duration, callback) {
            const id = nextSource++;
            sources.set(id, callback);
            return id;
        },
        Source: {remove(id) {
            assert.ok(sources.delete(id), `Removing unknown source ${id}`);
        }},
    };
    const switchCalls = [];
    const workspaceAnimation = {movingWindow: null, animateSwitch(...args) {
        switchCalls.push({receiver: this, args});
        return 'native-switch-result';
    }};
    const originalSwitch = workspaceAnimation.animateSwitch;
    const idleMonitor = {
        add_idle_watch: () => 1,
        remove_watch() {},
    };
    const display = {
        focus_window: null,
        remove_keybinding: () => false,
        connectObject() {}, disconnectObject() {},
        get_monitor_geometry: () => ({x: 0, y: 0, width: 1920, height: 1080}),
    };
    const windowGroup = new Actor();
    const workspace = {index: () => 1};
    const global = {
        display, window_group: windowGroup,
        backend: {get_core_idle_monitor: () => idleMonitor},
        get_window_actors: () => [],
        workspace_manager: {get_workspace_by_index: () => workspace},
    };
    const {default: FocusHintManager} = await loadModule(
        'tiling-assistant@leleat-on-github/src/extension/focusHint.js', {
            globals: {global},
            mocks: {
                '../dependencies/gi.js': {
                    Clutter: {Actor, Clone: Actor, AnimationMode: {EASE_OUT_CUBIC: 1}},
                    Gio: {}, GLib, Meta: {WindowType: {NORMAL: 0, DIALOG: 1, MODAL_DIALOG: 2}},
                    Shell: {}, St: {Widget: Actor},
                },
                '../dependencies/shell.js': {
                    AppFavorites: {}, Main: {wm: {_workspaceAnimation: workspaceAnimation}},
                    OsdWindow: {}, SwitcherPopup: {SwitcherPopup: class {_finish() {}}},
                },
                '../dependencies/unexported/altTab.js': {getWindows: () => []},
                '../common.js': {
                    FocusHint: {ANIMATED_OUTLINE: 1, ANIMATED_UPSCALE: 2, STATIC_OUTLINE: 3},
                    FocusHintOutlineStyle: {SOLID_BG: 0},
                    Settings: {
                        getString: () => '#ffffff', getInt: key => key === 'focus-hint' ? mode : 4,
                        changed: () => 1, disconnect() {},
                        getGioObject: () => ({connectObject() {}, disconnectObject() {}}),
                    },
                },
            },
        });
    const manager = new FocusHintManager();
    const actor = new Actor();
    windowGroup.add_child(actor);
    const window = {
        get_compositor_private: () => actor, get_window_type: () => 0,
        is_fullscreen: () => false, get_monitor: () => 0,
        get_frame_rect: () => ({x: 100, y: 100, width: 800, height: 600}),
    };
    return {manager, createManager: () => new FocusHintManager(), workspaceAnimation,
        originalSwitch, switchCalls, sources, window};
}

test('rapid workspace switches keep one hint callback and disable cancels it', async () => {
    const {manager, workspaceAnimation, originalSwitch, sources} = await setup();
    for (let i = 0; i < 100; i++)
        workspaceAnimation.animateSwitch(0, 1, 0, () => {});
    assert.equal(sources.size, 1, 'Only the newest destination may display a hint');
    manager.destroy();
    assert.equal(sources.size, 0, 'Disable leaves no callback into the destroyed hint');
    assert.equal(workspaceAnimation.animateSwitch, originalSwitch);
});

test('moving a window cancels the previous workspace hint callback', async () => {
    const {manager, workspaceAnimation, sources} = await setup();
    workspaceAnimation.animateSwitch(0, 1, 0, () => {});
    workspaceAnimation.movingWindow = {};
    workspaceAnimation.animateSwitch(1, 2, 0, () => {});
    assert.equal(sources.size, 0);
    manager.destroy();
});

test('workspace wrappers retained by another extension stay passive across disable and re-enable', async () => {
    const {manager, createManager, workspaceAnimation, switchCalls, sources} = await setup();
    const hintWrapper = workspaceAnimation.animateSwitch;
    const laterWrapper = function (...args) { return hintWrapper.apply(this, args); };
    workspaceAnimation.animateSwitch = laterWrapper;
    workspaceAnimation.animateSwitch(0, 1, 0, () => {});
    manager.destroy();
    assert.equal(workspaceAnimation.animateSwitch, laterWrapper, 'Leave the later extension installed');
    assert.equal(workspaceAnimation.animateSwitch(1, 2, 0, () => {}), 'native-switch-result');
    assert.equal(sources.size, 0, 'A retained disabled wrapper cannot schedule focus hints');

    const second = createManager();
    assert.equal(workspaceAnimation.animateSwitch(2, 3, 0, () => {}), 'native-switch-result');
    assert.equal(sources.size, 1, 'Only the new hint generation handles the switch');
    assert.equal(switchCalls.length, 3);
    assert.equal(switchCalls.at(-1).receiver, workspaceAnimation);
    second.destroy();
    assert.equal(workspaceAnimation.animateSwitch, laterWrapper);
    assert.equal(sources.size, 0);
});

test('static hints disable without a timer and cancel interrupted animation timers', async () => {
    const first = await setup(3);
    first.manager.destroy();
    assert.equal(first.sources.size, 0);

    const {manager, workspaceAnimation, sources, window} = await setup(3);
    workspaceAnimation._switchData = {monitors: []};
    for (let i = 0; i < 100; i++)
        manager._hint.indicate(window);
    assert.equal(sources.size, 1, 'An interrupted hint does not retain the old reset timer');
    manager._hint.resetAnimation();
    assert.equal(sources.size, 0);
    manager.destroy();
});
