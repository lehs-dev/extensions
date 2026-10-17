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

async function setupBackgrounds() {
    class OverviewGroup extends Actor {
        insert_child_at_index(actor, index) {
            assert.equal(actor.get_parent(), null);
            this.children.splice(index, 0, actor);
            actor.parent = this;
            this.emit('child-added', actor);
        }
    }
    const overviewGroup = new OverviewGroup();
    const layoutManager = {overviewGroup, monitors: [{x: 0, y: 0, width: 1920, height: 1080}]};
    const widgets = [];
    const managers = [];
    const connections = {
        records: new Map(),
        connect(actor, signal, callback) {
            const id = actor.connect(signal, callback);
            const ids = this.records.get(actor) ?? [];
            ids.push(id);
            this.records.set(actor, ids);
        },
        disconnect_all_for(actor) {
            for (const id of this.records.get(actor) ?? [])
                actor.disconnect(id);
            this.records.delete(actor);
        },
    };
    class Pipeline {
        create_background_with_effects(_index, list, group) {
            this.actor = new Actor();
            widgets.push(this.actor);
            group.add_child(this.actor);
            const wallpaper = new Actor();
            this.actor.add_child(wallpaper);
            // Native BackgroundManager keeps the previous wallpaper in the
            // container while it fades, but destroy() releases only the
            // current and pending wallpaper actors.
            this.actor.fadingWallpaper = new Actor();
            this.actor.fadingWallpaper.ease({opacity: 0, duration: 1000});
            this.actor.add_child(this.actor.fadingWallpaper);
            const manager = {_bms_pipeline: this, destroyCount: 0, destroy() {
                this.destroyCount++;
                wallpaper.destroy();
            }};
            managers.push(manager);
            list.push(manager);
        }
        destroy() { this.actor = null; }
    }
    const {OverviewBlur} = await loadModule('blur-my-shell@aunetx/components/overview.js', {
        globals: {global: {blur_my_shell: {_pipelines_manager: {}}}},
        mocks: {
            'gi://Meta': {default: {BackgroundGroup: Actor}},
            'resource:///org/gnome/shell/ui/main.js': {layoutManager},
            'resource:///org/gnome/shell/ui/workspaceAnimation.js': {WorkspaceAnimationController: class {}},
            '../conveniences/pipeline.js': {Pipeline},
        },
    });
    const blur = new OverviewBlur(connections, {overview: {PIPELINE: 'test'}}, {});
    return {blur, overviewGroup, widgets, managers, connections};
}

test('background rebuild and cleanup destroy every owned wallpaper widget and manager', async () => {
    const {blur, overviewGroup, widgets, managers, connections} = await setupBackgrounds();
    for (let cycle = 0; cycle < 4; cycle++) {
        blur.update_backgrounds();
        assert.equal(blur.overview_background_group.children.length, 1);
        assert.equal(blur.animation_background_group.children.length, 1);
        assert.equal(overviewGroup.signals.size, 1, 'only the current stacking handler stays connected');
        for (const widget of widgets.slice(0, -2))
            assert.equal(widget.destroyed, true, 'previous wrapper widgets must be explicitly destroyed');
    }
    blur.remove_background_actors();
    blur.remove_background_actors();
    assert.equal(connections.records.size, 0);
    assert.equal(overviewGroup.children.length, 0);
    for (const widget of widgets)
        assert.equal(widget.destroyed, true);
    for (const widget of widgets) {
        assert.equal(widget.fadingWallpaper.destroyed, true);
        assert.equal(widget.fadingWallpaper.transitions.size, 0);
    }
    for (const manager of managers)
        assert.equal(manager.destroyCount, 1);
    assert.equal(blur.overview_background_group.children.length, 0);
    assert.equal(blur.animation_background_group.children.length, 0);
});

test('new overview chrome reorders the wallpaper without unparenting during a swipe', async () => {
    const {blur, overviewGroup} = await setupBackgrounds();
    blur.update_backgrounds();
    let removals = 0;
    const removeChild = overviewGroup.remove_child.bind(overviewGroup);
    overviewGroup.remove_child = actor => { removals++; removeChild(actor); };
    let additions = 0;
    overviewGroup.connect('child-added', () => additions++);
    const chrome = new Actor();
    overviewGroup.insert_child_at_index(chrome, 0);
    assert.equal(overviewGroup.children[0], blur.overview_background_group);
    assert.equal(removals, 0, 'the mapped wallpaper stays attached to the overview');
    assert.equal(additions, 1, 'restacking must not emit another child-added signal');
    blur.remove_background_actors();
});
