import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setupSpaces() {
    class MonitorGroup extends Actor {
        insert_child_below(actor, sibling) {
            this.add_child(actor);
            this.children.splice(this.children.indexOf(actor), 1);
            this.children.splice(sibling ? this.children.indexOf(sibling) : 0, 0, actor);
        }

        _init(monitor, workspaceIndices, movingWindow) {
            this.monitor = monitor;
            this.workspaceIndices = workspaceIndices;
            this.movingWindow = movingWindow;
            this._container = new Actor({width: monitor.width, height: monitor.height});
            this.add_child(this._container);
            this._workspaceGroups = (workspaceIndices || [0, 1]).map(idx => {
                const group = new Actor({width: monitor.width, height: monitor.height, x: idx * monitor.width});
                group._background = new Actor({opacity: 255, width: monitor.width, height: monitor.height});
                group.add_child(group._background);
                const windowActor = new Actor({width: 600, height: 400, x: 50, y: 50});
                group.add_child(windowActor);
                group.windowActor = windowActor;
                this._container.add_child(group);
                return group;
            });
            this.progress = 0;
        }

        setProgress(p) {
            this.progress = p;
            for (let i = 0; i < this._workspaceGroups.length; i++) {
                this._workspaceGroups[i].x = (i - p) * this.monitor.width;
            }
        }
    }

    class BackgroundGroup extends Actor {}
    const managers = [];
    class BackgroundManager {
        constructor(params) {
            this.params = params;
            managers.push(this);
        }
        destroy() { this.destroyed = true; }
    }
    const uiGroup = new Actor();

    const {default: Extension} = await loadModule(
        'static-workspace-background@CleoMenezesJr.github.io/extension.js', {
            mocks: {
                'resource:///org/gnome/shell/ui/workspaceAnimation.js': {MonitorGroup},
                'resource:///org/gnome/shell/ui/background.js': {BackgroundManager},
                'resource:///org/gnome/shell/ui/main.js': {uiGroup},
                'gi://Meta': {default: {BackgroundGroup}},
                'gi://Clutter': {default: {AnimationMode: {EASE_OUT_SINE: 2}}},
            },
        });

    const extension = new Extension();
    return {extension, MonitorGroup, BackgroundGroup, BackgroundManager, managers, uiGroup};
}

test('desktop spaces keeps wallpaper fixed at (0, 0) across all swipe progress steps', async () => {
    const {extension, MonitorGroup, BackgroundGroup, managers} = await setupSpaces();
    extension.enable();

    const monitor = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
    const group = new MonitorGroup();
    group._init(monitor, [0, 1]);

    // Find the static background container (first child)
    const staticContainer = group.children[0];
    assert.ok(staticContainer instanceof BackgroundGroup, 'static wallpaper must be below window clones');
    assert.equal(managers[0].params.container, staticContainer);
    assert.notEqual(staticContainer, group._container);

    // Cloned wallpapers must be hidden
    for (const wsGroup of group._workspaceGroups) {
        assert.equal(wsGroup._background.opacity, 0);
    }

    // Swipe through intermediate progress steps: 0.0, 0.25, 0.50, 0.75, 1.00
    const steps = [0.0, 0.25, 0.5, 0.75, 1.0];
    for (const p of steps) {
        group.setProgress(p);

        // Wallpaper container must remain completely fixed
        assert.equal(staticContainer.x, 0, `static wallpaper x must be 0 at progress ${p}`);
        assert.equal(staticContainer.y, 0, `static wallpaper y must be 0 at progress ${p}`);
        assert.equal(staticContainer.translationX, 0);
        assert.equal(staticContainer.translationY, 0);

        // Workspace window containers must translate according to progress
        assert.equal(group._workspaceGroups[0].x, (0 - p) * monitor.width);
        assert.equal(group._workspaceGroups[1].x, (1 - p) * monitor.width);
    }

    group.destroy();
    extension.disable();
});

test('movingWindow across workspaces retains visibility above stationary wallpaper', async () => {
    const {extension, MonitorGroup} = await setupSpaces();
    extension.enable();

    const monitor = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
    const movingWindow = new Actor({width: 500, height: 300, opacity: 255});
    const group = new MonitorGroup();
    group._init(monitor, [0, 1], movingWindow);

    assert.equal(group.movingWindow, movingWindow);
    assert.equal(movingWindow.opacity, 255, 'moving window opacity must not be zeroed');

    group.destroy();
    extension.disable();
});

test('multi-monitor setup with negative origin assigns distinct BackgroundManagers', async () => {
    const {extension, MonitorGroup, managers} = await setupSpaces();
    extension.enable();

    const monitorPrimary = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
    const monitorSecondary = {index: 1, x: -1920, y: -200, width: 1920, height: 1080};

    const group0 = new MonitorGroup();
    group0._init(monitorPrimary, [0, 1]);

    const group1 = new MonitorGroup();
    group1._init(monitorSecondary, [0, 1]);

    assert.equal(managers.length, 2);
    assert.equal(managers[0].params.monitorIndex, 0);
    assert.equal(managers[1].params.monitorIndex, 1);
    assert.equal(managers[0].params.controlPosition, false);
    assert.equal(managers[1].params.controlPosition, false);

    // Destroying first monitor does not destroy second
    group0.destroy();
    assert.equal(managers[0].destroyed, true);
    assert.equal(managers[1].destroyed, undefined);

    group1.destroy();
    assert.equal(managers[1].destroyed, true);
    extension.disable();
});

