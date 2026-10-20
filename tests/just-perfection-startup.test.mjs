import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

const DESKTOP = 0;
const OVERVIEW = 1;

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

async function setup({startingUp = true, ownAnimation = false, immediateHide = false} = {}) {
    const {API} = await loadModule('just-perfection-desktop@custom/lib/API.js');
    // Like ControlsLayout, every ensureAllocation call queues a fresh promise;
    // allocations resolve the whole current batch, then clear that batch.
    const controlsLayout = {
        _postAllocationCallbacks: [],
        ensureAllocation() {
            return new Promise(resolve => this._postAllocationCallbacks.push(resolve));
        },
    };
    const allocation = {resolve() {
        controlsLayout._postAllocationCallbacks.forEach(callback => callback());
        controlsLayout._postAllocationCallbacks = [];
    }};
    const animation = deferred();
    const layoutManager = new Actor({
        _startingUp: startingUp,
        overviewGroup: new Actor({visible: false}),
    });
    const sessionMode = new Actor({hasOverview: true, isGreeter: false, isLocked: false});
    let nativeStartupCalls = 0;
    let overviewGrabs = 0;

    // Mirror the GNOME 51 startup await boundaries: Overview becomes visible
    // synchronously, Controls waits for allocation, then runs its animations,
    // and Overview acquires the input grab only if it was not hidden meanwhile.
    class Overview {
        _shown = false;
        visible = false;
        shownState = 'HIDDEN';
        hideCalls = 0;
        controls = {opacity: 255, translation_y: 0, _stateAdjustment: new Actor({value: 1})};

        async runStartupAnimation() {
            nativeStartupCalls++;
            this._shown = this.visible = true;
            this.shownState = 'SHOWING';
            layoutManager.overviewGroup.show();
            this.controls.opacity = 0;
            await controlsLayout.ensureAllocation();
            this.controls.opacity = 255;
            this.controls.translation_y = -100;
            await animation.promise;
            this.controls.translation_y = 0;
            if (this.shownState !== 'SHOWING')
                return;
            overviewGrabs++;
            this.shownState = 'SHOWN';
        }

        hide() {
            this.hideCalls++;
            if (!this._shown)
                return;
            this._shown = false;
            this.shownState = 'HIDING';
            this.controls._stateAdjustment.transitions.set('value', {
                onStopped: () => this.finishHide(),
            });
            if (immediateHide)
                this.controls._stateAdjustment.remove_transition('value');
        }

        finishHide() {
            this.visible = false;
            this.shownState = 'HIDDEN';
            layoutManager.overviewGroup.hide();
        }

        show() {
            this._shown = this.visible = true;
            this.shownState = 'SHOWN';
            layoutManager.overviewGroup.show();
        }
    }
    const overview = new Overview();
    overview.controls.layout_manager = controlsLayout;
    overview._overview = {controls: overview.controls};
    if (ownAnimation)
        overview.runStartupAnimation = overview.runStartupAnimation.bind(overview);
    const originalAnimation = overview.runStartupAnimation;
    const main = {sessionMode, layoutManager, overview};
    const api = new API({Main: main, OverviewControls: {ControlsState: {HIDDEN: 0}}}, 51);
    const complete = () => {
        layoutManager._startingUp = false;
        layoutManager.emit('startup-complete');
    };
    return {api, main, allocation, animation, originalAnimation, complete,
        nativeStartupCalls: () => nativeStartupCalls,
        overviewGrabs: () => overviewGrabs};
}

test('Desktop skips native Overview startup before its first visible frame and completes layout', async () => {
    const ctx = await setup();
    const {api, main, complete, originalAnimation} = ctx;
    api.startupStatusSet(DESKTOP);
    await main.overview.runStartupAnimation();
    complete();

    assert.equal(ctx.nativeStartupCalls(), 0);
    assert.equal(main.overview.visible, false);
    assert.equal(main.sessionMode.hasOverview, true);
    assert.equal(Object.hasOwn(main.layoutManager, 'startInOverview'), false);
    assert.equal(main.overview.runStartupAnimation, originalAnimation);
    assert.equal(Object.hasOwn(main.overview, 'runStartupAnimation'), false);
    assert.equal(main.layoutManager.signals.size, 0);

    main.overview.show();
    assert.equal(main.overview.visible, true);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
});

