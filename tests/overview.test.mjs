import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

const root = 'static-workspace-background@custom';

class ActorBox {
    constructor({x1 = 0, y1 = 0, x2 = 0, y2 = 0} = {}) {
        Object.assign(this, {x1, y1, x2, y2});
    }
    get_width() { return this.x2 - this.x1; }
    get_height() { return this.y2 - this.y1; }
    equal(other) {
        return ['x1', 'y1', 'x2', 'y2'].every(key => this[key] === other[key]);
    }
}

class BinLayout {}

class OverviewActor extends Actor {
    set_clip(...clip) { this.clip = clip; this.has_clip = true; }
    get_clip() { return this.clip; }
    remove_clip() { this.clip = null; this.has_clip = false; }
    queue_relayout() { this.relayouts = (this.relayouts ?? 0) + 1; }
    queue_redraw() { this.redraws = (this.redraws ?? 0) + 1; }
    insert_child_below(actor, sibling) {
        this.insert_child_at_index(actor, sibling ? this.children.indexOf(sibling) : 0);
    }
    insert_child_at_index(actor, index) {
        this.add_child(actor);
        this.children.splice(this.children.indexOf(actor), 1);
        this.children.splice(index, 0, actor);
    }
    allocate(box) {
        this.allocation = box;
        Object.assign(this, {
            x: box.x1, y: box.y1, width: box.get_width(), height: box.get_height(),
        });
    }
}

const rect = actor => ({x: actor.x, y: actor.y, width: actor.width, height: actor.height});

function assertInside(inner, outer) {
    assert.ok(inner.x >= outer.x - 1e-7);
    assert.ok(inner.y >= outer.y - 1e-7);
    assert.ok(inner.x + inner.width <= outer.x + outer.width + 1e-7);
    assert.ok(inner.y + inner.height <= outer.y + outer.height + 1e-7);
    assert.ok(inner.width > 0 && inner.height > 0);
}

