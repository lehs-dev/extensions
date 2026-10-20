import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

class ActorBox {
    constructor({x1 = 0, y1 = 0, x2 = 0, y2 = 0} = {}) {
        Object.assign(this, {x1, y1, x2, y2});
    }
    get_width() { return this.x2 - this.x1; }
    get_height() { return this.y2 - this.y1; }
    equal(other) {
        return ['x1', 'x2', 'y1', 'y2'].every(key => this[key] === other[key]);
    }
}

const {alignMinimizedWindowPreviews} = await loadModule(
    'static-workspace-background@custom/minimizedWindowPreviews.js', {
        mocks: {'gi://Clutter': {default: {ActorBox}}},
    });

class Preview extends Actor {
    constructor(params = {}) {
        super(params);
        this.allocation = new ActorBox();
        this.easingDuration = 175;
        this.allocations = 0;
    }
    allocate(box) {
        this.allocation = box;
        this.allocations++;
        this.lastAllocationDuration = this.easingDuration;
    }
    save_easing_state() { this.savedDuration = this.easingDuration; }
    set_easing_duration(duration) { this.easingDuration = duration; }
    restore_easing_state() { this.easingDuration = this.savedDuration; }
}

function setup({workarea = {x: 0, y: 32}, scale = 1} = {}) {
    const minimized = new Preview();
    const normal = new Preview();
    const metaWindow = {
        minimized: true,
        unminimize() { throw new Error('Overview must preserve minimized state'); },
        activate() { throw new Error('Overview must preserve focus'); },
    };
    const state = {currentState: 0, workspaceMode: 0};
    const slots = [[300, 140, 420, 280, minimized], [900, 280, 600, 400, normal]];
    const box = new ActorBox({x2: 1920 * scale, y2: 1000 * scale});
    const layout = {
        _overviewAdjustment: {getStateTransitionParams: () => state},
        _stateAdjustment: {get value() { return state.workspaceMode; }},
        _windowSlotsBox: new ActorBox({x2: 1920, y2: 1000}),
        _windowSlots: slots,
        _windows: new Map([
            [minimized, {metaWindow, currentTransition: null}],
            [normal, {metaWindow: {minimized: false}, currentTransition: null}],
        ]),
    };
    // Reproduce GNOME 51 WorkspaceLayout's minimized top-left interpolation
    // and its independent opacity fade, then apply the extension's correction.
    const allocate = () => {
        const progress = state.workspaceMode;
        minimized.opacity = progress * 255;
        const [x, y, width, height] = slots[0];
        const sourceWidth = state.currentState <= 1 ? width : 0;
        const sourceHeight = state.currentState <= 1 ? height : 0;
        const left = (workarea.x * (1 - progress) + x * progress) * scale;
        const top = (workarea.y * (1 - progress) + y * progress) * scale;
        minimized.allocate(new ActorBox({
            x1: left, y1: top,
            x2: left + (sourceWidth * (1 - progress) + width * progress) * scale,
            y2: top + (sourceHeight * (1 - progress) + height * progress) * scale,
        }));
        normal.allocate(new ActorBox({x1: 130, y1: 70, x2: 800, y2: 700}));
        const normalAllocation = normal.allocation;
        alignMinimizedWindowPreviews(layout, box);
        assert.equal(normal.allocation, normalAllocation,
            'normal windows keep their native travel animation');
    };
    return {layout, state, box, minimized, normal, metaWindow, allocate};
}

test('minimized previews fade at their final slot when entering and leaving Overview', () => {
    const {state, minimized, metaWindow, allocate} = setup();
    for (const progress of [0, 0.01, 0.25, 0.75, 1, 0.75, 0.25, 0.01, 0]) {
        state.currentState = state.workspaceMode = progress;
        allocate();
        assert.ok(minimized.allocation.equal(new ActorBox({
            x1: 300, y1: 140, x2: 720, y2: 420,
        })), 'previews have no trajectory from the top-left corner');
        assert.equal(minimized.opacity, progress * 255, 'native opacity fade is retained');
        assert.equal(metaWindow.minimized, true);
        assert.equal(minimized.easingDuration, 175, 'native easing state is restored');
    }
});

test('negative monitor origins and frozen slots scale to the current allocation', () => {
    for (const scale of [0.5, 1.25, 2]) {
        const {state, minimized, allocate} = setup({
            workarea: {x: -1600, y: -168}, scale,
        });
        state.currentState = state.workspaceMode = 0.4;
        allocate();
        assert.ok(minimized.allocation.equal(new ActorBox({
            x1: 300 * scale, y1: 140 * scale,
            x2: 720 * scale, y2: 420 * scale,
        })));
    }
});

test('app-grid workspace transitions keep their native minimized-window allocation', () => {
    const {layout, state, box, minimized, allocate} = setup();
    for (const progress of [1.01, 1.5, 2]) {
        state.currentState = progress;
        state.workspaceMode = 2 - progress;
        allocate();
        const nativeBox = minimized.allocation;
        alignMinimizedWindowPreviews(layout, box);
        assert.equal(minimized.allocation, nativeBox);
    }
});

test('hidden, removed and unminimized previews are left to native allocation', () => {
    const {layout, state, minimized, metaWindow, allocate} = setup();
    state.currentState = state.workspaceMode = 0.5;
    minimized.visible = false;
    allocate();
    assert.equal(minimized.allocation.x1, 150);
    minimized.visible = true;
    metaWindow.minimized = false;
    allocate();
    assert.equal(minimized.allocation.x1, 150);
    layout._windows.delete(minimized);
    allocate();
    assert.equal(minimized.allocation.x1, 150);
});

test('an interrupted native layout transition cannot move a fading minimized preview', () => {
    const {layout, state, minimized, allocate} = setup();
    const info = layout._windows.get(minimized);
    info.currentTransition = {};
    minimized.transitions.set('allocation', {onStopped: () => { info.currentTransition = null; }});
    state.currentState = state.workspaceMode = 0.8;
    allocate();
    assert.equal(info.currentTransition, null);
    assert.equal(minimized.transitions.has('allocation'), false);
    assert.equal(minimized.lastAllocationDuration, 0);
    assert.equal(minimized.allocation.x1, 300);
});

test('fully open Overview retains native minimized-window layout animations', () => {
    const {layout, state, box, minimized} = setup();
    state.currentState = state.workspaceMode = 1;
    const info = layout._windows.get(minimized);
    info.currentTransition = {};
    minimized.transitions.set('allocation', {onStopped: () => { info.currentTransition = null; }});
    const reshufflingBox = new ActorBox({x1: 220, y1: 170, x2: 640, y2: 450});
    minimized.allocate(reshufflingBox);
    alignMinimizedWindowPreviews(layout, box);
    assert.equal(minimized.allocation, reshufflingBox);
    assert.notEqual(info.currentTransition, null);
    assert.equal(minimized.transitions.has('allocation'), true);
});

test('unchanged or empty allocations do not start redundant allocations', () => {
    const {layout, state, box, minimized, allocate} = setup();
    state.currentState = state.workspaceMode = 1;
    allocate();
    const allocations = minimized.allocations;
    state.currentState = state.workspaceMode = 0.5;
    alignMinimizedWindowPreviews(layout, box);
    assert.equal(minimized.allocations, allocations);
    layout._windowSlotsBox = new ActorBox();
    assert.doesNotThrow(() => alignMinimizedWindowPreviews(layout, box));
    assert.equal(minimized.allocations, allocations);
});