test('Desktop reconciles startup already waiting for allocation without stranding that allocation', async () => {
    const ctx = await setup();
    const {api, main, allocation, animation, complete} = ctx;
    const nativeStartup = main.overview.runStartupAnimation();
    assert.equal(main.overview.shownState, 'SHOWING');

    api.startupStatusSet(DESKTOP);
    assert.equal(main.layoutManager.overviewGroup.opacity, 0);
    assert.equal(main.layoutManager.overviewGroup.visible, true);
    assert.equal(main.overview.hideCalls, 0);

    // An invisible group still allocates; a hidden group would never resolve
    // ControlsLayout.ensureAllocation(), blocking Shell's startup completion.
    allocation.resolve();
    await Promise.resolve();
    assert.equal(main.overview.hideCalls, 1);
    assert.equal(main.overview._shown, false);
    assert.equal(main.overview.controls.opacity, 255);
    assert.equal(main.layoutManager.overviewGroup.opacity, 0);
    main.overview.finishHide();
    animation.resolve();
    await nativeStartup;
    complete();

    assert.equal(main.overview.visible, false);
    assert.equal(ctx.overviewGrabs(), 0);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
    assert.equal(main.layoutManager.signals.size, 0);
    main.overview.show();
    assert.equal(main.layoutManager.overviewGroup.visible, true);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
});

test('Desktop also reconciles startup that has passed allocation and is animating', async () => {
    const ctx = await setup();
    const {api, main, allocation, animation, complete} = ctx;
    const nativeStartup = main.overview.runStartupAnimation();
    allocation.resolve();
    await Promise.resolve();
    assert.equal(main.overview.controls.opacity, 255);

    api.startupStatusSet(DESKTOP);
    assert.equal(main.layoutManager.overviewGroup.opacity, 0);
    await Promise.resolve();
    main.overview.finishHide();
    animation.resolve();
    await nativeStartup;
    complete();
    assert.equal(ctx.overviewGrabs(), 0);
    assert.equal(main.overview.visible, false);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
});

test('disabled animations cannot hide the group before the startup allocation finishes', async () => {
    const ctx = await setup({immediateHide: true});
    const {api, main, allocation, animation, complete} = ctx;
    const nativeStartup = main.overview.runStartupAnimation();
    api.startupStatusSet(DESKTOP);
    assert.equal(main.layoutManager.overviewGroup.visible, true);
    allocation.resolve();
    await Promise.resolve();
    assert.equal(main.layoutManager.overviewGroup.visible, false);
    animation.resolve();
    await nativeStartup;
    complete();
    assert.equal(main.layoutManager._startingUp, false);
    assert.equal(ctx.overviewGrabs(), 0);
});

test('disabling before allocation cancels the delayed hide and returns startup to Shell', async () => {
    const ctx = await setup();
    const {api, main, allocation, animation, complete} = ctx;
    const nativeStartup = main.overview.runStartupAnimation();
    api.startupStatusSet(DESKTOP);
    api.startupStatusSetDefault();
    allocation.resolve();
    await Promise.resolve();
    assert.equal(main.overview.hideCalls, 0);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
    animation.resolve();
    await nativeStartup;
    complete();
    assert.equal(ctx.overviewGrabs(), 1);
    assert.equal(main.overview.shownState, 'SHOWN');
    assert.equal(main.layoutManager.signals.size, 0);
});

test('legacy callback startup also invokes layout completion exactly once', async () => {
    const {api, main, complete} = await setup();
    api.startupStatusSet(DESKTOP);
    let completions = 0;
    await main.overview.runStartupAnimation(() => {
        completions++;
        complete();
    });
    assert.equal(completions, 1);
    assert.equal(main.layoutManager._startingUp, false);
    assert.equal(main.layoutManager.signals.size, 0);
});

test('disabling during startup restores an own method, opacity and handlers idempotently', async () => {
    const {api, main, originalAnimation} = await setup({ownAnimation: true});
    main.overview.show();
    main.layoutManager.overviewGroup.opacity = 213;
    api.startupStatusSet(DESKTOP);
    api.startupStatusSetDefault();
    api.startupStatusSetDefault();
    assert.equal(main.overview.runStartupAnimation, originalAnimation);
    assert.equal(Object.hasOwn(main.overview, 'runStartupAnimation'), true);
    assert.equal(main.layoutManager.overviewGroup.opacity, 213);
    assert.equal(main.sessionMode.hasOverview, true);
    assert.equal(main.layoutManager.signals.size, 0);

    api.startupStatusSet(DESKTOP);
    assert.equal(main.layoutManager.signals.size, 1);
    api.startupStatusSetDefault();
    assert.equal(main.layoutManager.signals.size, 0);
});