async function setup({entry = false, thumbnailsShouldShow = false, thumbnailCount = 3} = {}) {
    const workspaceManager = {activeIndex: 1};
    class WorkspacesViewBase extends OverviewActor {
        _dragBegin() { this._inDrag = true; }
        _dragEnd() { this._inDrag = false; }
    }
    class NativeWorkspacesView extends WorkspacesViewBase {
        constructor(monitorIndex, overviewAdjustment, fitAdjustment) {
            super({mapped: true, reactive: true});
            this._monitorIndex = monitorIndex;
            this._overviewAdjustment = overviewAdjustment;
            this._fitModeAdjustment = fitAdjustment;
            this._animating = this._gestureActive = this._inDrag = false;
            this._workspaces = [255, 181, 213].map(opacity => {
                const workspace = new OverviewActor({opacity});
                workspace.stateAdjustment = new Actor({value: 0});
                this.add_child(workspace);
                return workspace;
            });
        }
        _getFitModeForState(state) { return state === 2 ? 1 : 0; }
        _getWorkspaceModeForOverviewState(state) { return state === 1 ? 1 : 0; }
        _updateWorkspacesState() {
            const value = this._overviewAdjustment.value;
            const initial = Math.floor(value);
            const final = Math.ceil(value);
            const progress = value - initial;
            const mode = this._getWorkspaceModeForOverviewState(initial) * (1 - progress) +
                this._getWorkspaceModeForOverviewState(final) * progress;
            for (const workspace of this._workspaces)
                workspace.stateAdjustment.value = (1 - this._fitModeAdjustment.value) * mode;
        }
        _updateVisibility() {
            this._workspaces.forEach((workspace, index) => {
                workspace.visible = this._animating || this._gestureActive ||
                    this._fitModeAdjustment.value !== 0 || Math.abs(index - workspaceManager.activeIndex) <= 1;
            });
        }
        getActiveWorkspace() { return this._workspaces[workspaceManager.activeIndex]; }
    }
    const vfuncHooks = new Map();
    class InjectionManager {
        overrideMethod(prototype, name, createOverride) {
            assert.equal(name, 'vfunc_allocate');
            this.prototype = prototype;
            this.original = vfuncHooks.get(prototype);
            vfuncHooks.set(prototype, createOverride(this.original ?? prototype[name]));
        }
        clear() {
            if (this.original)
                vfuncHooks.set(this.prototype, this.original);
            else
                vfuncHooks.delete(this.prototype);
        }
    }
    class WorkspaceLayout {
        vfunc_allocate(container, box) {
            this.nativeAllocation?.(container, box);
            return 'native-workspace-allocation';
        }
        allocate(container, box) {
            // Model Clutter's virtual dispatch separately from JS assignment.
            return (vfuncHooks.get(WorkspaceLayout.prototype) ?? this.vfunc_allocate)
                .call(this, container, box);
        }
    }
    class WorkspaceBackground extends OverviewActor {
        _init(params = {}) {
            Object.assign(this, params);
            this.nativeInitializations = (this.nativeInitializations ?? 0) + 1;
            return 'native-background';
        }
    }
    class BackgroundGroup extends OverviewActor {}
    const managers = [];
    class BackgroundManager {
        constructor(params) {
            if (params.useContentSize === false)
                assert.ok(params.container.layout_manager instanceof BinLayout,
                    'wallpaper backgrounds need BinLayout to fill their monitor container');
            this.params = params;
            managers.push(this);
        }
        destroy() { this.destroyCalls = (this.destroyCalls ?? 0) + 1; }
    }
    class MonitorGroup extends OverviewActor {
        _init(monitor) {
            this._container = new OverviewActor();
            this.add_child(this._container);
            this._workspaceGroups = [0, 1].map(index => {
                const group = new OverviewActor({x: index * monitor.width});
                group._background = new OverviewActor({opacity: 181});
                group.add_child(group._background);
                this._container.add_child(group);
                return group;
            });
        }
    }
    const uiGroup = new OverviewActor();
    const overviewGroup = new OverviewActor();
    const controls = new OverviewActor();
    const workspaceContainer = new OverviewActor({reactive: true});
    workspaceContainer._primaryVisible = true;
    workspaceContainer.setPrimaryWorkspaceVisible = function (visible) {
        assert.equal(this, workspaceContainer);
        if (this._primaryVisible === visible)
            return;
        this._primaryVisible = visible;
        const primary = this._getPrimaryView?.();
        if (primary)
            primary.visible = visible;
    };
    const pickerBackground = new WorkspaceBackground();
    pickerBackground._init({opacity: 173});
    const foreignBackground = new BackgroundGroup({opacity: 137});
    const thumbnailBackground = new OverviewActor({opacity: 117});
    workspaceContainer.add_child(pickerBackground);
    overviewGroup.add_child(foreignBackground);
    overviewGroup.add_child(controls);
    uiGroup.add_child(overviewGroup);

    const appDisplay = new OverviewActor();
    const thumbnailTheme = {
        spacing: 6,
        left: 0, right: 0, top: 0, bottom: 0,
        get_length(name) {
            assert.equal(name, 'spacing');
            return this.spacing;
        },
        adjust_preferred_width(minimum, natural) {
            const chrome = this.left + this.right;
            return [minimum + chrome, natural + chrome];
        },
        get_content_box(box) {
            return new ActorBox({
                x1: this.left, y1: this.top,
                x2: box.get_width() - this.right,
                y2: box.get_height() - this.bottom,
            });
        },
    };
    const thumbnails = new OverviewActor({
        _shouldShow: thumbnailsShouldShow,
        _maxThumbnailScale: 0.05,
        _thumbnails: Array.from({length: thumbnailCount}, () => new OverviewActor({collapse_fraction: 0})),
        _porthole: {width: 1920, height: 1168},
        expandFraction: thumbnailsShouldShow ? 1 : 0,
        visible: thumbnailsShouldShow,
        x_align: 'center',
        settingsShouldShow: thumbnailsShouldShow,
    });
    thumbnails.get_theme_node = () => thumbnailTheme;
    Object.defineProperty(thumbnails, 'shouldShow', {get() { return this._shouldShow; }});
    thumbnails._updateShouldShow = function () {
        this._shouldShow = this.settingsShouldShow;
    };
    thumbnails.add_child(thumbnailBackground);
    controls._appDisplay = appDisplay;
    controls._thumbnailsBox = thumbnails;
    controls._workspacesDisplay = workspaceContainer;
    controls.add_child(appDisplay);
    controls.add_child(thumbnails);
    // Native ControlsManager stacks the reactive display above AppDisplay.
    controls.add_child(workspaceContainer);
    const adjustment = new Actor({value: 0});
    controls._stateAdjustment = adjustment;
    const fitAdjustment = new Actor({value: 0});
    const primaryView = new NativeWorkspacesView(0, adjustment, fitAdjustment);
    workspaceContainer.add_child(primaryView);
    workspaceContainer._workspacesViews = [primaryView];
    workspaceContainer._getPrimaryView = () => primaryView;
    workspaceContainer.fitModeAdjustment = fitAdjustment;
    controls._getFitModeForState = state => state === 2 ? 1 : 0;
    controls._update = function () {
        const initial = Math.floor(adjustment.value);
        const final = Math.ceil(adjustment.value);
        const progress = adjustment.value - initial;
        fitAdjustment.value = this._getFitModeForState(initial) * (1 - progress) +
            this._getFitModeForState(final) * progress;
        this._updateThumbnailsBox();
        for (const display of workspaceContainer._workspacesViews) {
            const view = display._workspacesView ?? display;
            view._updateWorkspacesState();
            view._updateVisibility();
        }
    };
    controls._searchController = new Actor({searchActive: false});
    controls._getThumbnailsBoxParams = function () {
        assert.equal(this, controls);
        const progress = Math.max(0, Math.min(1, adjustment.value - 1));
        return [255 * (1 - progress), 1 - 0.5 * progress, thumbnails.height / 2 * progress];
    };
    controls._updateThumbnailsBox = function (animate = false) {
        assert.equal(this, controls, 'native thumbnail update receives its instance');
        const [opacity, scale, translationY] = this._getThumbnailsBoxParams();
        const searchActive = this._searchController.searchActive;
        const visible = thumbnails.shouldShow && !searchActive && opacity !== 0;
        if (visible) {
            thumbnails.visible = true;
            thumbnails.expandFraction = 1;
        }
        const params = {
            opacity: searchActive ? 0 : opacity,
            duration: animate ? 250 : 0,
            onComplete() {
                thumbnails.visible = visible;
                if (!visible)
                    thumbnails.expandFraction = 0;
            },
        };
        if (!searchActive) {
            params.scale_x = params.scale_y = scale;
            params.translation_y = translationY;
        }
        thumbnails.ease(params);
        if (!animate)
            thumbnails.complete();
    };
    const nativeWorkspaceBox = new ActorBox({x1: 40, y1: 60, x2: 1880, y2: 1060});
    const nativeAppBox = new ActorBox({x1: 90, y1: 200, x2: 1830, y2: 1100});
    const layout = {
        _workAreaBox: new ActorBox({x1: 0, y1: 32, x2: 1920, y2: 1200}),
        _dash: new OverviewActor({height: 72}),
        changes: 0,
        postCalls: 0,
        postCallback: null,
        layout_changed() { this.changes++; },
        allocate(...args) {
            // ControlsManagerLayout allocates thumbnails before running its
            // post-allocation callbacks. Keep both steps observable here.
            if (thumbnails.visible)
                thumbnails.allocate(new ActorBox({x1: 0, y1: 100, x2: 1920, y2: 236}));
            return this._runPostAllocation(...args);
        },
        _computeWorkspacesBoxForState() {
            assert.equal(this, layout, 'native workspace layout receives its instance');
            return nativeWorkspaceBox;
        },
        _getAppDisplayBoxForState() {
            assert.equal(this, layout, 'native app layout receives its instance');
            return nativeAppBox;
        },
        _runPostAllocation(...args) {
            assert.equal(this, layout, 'native allocation callback receives its instance');
            this.postCalls++;
            this.lastPostArgs = args;
            this.postCallback?.();
            return 'native-post-allocation';
        },
    };
    controls.layout_manager = layout;
    const overview = new OverviewActor();
    overview._overview = {controls};
    const layoutManager = new OverviewActor();
    Object.assign(layoutManager, {
        overviewGroup,
        primaryIndex: 0,
        monitors: [
            {index: 0, x: 0, y: 0, width: 1920, height: 1200},
            {index: 1, x: -1600, y: -200, width: 1600, height: 900},
        ],
    });
    Object.defineProperty(layoutManager, 'primaryMonitor', {
        get() { return this.monitors[0]; },
    });
    const Main = {uiGroup, overview, layoutManager};
    const stage = new Actor();
    const theme = {scaleFactor: 1};
    const hiddenFromPick = new Set();
    const pickChanges = [];
    // Model Clutter picking at explicit GI boundaries: last sibling wins,
    // non-reactive parents still traverse children, and opacity is ignored.
    // Shell's stop-pick handler skips the entire subtree, also in PICK_ALL.
    const pick = (actor, x, y, all = false) => {
        if (!actor.visible || actor.destroyed || hiddenFromPick.has(actor))
            return null;
        x -= actor.x;
        y -= actor.y;
        for (const child of actor.get_children().reverse()) {
            const target = pick(child, x, y, all);
            if (target)
                return target;
        }
        return (all || actor.reactive) && x >= 0 && y >= 0 && x < actor.width && y < actor.height
            ? actor : null;
    };
    const mocks = {
        'gi://Clutter': {default: {ActorBox, BinLayout}},
        'gi://Meta': {default: {BackgroundGroup}},
        'gi://Shell': {default: {
            util_set_hidden_from_pick(actor, hidden) {
                pickChanges.push([actor, hidden]);
                if (hidden)
                    hiddenFromPick.add(actor);
                else
                    hiddenFromPick.delete(actor);
            },
        }},
        'gi://St': {default: {
            Widget: OverviewActor,
            ThemeContext: {get_for_stage: current => {
                assert.equal(current, stage);
                return theme;
            }},
        }},
        'resource:///org/gnome/shell/ui/main.js': Main,
        'resource:///org/gnome/shell/ui/background.js': {BackgroundManager},
        'resource:///org/gnome/shell/ui/workspace.js': {WorkspaceBackground, WorkspaceLayout},
        'resource:///org/gnome/shell/ui/workspacesView.js': {
            WorkspacesView: NativeWorkspacesView, FitMode: {SINGLE: 0, ALL: 1},
        },
        'resource:///org/gnome/shell/ui/workspaceAnimation.js': {MonitorGroup},
        'resource:///org/gnome/shell/extensions/extension.js': {InjectionManager},
    };
    const module = await loadModule(`${root}/${entry ? 'extension' : 'overview'}.js`, {
        mocks, globals: {global: {stage}},
    });
    const subject = entry ? new module.default() : new module.MissionControlOverview();
    const originals = {
        backgroundInit: WorkspaceBackground.prototype._init,
        workspaceBox: layout._computeWorkspacesBoxForState,
        appBox: layout._getAppDisplayBoxForState,
        postAllocation: layout._runPostAllocation,
        monitorInit: MonitorGroup.prototype._init,
        updateThumbnails: controls._updateThumbnailsBox,
        thumbnailParams: controls._getThumbnailsBoxParams,
        fitMode: controls._getFitModeForState,
        viewFitMode: NativeWorkspacesView.prototype._getFitModeForState,
        workspaceMode: NativeWorkspacesView.prototype._getWorkspaceModeForOverviewState,
        workspaceState: NativeWorkspacesView.prototype._updateWorkspacesState,
        workspaceVisibility: NativeWorkspacesView.prototype._updateVisibility,
    };
    const state = value => {
        adjustment.value = value;
        controls._update();
        adjustment.emit('notify::value');
    };
    const allocate = (value, dashHeight = 72) => {
        workspaceContainer.allocate(layout._computeWorkspacesBoxForState(value, null, 0, dashHeight));
        appDisplay.allocate(layout._getAppDisplayBoxForState(value, null, 0, dashHeight));
    };
    const allocateGrid = (dashHeight = 72) => allocate(2, dashHeight);
    return {
        subject, originals, WorkspaceBackground, WorkspaceLayout, vfuncHooks, BackgroundGroup, MonitorGroup,
        managers, controls, overviewGroup, workspaceContainer, pickerBackground,
        foreignBackground, thumbnailBackground, adjustment, layout, nativeWorkspaceBox,
        nativeAppBox, overview, layoutManager, uiGroup, theme, state, appDisplay,
        thumbnails, thumbnailTheme, allocateGrid, allocate, NativeWorkspacesView, primaryView,
        workspaceManager, fitAdjustment,
        pick: (x, y, all = false) => pick(uiGroup, x, y, all), hiddenFromPick, pickChanges,
    };
}

