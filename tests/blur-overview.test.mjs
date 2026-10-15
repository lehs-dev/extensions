import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup(windowActor = new Actor()) {
    class WorkspaceAnimationController {
        _prepareWorkspaceSwitch() {
            this._switchData ??= {};
            return 'prepared';
        }
        _finishWorkspaceSwitch() {
            this._switchData = null;
            return 'finished';
        }
    }
    const originalPrepare = WorkspaceAnimationController.prototype._prepareWorkspaceSwitch;
    const uiGroup = new Actor();
    const window = {get_compositor_private: () => windowActor,
        is_on_all_workspaces: () => false, get_window_type: () => 0, get_wm_class: () => 'app'};
    const workspaceManager = {get_active_workspace_index: () => 0,
        get_n_workspaces: () => 2,
        get_workspace_by_index: index => index === 1 ? {list_windows: () => [window]} : null};
    const Main = {uiGroup, layoutManager: {overviewGroup: new Actor(), monitors: [], primaryIndex: 0}};
    const {OverviewBlur} = await loadModule('blur-my-shell@aunetx/components/overview.js', {
        globals: {global: {workspace_manager: workspaceManager, window_group: new Actor()}},
        mocks: {
            'gi://Meta': {default: {BackgroundGroup: Actor, WindowType: {DESKTOP: 1},
                prefs_get_workspaces_only_on_primary: () => false}},
            'resource:///org/gnome/shell/ui/main.js': Main,
            'resource:///org/gnome/shell/ui/workspaceAnimation.js': {WorkspaceAnimationController},
            '../conveniences/pipeline.js': {Pipeline: class {}},
        },
    });
    const blur = new OverviewBlur({disconnect_all_for() {}, disconnect_all() {}, connect() {}},
        {overview: {STYLE_COMPONENTS: 0}, applications: {BLUR: true}}, {});
    blur.update_backgrounds = () => {};
    blur.enable();
    return {blur, uiGroup, WorkspaceAnimationController, originalPrepare,
        controller: new WorkspaceAnimationController()};
}

test('repeated workspace preparation is idempotent and preserves native return values', async () => {
    const {blur, controller, uiGroup} = await setup();
    assert.equal(controller._prepareWorkspaceSwitch(), 'prepared');
    assert.equal(controller._prepareWorkspaceSwitch(), 'prepared');
    assert.equal(uiGroup.children.length, 1);
    assert.equal(controller._finishWorkspaceSwitch(), 'finished');
    assert.equal(uiGroup.children.length, 0);
    blur.disable();
});

test('a window losing its compositor actor during the switch is safe', async () => {
    const {blur, controller} = await setup(null);
    controller._prepareWorkspaceSwitch();
    controller._finishWorkspaceSwitch();
    blur.disable();
});

test('disable during a switch detaches the background and restores the original methods', async () => {
    const {blur, controller, uiGroup, originalPrepare} = await setup();
    controller._prepareWorkspaceSwitch();
    blur.disable();
    assert.equal(uiGroup.children.length, 0);
    assert.equal(controller._prepareWorkspaceSwitch, originalPrepare);
    controller._finishWorkspaceSwitch();
    controller._prepareWorkspaceSwitch();
    assert.equal(uiGroup.children.length, 0);
});

test('disable preserves another wrapper; a retained blur wrapper stays inert', async () => {
    const {blur, controller, uiGroup, WorkspaceAnimationController} = await setup();
    const installed = controller._prepareWorkspaceSwitch;
    const otherWrapper = function (...args) { return installed.apply(this, args); };
    WorkspaceAnimationController.prototype._prepareWorkspaceSwitch = otherWrapper;
    blur.disable();
    assert.equal(controller._prepareWorkspaceSwitch, otherWrapper);
    assert.equal(controller._prepareWorkspaceSwitch(), 'prepared');
    assert.equal(uiGroup.children.length, 0);
    controller._finishWorkspaceSwitch();
    blur.enable();
    controller._prepareWorkspaceSwitch();
    assert.equal(uiGroup.children.length, 1);
    controller._finishWorkspaceSwitch();
    blur.disable();
});
