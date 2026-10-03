import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function environment() {
    const calls = [];
    const signals = new Map();
    let nextId = 1;
    const shellwm = {
        completed_minimize(actor) {
            assert.equal(this, shellwm);
            calls.push(['minimize', actor]);
        },
        completed_unminimize(actor) {
            assert.equal(this, shellwm);
            calls.push(['unminimize', actor]);
        },
    };
    const wm = {
        _shellwm: shellwm,
        _shouldAnimateActor(actor, types) {
            assert.equal(this, wm);
            calls.push(['should', actor, types]);
            return true;
        },
    };
    const originals = [wm._shouldAnimateActor, shellwm.completed_minimize, shellwm.completed_unminimize];
    const context = vm.createContext({
        Main: {wm, overview: {visible: false}},
        global: {
            window_manager: {
                connect(signal, callback) {
                    const id = nextId++;
                    signals.set(id, {signal, callback});
                    return id;
                },
                disconnect(id) { assert.ok(signals.delete(id)); },
            },
            get_window_actors: () => [],
        },
        Extension: class {getSettings() {return {}; }},
        SettingsData: class {},
        GObject: {registerClass() {}},
        Clutter: {DeformEffect: class {}},
    });
    const code = readFileSync(new URL('../compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', import.meta.url), 'utf8')
        .replace(/^import .*;\s*$/gm, '')
        .replace('export default class ', 'class ');
    const ExtensionClass = vm.runInContext(`${code}\n;CompizMagicLampEffectExtension`, context);
    return {extension: new ExtensionClass(), wm, shellwm, originals, calls, signals};
}

test('retained Magic Lamp hooks forward to their original functions after disable', () => {
    const env = environment();
    env.extension.enable();
    const hooks = [env.wm._shouldAnimateActor, env.shellwm.completed_minimize, env.shellwm.completed_unminimize];
    env.extension.disable();
    assert.deepEqual([env.wm._shouldAnimateActor, env.shellwm.completed_minimize, env.shellwm.completed_unminimize], env.originals);
    const actor = {};
    function _minimizeWindow() {return hooks[0].call(env.wm, actor, 7); }
    assert.equal(_minimizeWindow(), true);
    hooks[1].call(env.shellwm, actor);
    hooks[2].call(env.shellwm, actor);
    assert.deepEqual(env.calls, [['should', actor, 7], ['minimize', actor], ['unminimize', actor]]);
    assert.equal(env.signals.size, 0);
});

test('disabling Magic Lamp preserves later wrappers and their completion chain', () => {
    const env = environment();
    env.extension.enable();
    const own = [env.wm._shouldAnimateActor, env.shellwm.completed_minimize, env.shellwm.completed_unminimize];
    let outerCalls = 0;
    const wrappers = own.map(original => function (...args) {
        outerCalls++;
        return original.apply(this, args);
    });
    [env.wm._shouldAnimateActor, env.shellwm.completed_minimize, env.shellwm.completed_unminimize] = wrappers;
    env.extension.disable();
    assert.deepEqual([env.wm._shouldAnimateActor, env.shellwm.completed_minimize, env.shellwm.completed_unminimize], wrappers);
    const actor = {};
    assert.equal(env.wm._shouldAnimateActor(actor, 3), true);
    env.shellwm.completed_minimize(actor);
    env.shellwm.completed_unminimize(actor);
    assert.equal(outerCalls, 3);
    assert.deepEqual(env.calls, [['should', actor, 3], ['minimize', actor], ['unminimize', actor]]);
});

test('re-enabling Magic Lamp does not reactivate hooks retained from a previous enable', () => {
    const env = environment();
    env.extension.enable();
    const oldShould = env.wm._shouldAnimateActor;
    const oldComplete = env.shellwm.completed_minimize;
    env.extension.disable();
    env.extension.enable();
    const actor = {};
    function _minimizeWindow(callback) {return callback.call(env.wm, actor, 4); }
    assert.equal(_minimizeWindow(oldShould), true);
    assert.equal(_minimizeWindow(env.wm._shouldAnimateActor), false);
    oldComplete.call(env.shellwm, actor);
    env.shellwm.completed_minimize(actor);
    assert.deepEqual(env.calls, [['should', actor, 4], ['minimize', actor]]);
    env.extension.disable();
    assert.equal(env.signals.size, 0);
});