test('Overview keeps full-monitor wallpapers fixed through desktop, picker and app grid states', async () => {
    const env = await setup();
    const {subject, managers, layoutManager, state, pickerBackground,
        foreignBackground, thumbnailBackground} = env;
    subject.enable();
    const wallpapers = managers.map(manager => manager.params.container);
    assert.equal(wallpapers.length, 2);
    for (let i = 0; i < wallpapers.length; i++) {
        const {index, ...geometry} = layoutManager.monitors[i];
        assert.deepEqual(rect(wallpapers[i]), geometry);
        assert.equal(managers[i].params.monitorIndex, index);
        assert.equal(managers[i].params.controlPosition, false);
        assert.ok(wallpapers[i].layout_manager instanceof BinLayout);
    }
    for (const value of [0, 0.5, 1, 1.5, 2, 1.5, 1, 0.5, 0]) {
        state(value);
        assert.equal(pickerBackground.opacity, 0);
        assert.equal(subject._card.visible, value > 1);
        assert.equal(subject._card.opacity, Math.round(255 * Math.max(0, value - 1)));
        assert.equal(foreignBackground.opacity, 137, 'other extensions retain their background');
        assert.equal(thumbnailBackground.opacity, 117, 'workspace thumbnails retain their wallpaper');
        for (let i = 0; i < wallpapers.length; i++) {
            const {index, ...geometry} = layoutManager.monitors[i];
            assert.deepEqual(rect(wallpapers[i]), geometry);
            assert.equal(wallpapers[i].scaleX, 1);
            assert.equal(wallpapers[i].scaleY, 1);
        }
    }
    subject.disable();
    assert.equal(pickerBackground.opacity, 173);
    assert.ok(managers.every(manager => manager.destroyCalls === 1));
});

test('existing and future workspace backgrounds restore their own opacity and tolerate destruction', async () => {
    const {subject, WorkspaceBackground, pickerBackground, workspaceContainer, state} = await setup();
    subject.enable();
    state(1.5);
    const future = new WorkspaceBackground();
    assert.equal(future._init({opacity: 94}), 'native-background');
    assert.equal(future.nativeInitializations, 1);
    workspaceContainer.add_child(future);
    assert.equal(future.opacity, 0);
    state(2);
    assert.equal(future.opacity, 0);
    state(1);
    assert.equal(future.opacity, 0);
    future.destroy();
    assert.equal(subject._backgrounds.has(future), false);
    assert.doesNotThrow(() => state(1.75));
    subject.disable();
    assert.equal(pickerBackground.opacity, 173);
    assert.equal(pickerBackground.signals.size, 0);
    const disabled = new WorkspaceBackground();
    disabled._init({opacity: 61});
    assert.equal(disabled.opacity, 61);
    assert.equal(disabled.signals.size, 0);
});

test('the card follows native app display fades and visibility during search', async () => {
    const {subject, appDisplay, state} = await setup();
    subject.enable();
    state(2);
    appDisplay.opacity = 102;
    appDisplay.emit('notify::opacity');
    assert.equal(subject._card.visible, true);
    assert.equal(subject._card.opacity, 102);
    state(1.5);
    assert.equal(subject._card.opacity, 51);
    appDisplay.visible = false;
    appDisplay.emit('notify::visible');
    assert.equal(subject._card.visible, false);
    appDisplay.visible = true;
    appDisplay.emit('notify::visible');
    assert.equal(subject._card.visible, true);
    subject.disable();
    assert.equal(appDisplay.opacity, 102, 'native app display state is never overwritten');
    assert.equal(appDisplay.signals.size, 0);
});

test('the native strip overrides hidden thumbnails and retains search fades and state animations', async () => {
    const {subject, controls, originals, state, thumbnails, layout} = await setup();
    const nativeDelegate = {acceptDrop: () => true};
    thumbnails._delegate = nativeDelegate;
    const originalParent = thumbnails.get_parent();
    subject.enable();
    assert.equal(controls._updateThumbnailsBox, originals.updateThumbnails);
    assert.equal(thumbnails.shouldShow, true, 'first-Super strip overrides Just Perfection visibility');
    state(1);
    layout.allocate();
    assert.equal(thumbnails.visible, true);
    assert.equal(thumbnails.expandFraction, 1);
    assert.equal(thumbnails.opacity, 255);
    assert.equal(subject._workspaceStrip.visible, true);
    assert.equal(subject._workspaceStrip.opacity, 255);
    assert.equal(subject._workspaceStrip.reactive, false, 'the backdrop does not intercept dragging');
    assert.equal(thumbnails.scale_x, 1);
    assert.equal(thumbnails.translation_y, 0);
    assert.equal(thumbnails._delegate, nativeDelegate, 'native drag-and-drop delegate stays attached');
    assert.equal(thumbnails.get_parent(), originalParent);
    controls._searchController.searchActive = true;
    controls._updateThumbnailsBox(true);
    assert.equal(thumbnails.visible, true, 'native fade remains visible until completion');
    assert.equal(thumbnails.transitions.get('ease').duration, 250);
    assert.equal(thumbnails.transitions.get('ease').opacity, 0);
    thumbnails.opacity = 128;
    thumbnails.emit('notify::opacity');
    assert.equal(subject._workspaceStrip.opacity, 128, 'the backdrop follows intermediate search fade frames');
    thumbnails.complete();
    thumbnails.emit('notify::visible');
    assert.equal(thumbnails.visible, false);
    assert.equal(subject._workspaceStrip.visible, false);
    controls._searchController.searchActive = false;
    controls._updateThumbnailsBox(true);
    assert.equal(thumbnails.visible, true);
    thumbnails.complete();
    state(1.5);
    assert.equal(thumbnails.opacity, 127.5);
    assert.equal(thumbnails.scale_x, 0.75);
    state(2);
    assert.equal(thumbnails.visible, false);
    assert.equal(subject._workspaceStrip.visible, false);
    state(1);
    assert.equal(thumbnails.visible, true);
    subject.disable();
    assert.equal(thumbnails.shouldShow, false);
    assert.equal(thumbnails._maxThumbnailScale, 0.05);
    assert.equal(thumbnails.visible, false);
});

