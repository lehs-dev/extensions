import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function setupEffects() {
    // ThemeContext is global in Shell and strongly retains tracked objects.
    const themeContext = {
        scale_factor: 1,
        tracked: new Map(),
        connectObject(signal, callback, owner) {
            assert.equal(signal, 'notify::scale-factor');
            this.tracked.set(owner, callback);
        },
        disconnectObject(owner) { this.tracked.delete(owner); },
        changeScale(scale) {
            this.scale_factor = scale;
            for (const callback of this.tracked.values())
                callback();
        },
    };
    // Effects are GObjects, not actors; actor destruction does not destroy them.
    class NativeBlur {
        static list_properties() { return [{name: 'radius'}, {name: 'brightness'}]; }
        constructor(params = {}) {
            this.signals = new Map();
            Object.assign(this, params);
            this.disposeCount = 0;
        }
        connect(name, callback) {
            const id = Symbol(name);
            this.signals.set(id, {name, callback});
            return id;
        }
        disconnect(id) { assert.equal(this.signals.delete(id), true); }
        set(params) { Object.assign(this, params); }
        get_actor() { return this.actor ?? null; }
        setActor(actor) {
            this.actor = actor;
            for (const {name, callback} of this.signals.values()) {
                if (name === 'notify::actor')
                    callback(this);
            }
        }
        get radius() { return this._radius; }
        set radius(value) {
            assert.equal(this.disposeCount > 0, false, 'disposed effects must not receive scale updates');
            this._radius = value;
        }
        run_dispose() { this.disposeCount++; }
    }
    const St = {ThemeContext: {get_for_stage: () => themeContext}};
    const Shell = {BlurEffect: NativeBlur, BlurMode: {ACTOR: 0, BACKGROUND: 1}};
    const GObject = {
        registerClass: function (_metadata, cls) { return cls; },
        Object: NativeBlur,
        signal_handler_is_connected: (object, id) => object.signals.has(id),
    };
    const utils = {
        IS_IN_PREFERENCES: false,
        import_in_shell_only: async uri => ({'gi://St': St, 'gi://Shell': Shell}[uri]),
        is_usable_blur_module: () => false,
        setup_params: (object, params) => Object.assign(object, params),
    };
    const nativeOptions = {
        globals: {global: {stage: {}}},
        mocks: {
            'gi://GObject': {default: GObject},
            '../conveniences/utils.js': utils,
        },
    };
    const {NativeStaticBlurEffect} = await loadModule(
        'blur-my-shell@aunetx/effects/native_static_gaussian_blur.js', nativeOptions);
    const {NativeDynamicBlurEffect} = await loadModule(
        'blur-my-shell@aunetx/effects/native_dynamic_gaussian_blur.js', nativeOptions);
    // Some custom effects keep the context in a local, without _theme_context.
    class LocalContextEffect extends NativeBlur {
        static get default_params() { return {radius: 12}; }
        constructor(params) {
            super(params);
            themeContext.connectObject('notify::scale-factor', () => {
                this.radius = params.radius * themeContext.scale_factor;
            }, this);
        }
    }
    const {Connections} = await loadModule('blur-my-shell@aunetx/conveniences/connections.js', {
        mocks: {'gi://GObject': {default: GObject}},
    });
    const connections = new Connections();
    const {EffectsManager} = await loadModule('blur-my-shell@aunetx/conveniences/effects_manager.js', {
        globals: {global: {stage: {}}},
        mocks: {
            'gi://St': {default: St},
            '../effects/effects.js': {get_supported_effects: () => ({
                native_static: {class: NativeStaticBlurEffect},
                native_dynamic: {class: NativeDynamicBlurEffect},
                local_context: {class: LocalContextEffect},
            })},
        },
    });
    class EffectActor extends Actor {
        constructor() { super(); this.effects = new Set(); }
        add_effect(effect) { this.effects.add(effect); effect.setActor(this); }
        remove_effect(effect) { this.effects.delete(effect); effect.setActor(null); }
    }
    return {manager: new EffectsManager(connections), connections, themeContext, EffectActor};
}

test('native blur effects keep scale tracking when returned to and reused from the pool', async () => {
    const {manager, themeContext, EffectActor} = await setupEffects();
    const actor = new EffectActor();
    const effect = manager.new_native_static_effect({unscaled_radius: 24});
    actor.add_effect(effect);
    assert.equal(effect.radius, 24);
    manager.remove(effect);
    assert.equal(actor.effects.size, 0);
    assert.equal(effect.get_actor(), null);
    assert.equal(themeContext.tracked.size, 1);
    assert.equal(effect.disposeCount, 0);
    themeContext.changeScale(2);
    assert.equal(effect.radius, 48);

    const reused = manager.new_native_static_effect({unscaled_radius: 15});
    assert.equal(reused, effect);
    actor.add_effect(reused);
    assert.equal(reused.radius, 30);
    assert.equal(themeContext.tracked.size, 1);
    manager.destroy_all();
});

test('destroy_all releases active and pooled effects, theme tracking and actor signals exactly once', async () => {
    const {manager, themeContext, connections, EffectActor} = await setupEffects();
    const actor = new EffectActor();
    const effects = [manager.new_native_static_effect(), manager.new_native_dynamic_effect(),
        manager.new_local_context_effect()];
    effects.forEach(effect => actor.add_effect(effect));
    manager.remove(effects[0]);
    assert.equal(themeContext.tracked.size, 3);
    manager.destroy_all();

    assert.equal(themeContext.tracked.size, 0, 'ThemeContext must release every effect owner');
    assert.equal(connections.records.size, 0, 'notify::actor handlers must be disconnected');
    assert.equal(actor.effects.size, 0);
    assert.equal(actor.signals.size, 0);
    assert.equal(manager.used.size, 0);
    for (const effect of effects) {
        assert.equal(effect.get_actor(), null);
        assert.equal(effect.signals.size, 0);
        assert.equal(effect.disposeCount, 1);
    }
    themeContext.changeScale(3);
    manager.destroy_all();
    for (const effect of effects)
        assert.equal(effect.disposeCount, 1);
});
