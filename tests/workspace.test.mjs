import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setup() {
    class MonitorGroup extends Actor {
        _init() {
            this._container = new Actor();
            this.add_child(this._container);
            this._workspaceGroups = [{_background: new Actor({opacity: 187})}];
            this.progress = 0;
        }
    }
    class BackgroundGroup extends Actor {}
    const managers = [];
    class BackgroundManager {
        constructor() { managers.push(this); }
        destroy() { this.destroyed = true; }
    }
    const uiGroup = new Actor();
    const {default: Extension} = await loadModule(
        'static-workspace-background@custom/extension.js', {
            mocks: {
                './overview.js': {MissionControlOverview: class { enable() {} disable() {} }},
                'resource:///org/gnome/shell/ui/workspaceAnimation.js': {MonitorGroup},
                'resource:///org/gnome/shell/ui/background.js': {BackgroundManager},
                'resource:///org/gnome/shell/ui/main.js': {uiGroup},
                'gi://Meta': {default: {BackgroundGroup}},
                'gi://Clutter': {default: {AnimationMode: {EASE_OUT_SINE: 2}}},
            },
        });
    const extension = new Extension();
    extension.enable();
    const group = new MonitorGroup();
    group._init({index: 0}, [0, 1]);
    return {extension, group, MonitorGroup, BackgroundGroup, managers, uiGroup};
}

test('workspace settle retains native timing, easing and completion callbacks', async () => {
    const {extension, group} = await setup();
    let stopped = 0;
    let completed = 0;
    const result = group.ease_property('progress', 1, {
        duration: 180, mode: 7,
        onStopped: finished => { assert.equal(finished, true); stopped++; },
        onComplete: () => completed++,
    });
    assert.equal(result, 'native-result');
    assert.equal(group.transitions.get('progress').duration, 180);
    assert.equal(group.transitions.get('progress').mode, 7);
    group.complete('progress');
    assert.equal(stopped, 1);
    assert.equal(completed, 1);
    assert.equal(group._container.transitions.size, 0);
    extension.disable();
});

test('100 rapid reversals cancel stale callbacks and never animate child translations', async () => {
    const {extension, group} = await setup();
    let cancelled = 0;
    let completed = 0;
    for (let i = 0; i < 100; i++) {
        group.ease_property('progress', i % 2, {
            duration: 90,
            onStopped: finished => { if (!finished) cancelled++; },
            onComplete: () => completed++,
        });
        group.remove_all_transitions();
        group.progress = (i % 2) * 0.6;
        assert.equal(group._container.transitions.size, 0);
    }
    assert.equal(cancelled, 100);
    assert.equal(completed, 0);
    extension.disable();
});

test('disable during a switch restores visual state without completing the native switch early', async () => {
    const {extension, group, managers} = await setup();
    let completed = 0;
    group.ease_property('progress', 1, {duration: 180, onComplete: () => completed++});
    extension.disable();
    assert.equal(completed, 0);
    assert.equal(group._workspaceGroups[0]._background.opacity, 187);
    assert.equal(managers[0].destroyed, true);
    group.complete('progress');
    assert.equal(completed, 1);
});

test('backgrounds restore after the last monitor group is destroyed', async () => {
    const {extension, group, MonitorGroup, BackgroundGroup, uiGroup} = await setup();
    const second = new MonitorGroup();
    second._init({index: 1}, [0, 1]);
    const background = new BackgroundGroup();
    uiGroup.add_child(background);
    assert.equal(background.visible, false);
    group.destroy();
    assert.equal(background.visible, false);
    second.destroy();
    assert.equal(background.visible, true);
    extension.disable();
});