test('workspace strip drops below the panel with Overview progress and reverses with a gesture', async () => {
    const {subject, state, thumbnails, layout, theme} = await setup();
    subject.enable();
    layout.allocate();
    assert.equal(subject._workspaceStrip.visible, false, 'desktop starts with no visible strip');
    for (const progress of [0.1, 0.5, 0.25, 1, 0.75, 0]) {
        state(progress);
        layout.allocate();
        const strip = subject._workspaceStrip;
        const offset = -strip.height * (1 - progress);
        assert.equal(strip.translation_y, offset);
        assert.ok(Math.abs(thumbnails.translation_y - offset) < 1e-7,
            'thumbnails and backdrop move together');
        assert.equal(strip.opacity, 255 * progress);
        if (progress < 1) {
            assert.equal(strip.y + offset + strip.get_clip()[1], 32,
                'the backdrop is revealed below the panel');
            assert.equal(thumbnails.y + offset + thumbnails.get_clip()[1], 32,
                'thumbnails do not draw over the panel');
            assert.ok(strip.get_clip()[3] >= 0);
            assert.ok(thumbnails.get_clip()[3] >= 0);
        } else {
            assert.equal(thumbnails.has_clip, false, 'native thumbnail chrome is unclipped at rest');
        }
    }
    state(0.5);
    layout.allocate();
    theme.scaleFactor = 1.5;
    layout.allocate();
    assert.equal(thumbnails.translation_y, -subject._workspaceStrip.height / 2,
        'a paused gesture retains its reveal progress across scale changes');
    subject.disable();
});

test('disabling during a reveal and search restores thumbnail clipping and native motion', async () => {
    const {subject, state, thumbnails, controls, originals, layout} = await setup();
    const originalClip = [4, 3, 500, 110];
    thumbnails.set_clip(...originalClip);
    subject.enable();
    const retainedParams = controls._getThumbnailsBoxParams;
    state(0.5);
    layout.allocate();
    assert.equal(thumbnails.get_clip()[0], originalClip[0]);
    assert.equal(thumbnails.get_clip()[2], originalClip[2]);
    assert.ok(thumbnails.get_clip()[1] > originalClip[1]);
    state(1);
    assert.deepEqual(thumbnails.get_clip(), originalClip);
    state(0.5);
    controls._searchController.searchActive = true;
    controls._updateThumbnailsBox(true);
    subject.disable();
    assert.deepEqual(thumbnails.get_clip(), originalClip);
    assert.equal(thumbnails.translation_y, 0);
    assert.equal(controls._getThumbnailsBoxParams, originals.thumbnailParams);
    subject.enable();
    assert.equal(retainedParams.call(controls)[2], 0,
        'retained wrappers stay native after re-enable');
    subject.disable();
});

test('thumbnail scale follows work-area changes and restores the latest requested visibility', async () => {
    const {subject, thumbnails, state, layout, theme} = await setup();
    const originalDescriptor = Object.getOwnPropertyDescriptor(thumbnails, '_shouldShow');
    subject.enable();
    state(1);
    layout.allocate();
    const initialScale = thumbnails._maxThumbnailScale;
    theme.scaleFactor = 1.5;
    layout.allocate();
    assert.ok(thumbnails._maxThumbnailScale > initialScale);
    assert.equal(thumbnails._maxThumbnailScale, thumbnails.height / thumbnails._porthole.height);
    thumbnails.settingsShouldShow = true;
    thumbnails._updateShouldShow();
    subject.disable();
    assert.equal(thumbnails.shouldShow, true, 'visibility writes from settings extensions survive disable');
    assert.deepEqual(Object.getOwnPropertyDescriptor(thumbnails, '_shouldShow'), {
        ...originalDescriptor, value: true,
    });
    assert.equal(thumbnails._maxThumbnailScale, 0.05);
});

test('workspace backdrop starts at half width and expands equally to both sides as workspaces are added', async () => {
    const {subject, thumbnails, thumbnailTheme, state, layout} = await setup();
    subject.enable();
    state(1);
    const count = amount => {
        thumbnails._thumbnails = Array.from({length: amount}, () => new OverviewActor({collapse_fraction: 0}));
        layout.allocate();
        const strip = rect(subject._workspaceStrip);
        assert.equal(strip.x + strip.width / 2, 960,
            'the strip stays centered instead of extending from one edge');
        assertInside(rect(thumbnails), strip);
        return strip;
    };
    const initial = count(3);
    const initialScale = thumbnails._maxThumbnailScale;
    assert.equal(initial.width, 960);
    let previous = initial;
    for (const amount of [5, 7, 12]) {
        const current = count(amount);
        assert.ok(current.width > previous.width, 'more workspaces expand the backdrop');
        assert.equal(previous.x - current.x,
            current.x + current.width - previous.x - previous.width,
            'left and right edges expand by the same distance');
        assert.ok(current.width <= 1920);
        previous = current;
    }
    assert.equal(previous.width, 1920, 'a crowded strip stops expanding at the monitor edges');
    const crowdedScale = thumbnails._maxThumbnailScale;
    assert.ok(crowdedScale < initialScale,
        'native thumbnails shrink after the backdrop reaches its width limit');
    assert.deepEqual(count(3), initial, 'removing workspaces restores the compact backdrop');
    const expanded = count(5);
    thumbnails._thumbnails.at(-1).collapse_fraction = 0.5;
    layout.allocate();
    const partlyCollapsed = rect(subject._workspaceStrip);
    thumbnails._thumbnails.at(-1).collapse_fraction = 1;
    layout.allocate();
    const fullyCollapsed = rect(subject._workspaceStrip);
    assert.ok(expanded.width > partlyCollapsed.width && partlyCollapsed.width > fullyCollapsed.width,
        'the backdrop follows native workspace removal animation instead of jumping at the end');
    for (const strip of [partlyCollapsed, fullyCollapsed])
        assert.equal(strip.x + strip.width / 2, 960);
    const unpadded = count(5);
    Object.assign(thumbnailTheme, {left: 13, right: 17, spacing: 10});
    const padded = count(5);
    assert.ok(padded.width > unpadded.width,
        'native theme spacing and horizontal chrome also reserve backdrop space');
    subject.disable();
});