test('child-added on uiGroup ignores non-BackgroundGroup chrome actors', async () => {
    const {extension, MonitorGroup, BackgroundGroup, uiGroup} = await setupSpaces();
    extension.enable();

    const group = new MonitorGroup();
    group._init({index: 0, width: 1920, height: 1080}, [0, 1]);

    // Spotlight backdrop or window gap strut actor (regular Actor / St.Widget)
    const chromeActor = new Actor({visible: true});
    uiGroup.add_child(chromeActor);
    assert.equal(chromeActor.visible, true, 'regular chrome actor must not be hidden');

    // blur-my-shell background group actor
    const blurBackground = new BackgroundGroup({visible: true});
    uiGroup.add_child(blurBackground);
    assert.equal(blurBackground.visible, false, 'Meta.BackgroundGroup must be hidden during transition');

    group.destroy();
    assert.equal(blurBackground.visible, true, 'Meta.BackgroundGroup restored after transition');
    extension.disable();
});

test('foreign BackgroundGroup destroyed during transition is handled gracefully', async () => {
    const {extension, MonitorGroup, BackgroundGroup, uiGroup} = await setupSpaces();
    extension.enable();

    const group = new MonitorGroup();
    group._init({index: 0, width: 1920, height: 1080}, [0, 1]);

    const foreignBg = new BackgroundGroup({visible: true});
    uiGroup.add_child(foreignBg);
    assert.equal(foreignBg.visible, false);

    // Foreign actor is destroyed before transition completes
    foreignBg.destroy();

    // Completing transition must not throw
    assert.doesNotThrow(() => group.destroy());
    extension.disable();
});

test('10 consecutive enable and disable cycles maintain prototype and signal integrity', async () => {
    const {extension, MonitorGroup} = await setupSpaces();
    const originalInit = MonitorGroup.prototype._init;

    for (let i = 0; i < 10; i++) {
        extension.enable();
        assert.notEqual(MonitorGroup.prototype._init, originalInit);
        extension.disable();
        assert.equal(MonitorGroup.prototype._init, originalInit);
    }
});

test('a retained workspace wrapper stays inert after disable and re-enable', async () => {
    const {extension, MonitorGroup} = await setupSpaces();
    extension.enable();
    const installed = MonitorGroup.prototype._init;
    const wrapper = function (...args) { return installed.apply(this, args); };
    MonitorGroup.prototype._init = wrapper;
    extension.disable();
    assert.equal(MonitorGroup.prototype._init, wrapper);
    const monitor = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
    const inactive = new MonitorGroup();
    inactive._init(monitor, [0, 1]);
    assert.equal(inactive.children.length, 1);
    assert.equal(inactive._workspaceGroups[0]._background.opacity, 255);
    inactive.destroy();

    extension.enable();
    const active = new MonitorGroup();
    active._init(monitor, [0, 1]);
    assert.equal(active.children.length, 2, 'only the current generation adds a wallpaper');
    assert.equal(active._workspaceGroups[0]._background.opacity, 0);
    active.destroy();
    extension.disable();
});

for (const spacesFirst of [true, false]) {
    test(`wallpaper and blur workspace hooks cooperate with ${spacesFirst ? 'wallpaper' : 'blur'} enabled first`, async () => {
        const {extension, MonitorGroup, BackgroundGroup, uiGroup, managers} = await setupSpaces();
        const monitor = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
        class WorkspaceAnimationController {
            _prepareWorkspaceSwitch() {
                if (!this._switchData) {
                    const group = new MonitorGroup();
                    group._init(monitor, [0, 1]);
                    this._switchData = {group};
                }
                return 'prepared';
            }
            _finishWorkspaceSwitch() {
                this._switchData?.group.destroy();
                this._switchData = null;
                return 'finished';
            }
        }
        const {OverviewBlur} = await loadModule('blur-my-shell@aunetx/components/overview.js', {
            globals: {global: {window_group: new Actor(), workspace_manager: {
                get_active_workspace_index: () => 0, get_n_workspaces: () => 2,
                get_workspace_by_index: () => null,
            }}},
            mocks: {
                'gi://Meta': {default: {BackgroundGroup, WindowType: {DESKTOP: 1},
                    prefs_get_workspaces_only_on_primary: () => false}},
                'resource:///org/gnome/shell/ui/main.js': {uiGroup,
                    layoutManager: {overviewGroup: new Actor(), monitors: [], primaryIndex: 0}},
                'resource:///org/gnome/shell/ui/workspaceAnimation.js': {WorkspaceAnimationController},
                '../conveniences/pipeline.js': {Pipeline: class {}},
            },
        });
        const blur = new OverviewBlur({disconnect_all_for() {}, disconnect_all() {}, connect() {}},
            {overview: {STYLE_COMPONENTS: 0}, applications: {BLUR: false}}, {});
        blur.update_backgrounds = () => {};
        const extensions = spacesFirst ? [extension, blur] : [blur, extension];
        extensions.forEach(item => item.enable());
        const controller = new WorkspaceAnimationController();
        assert.equal(controller._prepareWorkspaceSwitch(), 'prepared');
        assert.equal(controller._prepareWorkspaceSwitch(), 'prepared');
        assert.equal(managers.length, 1);
        assert.equal(blur.animation_background_group.get_parent(), uiGroup);
        assert.equal(blur.animation_background_group.visible, false);
        assert.equal(controller._finishWorkspaceSwitch(), 'finished');
        assert.equal(blur.animation_background_group.get_parent(), null);
        assert.equal(blur.animation_background_group.visible, true);
        assert.equal(managers[0].destroyed, true);

        controller._prepareWorkspaceSwitch();
        extensions[0].disable();
        assert.doesNotThrow(() => controller._finishWorkspaceSwitch());
        extensions[1].disable();
        assert.equal(uiGroup.children.length, 0);
        assert.equal(uiGroup.signals.size, 0);
    });
}