test('session lock during startup is not overwritten by startup completion or disable', async () => {
    const {api, main, complete} = await setup();
    api.startupStatusSet(DESKTOP);
    main.sessionMode.hasOverview = false;
    main.sessionMode.isLocked = true;
    complete();
    api.startupStatusSetDefault();
    assert.equal(main.sessionMode.hasOverview, false);
    assert.equal(main.sessionMode.isLocked, true);
    assert.equal(main.layoutManager.signals.size, 0);
});

test('Overview preference and settings changes after startup leave normal Overview available', async () => {
    const {api, main, originalAnimation, complete} = await setup();
    api.startupStatusSet(OVERVIEW);
    assert.equal(main.overview.runStartupAnimation, originalAnimation);
    api.startupStatusSet(DESKTOP);
    api.startupStatusSet(OVERVIEW);
    assert.equal(main.overview.runStartupAnimation, originalAnimation);
    assert.equal(main.layoutManager.signals.size, 0);
    complete();
    main.overview.show();
    api.startupStatusSet(DESKTOP);
    assert.equal(main.overview.visible, true);
    assert.equal(main.overview.hideCalls, 0);
    assert.equal(main.overview.runStartupAnimation, originalAnimation);
});

for (const mode of ['isGreeter', 'isLocked', 'hasOverview']) {
    test(`Desktop leaves the ${mode} session capability untouched`, async () => {
        const {api, main, originalAnimation} = await setup();
        main.sessionMode[mode] = mode !== 'hasOverview';
        api.startupStatusSet(DESKTOP);
        assert.equal(main.overview.runStartupAnimation, originalAnimation);
        assert.equal(main.sessionMode[mode], mode !== 'hasOverview');
        assert.equal(main.layoutManager.signals.size, 0);
    });
}

test('cleanup preserves a newer extension override of the startup method', async () => {
    const {api, main, complete} = await setup();
    api.startupStatusSet(DESKTOP);
    const newerAnimation = () => Promise.resolve();
    main.overview.runStartupAnimation = newerAnimation;
    complete();
    assert.equal(main.overview.runStartupAnimation, newerAnimation);
    assert.equal(main.layoutManager.signals.size, 0);
});

test('startup completion cannot unmask the tail of a native hide animation', async () => {
    const ctx = await setup();
    const {api, main, allocation, animation, complete} = ctx;
    const nativeStartup = main.overview.runStartupAnimation();
    allocation.resolve();
    await Promise.resolve();
    api.startupStatusSet(DESKTOP);
    assert.equal(main.overview.visible, false, 'native onStopped finishes the hide immediately');
    assert.equal(main.overview.controls._stateAdjustment.value, 0);
    animation.resolve();
    await nativeStartup;
    complete();
    assert.equal(main.overview.visible, false);
    assert.equal(main.layoutManager.overviewGroup.visible, false);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
});

test('startup completion reconciles a hide delayed by an unrelated allocation', async () => {
    const {api, main, complete} = await setup();
    main.overview.show();
    main.overview.controls.layout_manager.ensureAllocation();
    api.startupStatusSet(DESKTOP);
    assert.equal(main.overview.hideCalls, 0);
    complete();
    assert.equal(main.overview.visible, false);
    assert.equal(main.layoutManager.overviewGroup.opacity, 255);
});

test('retained startup wrappers delegate after disabling and re-enabling', async () => {
    const {api, main, allocation, animation} = await setup();
    api.startupStatusSet(DESKTOP);
    const retained = main.overview.runStartupAnimation;
    api.startupStatusSetDefault();
    api.startupStatusSet(DESKTOP);
    const nativeStartup = retained.call(main.overview);
    assert.equal(main.overview.visible, true, 'the old wrapper no longer suppresses startup');
    api.startupStatusSetDefault();
    allocation.resolve();
    animation.resolve();
    await nativeStartup;
});