test('crowded thumbnails receive one allocation and one stable native target scale during gesture reversals', async () => {
    const {subject, thumbnails, state, layout} = await setup();
    const nativeAllocate = thumbnails.allocate;
    const allocations = [];
    const targetScales = [];
    thumbnails.allocate = function (box, ...args) {
        allocations.push(box);
        // GNOME 51 ThumbnailsBox.vfunc_allocate bounds the native target scale
        // by available width and maxThumbnailScale. Twelve workspaces make
        // our inset strip narrower than the full-width native allocation.
        const target = Math.min(box.get_width() / 12 / this._porthole.width,
            this._maxThumbnailScale);
        if (target !== targetScales.at(-1))
            targetScales.push(target);
        return nativeAllocate.call(this, box, ...args);
    };
    const observedNativeAllocate = thumbnails.allocate;
    subject.enable();
    for (const progress of [0.2, 0.7, 0.35, 1, 0.6, 0.05]) {
        state(progress);
        const before = allocations.length;
        layout.allocate();
        assert.equal(allocations.length - before, 1,
            'one parent allocation must not allocate thumbnails twice');
        assert.equal(thumbnails.y, subject._getLayout().workspaces.y);
    }
    assert.equal(targetScales.length, 1,
        'unchanged geometry must not restart native thumbnail scale animation');
    subject.disable();
    assert.equal(thumbnails.allocate, observedNativeAllocate,
        'the prior allocation method is restored');
});

for (const thumbnailCount of [9, 12]) {
    test(`${thumbnailCount} native thumbnails and their selection stay inside the strip after resize and workspace changes`, async () => {
        const {subject, thumbnails, thumbnailTheme, state, layout, theme, layoutManager} =
            await setup({thumbnailCount});
        const nativeAllocate = thumbnails.allocate;
        const rendered = [];
        let indicatorBorder = 3;
        thumbnails.allocate = function (box) {
            const count = this._thumbnails.length;
            const {width: portholeWidth, height: portholeHeight} = this._porthole;
            const totalSpacing = (count - 1) * thumbnailTheme.spacing;
            const horizontalChrome = thumbnailTheme.left + thumbnailTheme.right;
            const verticalChrome = thumbnailTheme.top + thumbnailTheme.bottom;
            // Clutter applies the native CENTER alignment to the preferred
            // width before ThumbnailsBox receives its actual allocation.
            const naturalWidth = count * portholeWidth * this._maxThumbnailScale +
                totalSpacing + horizontalChrome;
            const width = Math.min(box.get_width(), naturalWidth);
            const x = box.x1 + (box.get_width() - width) / 2;
            const alignedBox = new ActorBox({
                x1: x, x2: x + width, y1: box.y1, y2: box.y2,
            });
            nativeAllocate.call(this, alignedBox);

            // GNOME 51 computes its native scale from the content allocation,
            // then rounds height before deriving width. Its extraWidth offset
            // assumes that the requested maximum scale fits the allocation.
            const content = thumbnailTheme.get_content_box(alignedBox);
            const naturalHeight = Math.round(portholeHeight * this._maxThumbnailScale) + verticalChrome;
            const availableHeight = Math.min(naturalHeight,
                portholeHeight * this._maxThumbnailScale) - verticalChrome;
            const scale = Math.min((content.get_width() - totalSpacing) / count / portholeWidth,
                availableHeight / portholeHeight);
            const thumbnailHeight = Math.round(portholeHeight * scale);
            const thumbnailWidth = Math.round(thumbnailHeight * portholeWidth / portholeHeight);
            const extraWidth = (this._maxThumbnailScale * portholeWidth - thumbnailWidth) * count;
            let childX = content.x1 + Math.round(extraWidth / 2);
            rendered.length = 0;
            for (let index = 0; index < count; index++) {
                rendered.push({
                    x: this.x + Math.round(childX), y: this.y + content.y1,
                    width: thumbnailWidth, height: thumbnailHeight,
                });
                childX += thumbnailWidth + thumbnailTheme.spacing;
            }
        };
        subject.enable();
        state(1);
        const verify = () => {
            layout.allocate();
            const strip = rect(subject._workspaceStrip);
            for (const thumbnail of rendered)
                assertInside(thumbnail, strip);
            // The active indicator can be on either end, and native chrome
            // extends beyond the selected thumbnail by its border/padding.
            for (const index of [0, rendered.length - 1]) {
                const selected = rendered[index];
                assertInside({
                    x: selected.x - indicatorBorder,
                    y: selected.y - indicatorBorder,
                    width: selected.width + 2 * indicatorBorder,
                    height: selected.height + 2 * indicatorBorder,
                }, strip);
            }
        };
        for (const [width, height, scale] of [
            [1920, 1200, 1], [1366, 768, 1], [2880, 1800, 1.5], [2400, 1500, 1.25],
        ]) {
            theme.scaleFactor = scale;
            Object.assign(layoutManager.monitors[0], {width, height});
            layout._workAreaBox = new ActorBox({x1: 0, y1: 32 * scale, x2: width, y2: height});
            thumbnails._porthole = {width, height: height - 32 * scale};
            Object.assign(thumbnailTheme, {spacing: 6 * scale, left: 8 * scale, right: 10 * scale});
            indicatorBorder = 3 * scale;
            verify();
            // Removing workspaces should let uncrowded thumbnails reach the
            // requested height again, without retaining the crowded scale.
            const crowded = thumbnails._thumbnails;
            thumbnails._thumbnails = crowded.slice(0, 3);
            verify();
            assert.equal(thumbnails._maxThumbnailScale,
                subject._getLayout().workspaces.height / thumbnails._porthole.height);
            thumbnails._thumbnails = [...crowded, new OverviewActor({collapse_fraction: 0})];
            verify();
            thumbnails._thumbnails = crowded;
        }
        subject.disable();
    });
}

test('thumbnail allocation uses the dash height from the current layout pass', async () => {
    const {subject, thumbnails, state, layout} = await setup();
    subject.enable();
    state(0.5);
    layout._workAreaBox = new ActorBox({x1: 0, y1: 32, x2: 1366, y2: 768});
    layout._dash.height = 110;
    // Workspace helpers run after thumbnail allocation in native Shell.
    layout.postCallback = () => layout._computeWorkspacesBoxForState(1, null, 0, 110);
    layout.allocate();
    assert.ok(Math.abs(thumbnails.height - subject._getLayout().workspaces.height) < 1e-7);
    assert.equal(thumbnails.y, subject._workspaceStrip.y + 8);
    subject.disable();
});

test('native post-allocation callbacks can disable during a gesture without touching released actors', async () => {
    const {subject, state, layout, originals, managers} = await setup();
    subject.enable();
    state(0.35);
    const retainedPostAllocation = layout._runPostAllocation;
    layout.postCallback = () => subject.disable();
    assert.equal(layout.allocate(), 'native-post-allocation');
    assert.equal(subject._card, null);
    assert.equal(subject._workspaceStrip, null);
    assert.equal(layout._runPostAllocation, originals.postAllocation);
    assert.ok(managers.every(manager => manager.destroyCalls === 1));
    layout.postCallback = null;
    assert.equal(retainedPostAllocation.call(layout), 'native-post-allocation');
});

test('callbacks retained by a signal emission stay inactive after disable and re-enable', async () => {
    const {subject, state, adjustment, overview} = await setup();
    // The adapter retains a handler snapshot during emission. Also retain one
    // explicitly to check that callbacks cannot outlive their enable cycle.
    const stop = adjustment.connect('notify::value', () => subject.disable());
    subject.enable();
    const retainedShowing = [...overview.signals.values()]
        .find(signal => signal.name === 'showing').callback;
    assert.doesNotThrow(() => state(0.4));
    adjustment.disconnect(stop);
    subject.enable();
    let scans = 0;
    subject._scanBackgrounds = () => scans++;
    retainedShowing();
    assert.equal(scans, 0, 'a callback from an old enable cycle remains inert');
    overview.emit('showing');
    assert.equal(scans, 1, 'the current handler still runs');
    subject.disable();
});

test('app grid hides primary workspace previews while retaining native visibility requests', async () => {
    const {subject, state, workspaceContainer} = await setup();
    const original = workspaceContainer.setPrimaryWorkspaceVisible;
    subject.enable();
    state(1);
    assert.equal(workspaceContainer._primaryVisible, true);
    state(1.5);
    assert.equal(workspaceContainer._primaryVisible, true, 'native transition keeps a usable workspace layout');
    state(2);
    assert.equal(workspaceContainer._primaryVisible, false);
    workspaceContainer.setPrimaryWorkspaceVisible(true);
    assert.equal(workspaceContainer._primaryVisible, false, 'native show request cannot expose the old app-grid strip');
    state(1);
    assert.equal(workspaceContainer._primaryVisible, true);
    workspaceContainer.setPrimaryWorkspaceVisible(false);
    state(2);
    state(1);
    assert.equal(workspaceContainer._primaryVisible, false, 'search visibility requests survive overview changes');
    workspaceContainer.setPrimaryWorkspaceVisible(true);
    state(2);
    subject.disable();
    assert.equal(workspaceContainer.setPrimaryWorkspaceVisible, original);
    assert.equal(workspaceContainer._primaryVisible, true, 'disable restores the last native visibility request');
});

test('app grid icons, folders and page controls receive pointer input above the workspace display', async () => {
    const {subject, state, allocateGrid, appDisplay, workspaceContainer, primaryView, pick} = await setup();
    subject.enable();
    state(2);
    allocateGrid();
    assert.equal(primaryView.visible, false, 'native visibility hides the primary child');
    assert.equal(workspaceContainer.reactive, true, 'native parent remains reactive');
    for (const [name, x, y] of [['app', 80, 120], ['folder', 280, 300], ['page', 600, 750]]) {
        const target = new OverviewActor({name, x, y, width: 80, height: 80, reactive: true});
        appDisplay.add_child(target);
        const events = [];
        target.connect('enter-event', () => events.push('hover'));
        target.connect('button-release-event', () => events.push('click'));
        const [screenX, screenY] = target.get_transformed_position();
        const picked = pick(screenX + 40, screenY + 40);
        assert.equal(picked, target, `${name} must receive input through the invisible workspace parent`);
        picked.emit('enter-event');
        picked.emit('button-release-event');
        assert.deepEqual(events, ['hover', 'click']);
    }
    // Native search cleanup writes reactive=true again before requesting the
    // primary workspace. It must not put the blocker back over app icons.
    workspaceContainer.reactive = false;
    workspaceContainer.setPrimaryWorkspaceVisible(false);
    workspaceContainer.reactive = true;
    workspaceContainer.setPrimaryWorkspaceVisible(true);
    const target = appDisplay.get_children()[0];
    const [x, y] = target.get_transformed_position();
    assert.equal(pick(x + 40, y + 40), target);
    subject.disable();
});

test('fading workspace descendants cannot intercept app input and gesture reversal restores window picking', async () => {
    const {subject, state, allocateGrid, appDisplay, workspaceContainer, primaryView, pick,
        NativeWorkspacesView, adjustment, fitAdjustment, overviewGroup} = await setup();
    const target = new OverviewActor({x: 80, y: 120, width: 80, height: 80, reactive: true});
    appDisplay.add_child(target);
    const secondary = new NativeWorkspacesView(1, adjustment, fitAdjustment);
    secondary.allocate(new ActorBox({x1: -1600, y1: -200, x2: 0, y2: 700}));
    overviewGroup.add_child(secondary);
    subject.enable();
    allocateGrid();
    primaryView.allocate(new ActorBox({x2: workspaceContainer.width, y2: workspaceContainer.height}));
    for (const value of [1.1, 1.5, 2, 1.7, 1.2]) {
        state(value);
        // Non-reactive parents alone do not prevent their children being
        // picked. Include DND's PICK_ALL mode, which also ignores reactive.
        workspaceContainer.reactive = false;
        const [x, y] = target.get_transformed_position();
        assert.equal(pick(x + 40, y + 40), target, `app input at overview progress ${value}`);
        assert.equal(pick(x + 40, y + 40, true), target, `drag target at overview progress ${value}`);
        assert.equal(pick(-800, 250), secondary, 'secondary monitor keeps its native input');
    }
    state(1);
    appDisplay.visible = false; // Native AppDisplay hides at the window picker.
    const [x, y] = workspaceContainer.get_transformed_position();
    assert.equal(pick(x + 400, y + 400), primaryView, 'reversing restores the workspace subtree');
    assert.equal(primaryView.visible, true);
    subject.disable();
});

test('disable and re-enable clear workspace pick suppression in partial and full app grid states', async () => {
    const {subject, state, workspaceContainer, hiddenFromPick, pickChanges} = await setup();
    subject.enable();
    state(1);
    assert.equal(pickChanges.length, 0, 'picker input needs no pick override');
    subject.disable();
    for (const value of [1.5, 2, 1.5, 2]) {
        state(value);
        subject.enable();
        assert.equal(hiddenFromPick.has(workspaceContainer), true);
        const changes = pickChanges.length;
        const redraws = workspaceContainer.redraws;
        state(value);
        assert.equal(pickChanges.length, changes, 'unchanged progress does not reconnect the native pick handler');
        subject.disable();
        assert.equal(hiddenFromPick.size, 0);
        assert.equal(workspaceContainer.redraws, redraws + 1, 'picking is invalidated after cleanup');
    }
});

test('idle Overview excludes neighboring windows and retains native swipe and drag visibility', async () => {
    const {subject, state, primaryView, workspaceManager, overview} = await setup();
    const visible = () => primaryView._workspaces.map(workspace => workspace.visible);
    // Existing native views bind these methods before the extension is enabled.
    const beginSignal = overview.connect('window-drag-begin', primaryView._dragBegin.bind(primaryView));
    const endSignal = overview.connect('window-drag-end', primaryView._dragEnd.bind(primaryView));
    subject.enable();
    state(1);
    assert.deepEqual(visible(), [false, true, false]);
    for (const flag of ['_animating', '_gestureActive']) {
        primaryView[flag] = true;
        primaryView._updateVisibility();
        assert.deepEqual(visible(), [true, true, true], 'native transitions retain their neighboring actors');
        primaryView[flag] = false;
        primaryView._updateVisibility();
        assert.deepEqual(visible(), [false, true, false]);
    }
    overview.emit('window-drag-begin');
    assert.deepEqual(visible(), [true, true, true]);
    overview.emit('window-drag-end');
    assert.deepEqual(visible(), [false, true, false]);
    workspaceManager.activeIndex = 2;
    primaryView._updateVisibility();
    assert.deepEqual(visible(), [false, false, true]);
    subject.disable();
    assert.deepEqual(visible(), [false, true, true], 'disable restores native adjacent previews immediately');
    assert.equal(Object.hasOwn(Object.getPrototypeOf(primaryView), '_dragBegin'), false);
    assert.equal(Object.hasOwn(Object.getPrototypeOf(primaryView), '_dragEnd'), false);
    overview.disconnect(beginSignal);
    overview.disconnect(endSignal);
});

test('app-grid transitions fade windows at unchanged picker positions and compose with search', async () => {
    const {subject, state, layout, primaryView, workspaceContainer, fitAdjustment} = await setup();
    const opacities = primaryView._workspaces.map(workspace => workspace.opacity);
    subject.enable();
    state(1);
    const pickerBox = layout._computeWorkspacesBoxForState(1, null, 0, 72);
    for (const value of [1.1, 1.5, 1.9, 2, 1.6, 1.2, 1]) {
        state(value);
        const gridBox = layout._computeWorkspacesBoxForState(2, null, 0, 72);
        assert.ok(gridBox.equal(pickerBox), 'the workspace allocation cannot pull windows toward the top');
        assert.equal(fitAdjustment.value, 0, 'workspaces never switch to the all-workspaces row');
        assert.equal(primaryView._getFitModeForState(2), 0);
        primaryView._workspaces.forEach((workspace, index) => {
            assert.equal(workspace.stateAdjustment.value, 1,
                'window slots remain spread instead of returning to desktop positions');
            assert.equal(workspace.opacity, Math.round(opacities[index] * (2 - value)));
        });
        // GNOME binds display opacity onto the primary view during search.
        workspaceContainer.opacity = primaryView.opacity = 102;
        workspaceContainer.emit('notify::opacity');
        primaryView.emit('notify::opacity');
        assert.equal(primaryView.opacity, 102, 'the native search binding is never overwritten');
    }
    subject.disable();
    assert.deepEqual(primaryView._workspaces.map(workspace => workspace.opacity), opacities);
    assert.equal(primaryView.opacity, 102);
});

test('enabling and disabling in app grid restores native fit, window mode and visibility', async () => {
    const {subject, state, primaryView, fitAdjustment, controls, originals} = await setup();
    state(2);
    assert.equal(fitAdjustment.value, 1);
    subject.enable();
    assert.equal(fitAdjustment.value, 0);
    assert.ok(primaryView._workspaces.every(workspace => workspace.stateAdjustment.value === 1));
    assert.ok(primaryView._workspaces.every(workspace => workspace.opacity === 0));
    subject.disable();
    assert.equal(fitAdjustment.value, 1);
    assert.ok(primaryView._workspaces.every(workspace => workspace.stateAdjustment.value === 0));
    assert.ok(primaryView._workspaces.every(workspace => workspace.visible));
    assert.equal(controls._getFitModeForState, originals.fitMode);
    assert.equal(Object.getPrototypeOf(primaryView)._getFitModeForState, originals.viewFitMode);
    assert.equal(Object.getPrototypeOf(primaryView)._getWorkspaceModeForOverviewState, originals.workspaceMode);
});

test('new and destroyed workspace actors respect a paused fade without affecting secondary monitor opacity', async () => {
    const {subject, state, primaryView, NativeWorkspacesView, adjustment, fitAdjustment} = await setup();
    subject.enable();
    state(1.5);
    const added = new OverviewActor({opacity: 94});
    added.stateAdjustment = new Actor({value: 0});
    primaryView._workspaces.push(added);
    primaryView._updateWorkspacesState();
    assert.equal(added.opacity, 47);
    assert.equal(added.stateAdjustment.value, 1);
    added.destroy();
    primaryView._workspaces.pop();
    assert.equal(subject._workspaceOpacities.has(added), false);
    const secondary = new NativeWorkspacesView(1, adjustment, fitAdjustment);
    const opacities = secondary._workspaces.map(workspace => workspace.opacity);
    secondary._updateWorkspacesState();
    assert.deepEqual(secondary._workspaces.map(workspace => workspace.opacity), opacities);
    subject.disable();
    assert.equal(subject._workspaceOpacities.size, 0);
});

test('native thumbnails occupy the first-Super strip and the app grid card contains apps alone', async () => {
    const {subject, layout, state, appDisplay, thumbnails, allocateGrid, allocate,
        workspaceContainer, nativeWorkspaceBox, nativeAppBox} = await setup();
    subject.enable();
    assert.equal(layout._computeWorkspacesBoxForState(0, null, 0, 72), nativeWorkspaceBox);
    for (const value of [0, 1])
        assert.equal(layout._getAppDisplayBoxForState(value, null, 0, 72), nativeAppBox);
    state(1);
    layout.postCallback = () => allocate(1, 96);
    layout.allocate();
    assert.equal(thumbnails.visible, true);
    assert.equal(thumbnails.opacity, 255);
    assert.equal(subject._card.visible, false);
    assert.equal(thumbnails.get_parent(), subject._controls);
    assert.equal(thumbnails.x_align, 'center');
    assertInside(rect(thumbnails), rect(subject._workspaceStrip));
    assert.equal(subject._workspaceStrip.x, 480);
    assert.equal(subject._workspaceStrip.width, 960);
    assert.ok(thumbnails.y + thumbnails.height < workspaceContainer.y);
    assert.equal(thumbnails._maxThumbnailScale, thumbnails.height / 1168);
    assert.ok(workspaceContainer.y + workspaceContainer.height <= 1200 - 96);
    state(2);
    layout.postCallback = () => allocateGrid(96);
    assert.equal(layout.allocate('allocation-token'), 'native-post-allocation');
    assert.deepEqual(layout.lastPostArgs, ['allocation-token']);
    assert.equal(layout.postCalls, 2);
    assert.equal(thumbnails.visible, false);
    assert.ok(workspaceContainer.height > 0, 'native workspace calculations retain a positive allocation');
    assert.equal(workspaceContainer._primaryVisible, false);
    assertInside(rect(appDisplay), rect(subject._card));
    assert.equal(appDisplay.y, subject._card.y + 28);
    assert.ok(subject._card.y + subject._card.height <= 1200 - 96);
    // Desktop struts can narrow the work area; the compact backdrop remains
    // centered in those coordinates with the same proportional minimum.
    layout._workAreaBox = new ActorBox({x1: 12, y1: 32, x2: 1908, y2: 1200});
    state(1);
    layout.postCallback = () => allocate(1, 96);
    layout.allocate();
    assert.equal(subject._workspaceStrip.x, 486);
    assert.equal(subject._workspaceStrip.width, 948);
    assertInside(rect(thumbnails), rect(subject._workspaceStrip));
    subject.disable();
});

test('a late Just Perfection workspace override is repaired and restored without losing its behavior', async () => {
    const {subject, layout, state, nativeWorkspaceBox} = await setup();
    subject.enable();
    const firstWrapper = layout._computeWorkspacesBoxForState;
    const jpBox = new ActorBox({x1: 50, y1: 70, x2: 1870, y2: 1030});
    let jpCalls = 0;
    const jpOverride = function () {
        assert.equal(this, layout);
        jpCalls++;
        return jpBox;
    };
    layout._computeWorkspacesBoxForState = jpOverride;
    state(2);
    layout.allocate();
    assert.notEqual(layout._computeWorkspacesBoxForState, jpOverride);
    const gridBox = layout._computeWorkspacesBoxForState(2, null, 0, 72);
    assert.ok(gridBox.get_height() > 0);
    const pickerBox = layout._computeWorkspacesBoxForState(1, null, 0, 72);
    assert.notEqual(pickerBox, jpBox);
    assert.ok(pickerBox.y1 > subject._getLayout().workspaces.y);
    assert.equal(jpCalls, 2);
    assert.equal(firstWrapper.call(layout, 2, null, 0, 72), nativeWorkspaceBox,
        'superseded wrapper is inert');
    subject.disable();
    assert.equal(layout._computeWorkspacesBoxForState, jpOverride);
});

test('disable during a transition restores state and retained wrappers stay inert after re-enable', async () => {
    const env = await setup();
    const {subject, layout, state, adjustment, originals, nativeAppBox,
        nativeWorkspaceBox, pickerBackground, WorkspaceBackground} = env;
    subject.enable();
    state(1.5);
    const retainedApp = layout._getAppDisplayBoxForState;
    const retainedWorkspace = layout._computeWorkspacesBoxForState;
    const retainedInit = WorkspaceBackground.prototype._init;
    const foreignWrapper = function (...args) { return retainedApp.apply(this, args); };
    layout._getAppDisplayBoxForState = foreignWrapper;
    const oldCard = subject._card;
    const oldStrip = subject._workspaceStrip;
    subject.disable();
    assert.equal(pickerBackground.opacity, 173);
    assert.equal(oldCard.destroyed, true);
    assert.equal(oldStrip.destroyed, true);
    assert.equal(env.thumbnails.signals.size, 0);
    assert.equal(adjustment.signals.size, 0);
    assert.equal(layout._getAppDisplayBoxForState, foreignWrapper);
    assert.equal(layout._getAppDisplayBoxForState(2), nativeAppBox);
    assert.equal(layout._computeWorkspacesBoxForState, originals.workspaceBox);
    state(2);
    assert.equal(pickerBackground.opacity, 173, 'disconnected adjustment cannot mutate backgrounds');

    subject.enable();
    assert.equal(retainedApp.call(layout, 2), nativeAppBox);
    assert.equal(retainedWorkspace.call(layout, 2), nativeWorkspaceBox);
    const untracked = new WorkspaceBackground();
    retainedInit.call(untracked, {opacity: 89});
    assert.equal(untracked.opacity, 89);
    assert.equal(subject._backgrounds.has(untracked), false);
    state(1);
    assert.equal(pickerBackground.opacity, 0);
    assert.notEqual(layout._getAppDisplayBoxForState(2), nativeAppBox,
        'the newly installed wrapper remains active');
    subject.disable();
    assert.equal(layout._getAppDisplayBoxForState, foreignWrapper);
    assert.equal(layout._getAppDisplayBoxForState(2), nativeAppBox);
});

test('monitor rebuild releases old wallpapers and creates the new monitor geometry once', async () => {
    const {subject, layoutManager, managers, overviewGroup} = await setup();
    subject.enable();
    const old = managers.slice();
    layoutManager.monitors = [{index: 0, x: -2048, y: 40, width: 2048, height: 1152}];
    layoutManager.emit('monitors-changed');
    assert.ok(old.every(manager => manager.destroyCalls === 1));
    assert.ok(old.every(manager => manager.params.container.destroyed));
    assert.equal(managers.length, 3);
    const current = managers[2].params.container;
    assert.deepEqual(rect(current), {x: -2048, y: 40, width: 2048, height: 1152});
    assert.equal(current.get_parent(), overviewGroup);
    subject.disable();
    assert.equal(managers[2].destroyCalls, 1);
    assert.ok(old.every(manager => manager.destroyCalls === 1), 'rebuild resources are not released twice');
});

test('repeated enable and disable cycles leave native methods, signals and background actors intact', async () => {
    const {subject, layout, originals, WorkspaceBackground, pickerBackground,
        adjustment, overview, layoutManager, controls, overviewGroup, managers} = await setup();
    for (let i = 0; i < 8; i++) {
        subject.enable();
        subject.enable();
        assert.equal(adjustment.signals.size, 1);
        subject.disable();
        subject.disable();
        assert.equal(layout._computeWorkspacesBoxForState, originals.workspaceBox);
        assert.equal(layout._getAppDisplayBoxForState, originals.appBox);
        assert.equal(layout._runPostAllocation, originals.postAllocation);
        assert.equal(controls._getThumbnailsBoxParams, originals.thumbnailParams);
        assert.equal(WorkspaceBackground.prototype._init, originals.backgroundInit);
        assert.equal(adjustment.signals.size, 0);
        assert.equal(overview.signals.size, 0);
        assert.equal(layoutManager.signals.size, 0);
        assert.equal(pickerBackground.signals.size, 0);
        assert.equal(pickerBackground.opacity, 173);
        assert.equal(controls.children.length, 3);
        assert.equal(overviewGroup.children.length, 2);
    }
    assert.equal(managers.length, 16);
    assert.ok(managers.every(manager => manager.destroyCalls === 1));
});

test('real extension entry combines Mission Control with the existing stationary workspace switch', async () => {
    const {subject, MonitorGroup, BackgroundGroup, originals, managers, uiGroup,
        pickerBackground, state} = await setup({entry: true});
    subject.enable();
    state(1);
    assert.equal(pickerBackground.opacity, 0);
    const group = new MonitorGroup();
    group._init({index: 0, x: 0, y: 0, width: 1920, height: 1200});
    assert.equal(managers.length, 3, 'two Overview wallpapers plus the active switch wallpaper');
    assert.equal(group.get_children()[0], managers[2].params.container);
    for (const workspace of group._workspaceGroups)
        assert.equal(workspace._background.opacity, 0);
    const foreign = new BackgroundGroup({visible: true});
    uiGroup.add_child(foreign);
    assert.equal(foreign.visible, false, 'workspace switch still hides a transient blur wallpaper');
    const container = group._container;
    container.x = -640;
    assert.equal(managers[2].params.container.x, 0, 'switch wallpaper does not follow the window group');
    subject.disable();
    assert.equal(pickerBackground.opacity, 173);
    assert.equal(foreign.visible, true);
    for (const workspace of group._workspaceGroups)
        assert.equal(workspace._background.opacity, 181);
    assert.equal(MonitorGroup.prototype._init, originals.monitorInit);
    assert.ok(managers.every(manager => manager.destroyCalls === 1));
    group.destroy();
});

test('Clutter virtual allocation fades minimized windows in place and restores native dispatch', async () => {
    const {subject, WorkspaceLayout, vfuncHooks} = await setup();
    const layout = new WorkspaceLayout();
    const preview = new OverviewActor({opacity: 127});
    preview.save_easing_state = () => {};
    preview.set_easing_duration = duration => assert.equal(duration, 0);
    preview.restore_easing_state = () => {};
    const box = new ActorBox({x2: 1920, y2: 1000});
    const nativeBox = new ActorBox({x1: 150, y1: 80, x2: 570, y2: 360});
    Object.assign(layout, {
        _overviewAdjustment: {getStateTransitionParams: () => ({currentState: 0.5})},
        _stateAdjustment: {value: 0.5},
        _windowSlotsBox: box,
        _windowSlots: [[300, 140, 420, 280, preview]],
        _windows: new Map([[preview, {metaWindow: {minimized: true}}]]),
        nativeAllocation: () => preview.allocate(nativeBox),
    });
    subject.enable();
    const retainedHook = vfuncHooks.get(WorkspaceLayout.prototype);
    assert.equal(layout.allocate(null, box), 'native-workspace-allocation');
    assert.equal(preview.x, 300, 'Clutter dispatch invokes the correction after native allocation');
    assert.equal(preview.opacity, 127, 'the native fade is unchanged');
    subject.disable();
    assert.equal(vfuncHooks.size, 0);
    layout.allocate(null, box);
    assert.equal(preview.x, 150, 'disable restores native Clutter dispatch');

    subject.enable();
    retainedHook.call(layout, null, box);
    assert.equal(preview.x, 150, 'an old hook stays inactive after re-enable');
    layout.allocate(null, box);
    assert.equal(preview.x, 300);
    subject.disable();
});
