import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const blur = 'blur-my-shell@aunetx/';
const magic = 'compiz-alike-magic-lamp-effect@hermes83.github.com/';
const baseline = process.env.AUDIT_BASELINE === '1';
const repositoryRoot = new URL('../', import.meta.url);
function source(path) {
    return baseline ? execFileSync('git', ['show', `HEAD:${path}`], {encoding: 'utf8', cwd: fileURLToPath(repositoryRoot)}) : readFileSync(new URL(path, repositoryRoot), 'utf8');
}
function load(path, names, globals = {}) {
    const code = source(path)
        .replace(/^import .*;\s*$/gm, '')
        .replace(/^const \w+ = await .*;\s*$/gm, '')
        .replace(/export default class /g, 'class ')
        .replace(/export /g, '')
        .replace(/import\.meta\.url/g, JSON.stringify(path));
    const context = vm.createContext({console, ...globals});
    return vm.runInContext(`${code}\n;({${names.join(',')}})`, context, {filename: path});
}

let nextId = 1;
class Signals {
    connect(signal, callback) {
        this.handlers ??= new Map();
        const id = nextId++;
        this.handlers.set(id, {signal, callback});
        return id;
    }
    disconnect(id) {
        assert.ok(this.handlers?.delete(id), `disconnect of missing handler ${id}`);
    }
    emit(signal, ...args) {
        for (const [id, handler] of [...(this.handlers || [])]) {
            if (handler.signal === signal && this.handlers.has(id))
                handler.callback(this, ...args);
        }
    }
    count(signal) {
        return [...(this.handlers?.values() || [])].filter(h => h.signal === signal).length;
    }
}
class Actor extends Signals {
    constructor(params = {}) {
        super();
        Object.assign(this, {x: 0, y: 0, width: 400, height: 300, opacity: 255}, params);
        this.children = [];
        this.effects = new Map();
        this.parent = {queue_redraw() {}};
    }
    get_parent() { return this.parent; }
    get_size() { return [this.width, this.height]; }
    get_x() { return this.x; }
    get_y() { return this.y; }
    get_children() { return this.children; }
    get_name() { return this.name; }
    insert_child_at_index(child, index) { child.parent = this; this.children.splice(index, 0, child); }
    insert_child_above(child) { this.insert_child_at_index(child, this.children.length); }
    remove_child(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    add_effect(effect) { this.add_effect_with_name(`effect${nextId++}`, effect); }
    add_effect_with_name(name, effect) { this.effects.set(name, effect); effect.vfunc_set_actor(this); }
    get_effect(name) { return this.effects.get(name); }
    remove_effect(effect) {
        const entry = [...this.effects].find(([, value]) => value === effect);
        if (entry) {
            // Mutter calls set_actor(NULL) before removing the effect from the
            // native meta group. Destroying that group here is reentrant.
            this._detachingEffect = true;
            try {
                effect.vfunc_set_actor(null);
                this.effects.delete(entry[0]);
            } finally {
                this._detachingEffect = false;
            }
        }
    }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    paint_to_content(rect) { return {rect}; }
    destroy() {
        if (this.destroyed) return;
        assert.notEqual(this._detachingEffect, true, 'actor disposal reentered native effect removal');
        this.destroyed = true;
        this.emit('destroy');
        for (const child of [...this.children]) child.destroy();
        for (const effect of [...this.effects.values()]) this.remove_effect(effect);
        this.parent?.remove_child?.(this);
    }
}
class Effect extends Signals {
    constructor(params = {}) { super(); Object.assign(this, params); }
    get actor() { return this._actor; }
    get_actor() { return this._actor; }
    vfunc_set_actor(actor) { this._actor = actor; this.emit('notify::actor'); }
    set(params) { Object.assign(this, params); }
    static get default_params() { return {}; }
}
const GObject = {
    Object: Signals,
    signal_lookup: (_signal, object) => object instanceof Actor ? 1 : 0,
    registerClass: function (...args) { return args.at(-1); },
    ParamSpec: new Proxy({}, {get: () => () => ({})}),
    ParamFlags: {READWRITE: 1},
};
const {Connections} = load(blur + 'conveniences/connections.js', ['Connections'], {GObject});

test('pooled blur effects keep one observer and disconnect actors on release', () => {
    const connections = new Connections();
    const {EffectsManager} = load(blur + 'conveniences/effects_manager.js', ['EffectsManager'], {
        get_supported_effects: () => ({test: {class: Effect}}),
    });
    const manager = new EffectsManager(connections);
    const first = new Actor();
    const second = new Actor();
    let reused;
    for (let i = 0; i < 50; i++) {
        const effect = manager.new_test_effect({});
        if (reused) assert.equal(effect, reused);
        first.add_effect(effect);
        assert.equal(first.count('destroy'), 1);
        second.add_effect(effect);
        assert.equal(first.count('destroy'), 0);
        assert.equal(second.count('destroy'), 1);
        manager.remove(effect);
        assert.equal(second.count('destroy'), 0);
        assert.equal(connections.buffer.length, 0);
        reused = effect;
    }
});

test('pipeline rebind replaces destroy handlers and parameter listeners', () => {
    const pipelines = new Signals();
    pipelines.pipelines = {pipeline_default: {effects: [{type: 'test', id: 'a', params: {}}]}};
    const effects = {
        new_test_effect: () => new Effect(),
        remove: effect => effect.get_actor()?.remove_effect(effect),
    };
    const {Pipeline} = load(blur + 'conveniences/pipeline.js', ['Pipeline']);
    const actor = new Actor();
    const pipeline = new Pipeline(effects, pipelines, 'pipeline_default', actor);
    for (let i = 0; i < 20; i++) pipeline.change_pipeline_to('pipeline_default');
    assert.equal(actor.count('destroy'), 1);
    assert.equal(pipelines.handlers.size, 5);
    pipeline.destroy();
    assert.equal(actor.count('destroy'), 0);
    assert.equal(pipelines.handlers.size, 0);
});

test('dynamic blur pipeline rebinding releases prior settings listeners', () => {
    const settings = {settings: new Signals(), SIGMA: 5, BRIGHTNESS: 0.6, CORNER_RADIUS: 14};
    const manager = {new_native_dynamic_gaussian_blur_effect: () => new Effect(), remove: effect => effect.get_actor()?.remove_effect(effect)};
    const {DummyPipeline} = load(blur + 'conveniences/dummy_pipeline.js', ['DummyPipeline']);
    const actor = new Actor();
    const pipeline = new DummyPipeline(manager, settings, actor);
    for (let i = 0; i < 10; i++) pipeline.attach_effect_to_actor(actor);
    assert.equal(actor.count('destroy'), 1);
    assert.equal(settings.settings.handlers.size, 3);
    pipeline.destroy();
    assert.equal(actor.count('destroy'), 0);
    assert.equal(settings.settings.handlers.size, 0);
});

test('lockscreen hotplug cleanup accepts existing GNOME backgrounds without extension pipelines', () => {
    const {LockscreenBlur} = load(blur + 'components/lockscreen.js', ['LockscreenBlur'], {
        Main: {layoutManager: {monitors: []}}, UnlockDialog: class {},
    });
    let destroyed = 0;
    const dialog = {_bgManagers: [{destroy() { destroyed++; }}], _backgroundGroup: {destroy_all_children() {}}};
    LockscreenBlur.prototype._updateBackgrounds.call(dialog);
    assert.equal(destroyed, 1);
    assert.equal(dialog._bgManagers.length, 0);
});

test('application-folder blur avoids duplicate listeners and removes paint effects on disable', () => {
    const appDisplay = new Signals();
    appDisplay._folderIcons = [];
    let paintCleanup = 0;
    const {AppFoldersBlur} = load(blur + 'components/appfolders.js', ['AppFoldersBlur'], {
        GObject, Main: {overview: {_overview: {controls: {_appDisplay: appDisplay}}}},
        Clutter: {Color: {from_pixel: () => ({})}},
        imports: {tweener: {tweener: {}}},
        PaintSignals: class {disconnect_all() { paintCleanup++; }},
    });
    const component = new AppFoldersBlur(new Connections(), {appfolder: {}}, {});
    component.enable();
    component.enable();
    assert.equal(appDisplay.count('view-loaded'), 1);
    component.disable();
    assert.equal(appDisplay.count('view-loaded'), 0);
    assert.equal(paintCleanup, 1);
});

test('top panels detect nearby windows on monitors above and below the primary', () => {
    for (const monitorY of [-1200, 1080]) {
        const monitor = {index: 1, x: 0, y: monitorY, width: 1900, height: 1200};
        const panel = new Actor();
        panel.has_style_pseudo_class = () => false;
        const secondaryPanel = new Actor({height: 32});
        secondaryPanel.get_transformed_position = () => [0, monitorY];
        secondaryPanel.get_height = () => 32;
        const window = {
            showing_on_its_workspace: () => true, is_hidden: () => false,
            get_window_type: () => 0, get_gtk_application_id: () => '',
            get_monitor: () => 1, get_frame_rect: () => ({y: monitorY + 34, height: 200}),
        };
        const {PanelBlur} = load(blur + 'components/panel.js', ['PanelBlur'], {
            Main: {panel, sessionMode: {hasWindows: true}, layoutManager: {primaryMonitor: {}}},
            global: {stage: {}, workspace_manager: {get_active_workspace: () => ({list_windows: () => [window]})}},
            Meta: {WindowType: {DESKTOP: 99}}, St: {ThemeContext: {get_for_stage: () => ({scale_factor: 1})}},
        });
        const component = new PanelBlur(new Connections(), {}, {});
        component.actors_list = [{widgets: {panel: secondaryPanel}, monitor, is_dtp_panel: false}];
        let transparent;
        component.set_should_override_panel = (_, override) => transparent = override;
        component.update_visibility();
        assert.equal(transparent, false, `top panel at y=${monitorY}`);
    }
});

test('resampling factors remain finite and positive when external settings supply zero or NaN', () => {
    class ShaderEffect extends Effect {
        set_uniform_value(name, value) { this.uniforms ??= {}; this.uniforms[name] = value; }
    }
    const utils = {IS_IN_PREFERENCES: false, get_shader_source: () => null, setup_params: (effect, params) => Object.assign(effect, params)};
    for (const [file, name, param] of [
        ['effects/upscale.js', 'UpscaleEffect', 'factor'],
        ['effects/downscale.js', 'DownscaleEffect', 'divider'],
    ]) {
        const Type = load(blur + file, [name], {GObject, Clutter: {ShaderEffect}, utils, Shell: {}})[name];
        const effect = new Type({[param]: 0});
        assert.equal(effect.uniforms[param], 1);
        effect[param] = NaN;
        assert.equal(effect.uniforms[param], 8);
        effect[param] = 1000;
        assert.equal(effect.uniforms[param], 64);
    }
});

test('duplicate pipeline does not replace the source effect IDs or parameter objects', () => {
    const settings = {
        PIPELINES: {pipeline_default: {name: 'Original', effects: [{id: 'source', type: 'test', params: {radius: 12}}]}},
        PIPELINES_changed() {},
    };
    const imports = {signals: {addSignalMethods(proto) {
        for (const name of ['connect', 'disconnect', 'emit']) proto[name] = Signals.prototype[name];
    }}};
    const {PipelinesManager} = load(blur + 'conveniences/pipelines_manager.js', ['PipelinesManager'], {imports});
    const manager = new PipelinesManager(settings);
    const original = manager.pipelines.pipeline_default.effects[0];
    manager.duplicate_pipeline('pipeline_default');
    assert.equal(original.id, 'source');
    const duplicate = Object.entries(manager.pipelines).find(([id]) => id !== 'pipeline_default')[1].effects[0];
    assert.notEqual(duplicate.id, original.id);
    duplicate.params.radius = 25;
    assert.equal(original.params.radius, 12);
    let descriptor;
    manager.connect('pipeline_default::pipeline-updated', (_, value) => descriptor = value);
    manager.update_pipeline_effects('pipeline_default', []);
    assert.equal(descriptor, manager.pipelines.pipeline_default);
});

test('rebuilding application blur untracks previous windows and deduplicates sticky windows', () => {
    const window = new Signals();
    const workspace = {list_windows: () => [window]};
    const global = {workspace_manager: {get_n_workspaces: () => 2, get_workspace_by_index: () => workspace}};
    const {ApplicationsBlur} = load(blur + 'components/applications.js', ['ApplicationsBlur'], {global, PaintSignals: class {}});
    const app = new ApplicationsBlur(new Connections(), {applications: {WHITELIST: [], BLACKLIST: []}}, {});
    let removed = 0;
    app.meta_window_map.set('old', {});
    app.untrack_meta_window = pid => { removed++; app.meta_window_map.delete(pid); };
    app.remove_blur = () => {};
    app.check_blur = () => {};
    app.update_all_windows();
    assert.equal(removed, 1);
    assert.equal(app.meta_window_map.size, 1);
    app.update_all_windows();
    assert.equal(removed, 2);
    assert.equal(app.meta_window_map.size, 1);
});

test('window list destruction removes the specified pipeline on secondary monitor', () => {
    const {WindowListBlur} = load(blur + 'components/window_list.js', ['WindowListBlur'], {PaintSignals: class {}});
    const component = new WindowListBlur(new Connections(), {}, {});
    const first = {destroy() {}};
    const second = {destroy() {}};
    component.pipelines = [first, second];
    component.destroy_blur(second, true);
    assert.equal(component.pipelines.length, 1);
    assert.equal(component.pipelines[0], first);
});

test('destroying one screenshot selector preserves the other monitor background', () => {
    const selectors = [new Actor({_monitorIndex: 0}), new Actor({_monitorIndex: 1})];
    const parents = [new Actor(), new Actor()];
    parents.forEach((parent, i) => parent.insert_child_at_index(selectors[i], 0));
    const managers = [];
    class Pipeline {
        create_background_with_effects(_index, list, selector, name) {
            const widget = new Actor({name});
            selector.insert_child_at_index(widget, 0);
            const manager = {
                _bms_pipeline: this,
                backgroundActor: {get_parent: () => widget},
                destroy() { this.destroyCount = (this.destroyCount || 0) + 1; },
            };
            managers.push(manager);
            list.push(manager);
        }
        destroy() {}
    }
    const Main = {screenshotUI: {_windowSelectors: selectors}};
    const global = {blur_my_shell: {_pipelines_manager: {}}};
    const {ScreenshotBlur} = load(blur + 'components/screenshot.js', ['ScreenshotBlur'], {Main, global, Pipeline});
    const component = new ScreenshotBlur(new Connections(), {screenshot: {}}, {});
    component.update_backgrounds();
    parents[0].destroy();
    assert.equal(managers[0].destroyCount, 1);
    assert.equal(managers[1].destroyCount, undefined);
    assert.equal(component.screenshot_background_managers.length, 1);
    assert.equal(component.screenshot_background_managers[0], managers[1]);
});

test('panel and application restarts are cancelled when disabled before their timeout', () => {
    for (const [file, name, extra] of [
        ['components/applications.js', 'ApplicationsBlur', {PaintSignals: class {disconnect_all() {}}}],
        ['components/panel.js', 'PanelBlur', {Main: {panel: new Actor()}}],
    ]) {
        const pending = new Map();
        const globals = {...extra,
            setTimeout(callback) { const id = nextId++; pending.set(id, callback); return id; },
            clearTimeout(id) { pending.delete(id); },
        };
        const Type = load(blur + file, [name], globals)[name];
        const component = new Type(new Connections(), {applications: {WHITELIST: [], BLACKLIST: []}}, {});
        component.disconnect_from_windows_and_overview = () => {};
        component.update_light_text_classname = () => {};
        component.enabled = true;
        let enabled = 0;
        component.enable = () => enabled++;
        if (name === 'PanelBlur') component.reset(); else component.change_blur_type();
        component.disable();
        for (const callback of pending.values()) callback();
        assert.equal(enabled, 0);
    }
});

class Timeline extends Signals {
    constructor(params) { super(); Object.assign(this, params); }
    start() { this.running = true; }
    stop() { this.running = false; }
    get_progress() { return 0.5; }
}
class DeformEffect extends Effect {
    constructor(params) { super(); this._init(params); }
    _init() {}
    set_n_tiles(x, y) { this.tiles = [x, y]; }
    invalidate() { this.invalidations = (this.invalidations || 0) + 1; }
}
function magicEnvironment() {
    const completions = [];
    const monitors = [
        {x: 0, y: 0, width: 1900, height: 1080},
        {x: 1900, y: 0, width: 1900, height: 1200},
    ];
    const uiGroup = new Actor();
    const shellwm = {
        original_completed_minimize(actor) { completions.push(actor); },
        original_completed_unminimize(actor) { completions.push(actor); },
    };
    const Main = {layoutManager: {monitors}, overview: {visible: false}, wm: {_shellwm: shellwm}, uiGroup};
    const global = {display: {get_monitor_scale: () => 2}, window_group: new Actor()};
    global.get_window_actors = () => [actor];
    const pendingIdles = new Map();
    const GLib = {
        PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
        idle_add(_priority, callback) { const id = nextId++; pendingIdles.set(id, callback); return id; },
        source_remove(id) { assert.ok(pendingIdles.delete(id)); },
    };
    const flushIdles = () => {
        for (const [id, callback] of [...pendingIdles]) {
            pendingIdles.delete(id);
            callback();
        }
    };
    const classes = load(magic + 'extension.js', [
        'CompizMagicLampEffectExtension', 'MagicLampMinimizeEffect', 'MagicLampUnminimizeEffect',
    ], {
        GObject, Clutter: {DeformEffect, Timeline}, St: {Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3}, Widget: Actor},
        Extension: class {}, Main, global, GLib,
    });
    const settingsData = Object.fromEntries(Object.entries({EFFECT: 'default', DURATION: 400, X_TILES: 10, Y_TILES: 10})
        .map(([name, value]) => [name, {get: () => value}]));
    const actor = new Actor({x: 2000, y: 100});
    actor.meta_window = {
        get_monitor: () => 1,
        get_buffer_rect: () => ({x: actor.x, y: actor.y, width: actor.width, height: actor.height}),
    };
    return {classes, Main, global, completions, settingsData, actor, pendingIdles, flushIdles};
}

test('magic lamp interruption stops timeline and completes exactly once without further redraw', () => {
    const env = magicEnvironment();
    const effect = new env.classes.MagicLampMinimizeEffect({settingsData: env.settingsData, icon: {x: 2200, y: 1200, width: 0, height: 0}});
    env.actor.add_effect(effect);
    const timeline = effect.timerId;
    env.Main.overview.visible = true;
    effect.on_tick_elapsed(timeline, 10);
    effect.destroy();
    assert.equal(timeline.running, false);
    assert.equal(timeline.handlers.size, 0);
    assert.equal(effect.invalidations, undefined);
    assert.equal(env.completions.length, 1);
});

test('external effect removal completes animation without recursively removing the actor effect', () => {
    const env = magicEnvironment();
    const effect = new env.classes.MagicLampMinimizeEffect({settingsData: env.settingsData});
    env.actor.add_effect(effect);
    const timeline = effect.timerId;
    const removeEffect = env.actor.remove_effect.bind(env.actor);
    let removals = 0;
    env.actor.remove_effect = value => { removals++; removeEffect(value); };
    env.actor.remove_effect(effect);
    assert.equal(removals, 1);
    assert.equal(env.completions.length, 0);
    env.flushIdles();
    assert.equal(env.completions.length, 1);
    assert.equal(timeline.running, false);
});

test('magic lamp handles missing monitor and zero-size windows by completing', () => {
    for (const missingMonitor of [false, true]) {
        const env = magicEnvironment();
        if (missingMonitor) env.Main.layoutManager.monitors.length = 0; else env.actor.width = 0;
        const effect = new env.classes.MagicLampMinimizeEffect({settingsData: env.settingsData});
        assert.doesNotThrow(() => env.actor.add_effect(effect));
        assert.equal(env.completions.length, 1);
        assert.equal(effect.timerId, null);
    }
});

test('tiny windows cannot keep compositor effects pending for minutes', () => {
    const env = magicEnvironment();
    env.actor.width = 1;
    env.actor.height = 1;
    const effect = new env.classes.MagicLampMinimizeEffect({settingsData: env.settingsData});
    env.actor.add_effect(effect);
    assert.ok(effect.timerId.duration <= 1400);
    effect.destroy();
});

test('magic lamp collapsed deform dimensions always produce finite vertices', () => {
    const env = magicEnvironment();
    const effect = new env.classes.MagicLampMinimizeEffect({settingsData: env.settingsData, icon: {x: 2200, y: 1200, width: 0, height: 0}});
    env.actor.add_effect(effect);
    effect.k = 1;
    effect.j = 0;
    for (const side of [0, 1, 2, 3]) {
        effect.iconPosition = side;
        effect.icon = {x: effect.window.x, y: effect.window.y, width: effect.window.width, height: effect.window.height};
        if (side === 1) effect.icon.x += effect.icon.width;
        if (side === 2) effect.icon.y += effect.icon.height;
        const vertex = {tx: 0.5, ty: 0.5};
        effect.vfunc_deform_vertex(effect.window.width, effect.window.height, vertex);
        assert.ok(Number.isFinite(vertex.x) && Number.isFinite(vertex.y), `non-finite vertex for side ${side}`);
    }
    effect.destroy();
});

test('cross-monitor minimize uses independent texture and cleans up on interruption', () => {
    const env = magicEnvironment();
    const extension = new env.classes.CompizMagicLampEffectExtension();
    extension._activeEffects = new Set();
    extension.settingsData = env.settingsData;
    extension.getIcon = () => ({x: 800, y: 1070, width: 48, height: 48, monitorIndex: 0, dockPosition: 'bottom'});
    extension.animate(env.actor, env.classes.MagicLampMinimizeEffect, 'minimize-magic-lamp-effect');
    assert.equal(env.actor.opacity, 0);
    assert.equal(env.actor.effects.size, 0);
    assert.equal(env.Main.uiGroup.children.length, 1);
    const snapshot = env.Main.uiGroup.children[0];
    assert.ok(snapshot.content);
    assert.equal(snapshot.content.rect, null, 'snapshot captures the complete actor without cropping');
    const effect = [...extension._activeEffects][0];
    assert.equal(effect.sourceActor, env.actor);
    assert.equal(effect.iconMonitor, env.Main.layoutManager.monitors[0]);
    extension.destroyActorEffect(env.actor);
    assert.equal(env.actor.opacity, 255);
    assert.equal(env.Main.uiGroup.children.length, 0);
    assert.equal(extension._activeEffects.size, 0);
    assert.equal(env.completions[0], env.actor);
    assert.equal(env.completions.length, 1);
});

function crossExtension(env) {
    const extension = new env.classes.CompizMagicLampEffectExtension();
    extension._activeEffects = new Set();
    extension.settingsData = env.settingsData;
    extension.getIcon = () => ({x: 800, y: 1070, width: 48, height: 48, monitorIndex: 0, dockPosition: 'bottom'});
    return extension;
}

test('snapshot capture, insertion and effect attachment failures complete without leaking or hiding window', () => {
    for (const failure of ['capture', 'empty-content', 'insert', 'attach']) {
        const env = magicEnvironment();
        const extension = crossExtension(env);
        if (failure === 'capture') env.actor.paint_to_content = () => { throw new Error('capture failed'); };
        if (failure === 'empty-content') env.actor.paint_to_content = () => null;
        if (failure === 'insert') env.Main.uiGroup.insert_child_above = () => { throw new Error('insert failed'); };
        if (failure === 'attach') {
            env.Main.uiGroup.insert_child_above = snapshot => {
                env.Main.uiGroup.insert_child_at_index(snapshot, 0);
                snapshot.add_effect_with_name = () => { throw new Error('attach failed'); };
            };
        }
        extension.animate(env.actor, env.classes.MagicLampMinimizeEffect, 'minimize-magic-lamp-effect');
        assert.equal(env.actor.opacity, 255, failure);
        assert.equal(env.Main.uiGroup.children.length, 0, failure);
        assert.equal(extension._activeEffects.size, 0, failure);
        assert.equal(env.completions.length, 1, failure);
        assert.equal(env.completions[0], env.actor, failure);
    }
});

test('source destruction and extension disable during cross-monitor flight clean every owned object', () => {
    for (const action of ['unmanaged', 'disable', 'snapshot-destroy']) {
        const env = magicEnvironment();
        const extension = crossExtension(env);
        extension.animate(env.actor, env.classes.MagicLampMinimizeEffect, 'minimize-magic-lamp-effect');
        const effect = [...extension._activeEffects][0];
        const timeline = effect.timerId;
        if (action === 'unmanaged') env.actor.destroy();
        if (action === 'disable') extension.disable();
        if (action === 'snapshot-destroy') env.Main.uiGroup.children[0].destroy();
        assert.equal(timeline.running, false, action);
        assert.equal(timeline.handlers.size, 0, action);
        assert.equal(env.Main.uiGroup.children.length, 0, action);
        assert.equal(extension._activeEffects.size, 0, action);
        assert.equal(env.actor.opacity, 255, action);
        assert.equal(env.actor.count('destroy'), 0, action);
        assert.equal(env.completions.length, 1, action);
    }
});

test('external snapshot effect removal defers native disposal and disable drains the owned idle', () => {
    for (const finish of ['idle', 'disable', 'source-destroy']) {
        const env = magicEnvironment();
        const extension = crossExtension(env);
        extension.animate(env.actor, env.classes.MagicLampMinimizeEffect, 'minimize-magic-lamp-effect');
        const snapshot = env.Main.uiGroup.children[0];
        const effect = [...extension._activeEffects][0];
        snapshot.remove_effect(effect);
        assert.equal(snapshot.destroyed, undefined);
        assert.equal(snapshot.visible, false);
        assert.equal(env.pendingIdles.size, 1);
        assert.equal(extension._activeEffects.size, 1);
        if (finish === 'idle') env.flushIdles();
        if (finish === 'disable') extension.disable();
        if (finish === 'source-destroy') env.actor.destroy();
        assert.equal(env.pendingIdles.size, 0, finish);
        assert.equal(extension._activeEffects.size, 0, finish);
        assert.equal(env.Main.uiGroup.children.length, 0, finish);
        assert.equal(env.completions.length, 1, finish);
        assert.equal(env.actor.opacity, 255, finish);
    }
});

test('timeline completion still calls captured native callback after global hooks have been restored', () => {
    const env = magicEnvironment();
    const extension = crossExtension(env);
    extension.animate(env.actor, env.classes.MagicLampUnminimizeEffect, 'unminimize-magic-lamp-effect');
    const effect = [...extension._activeEffects][0];
    env.Main.wm._shellwm.original_completed_unminimize = null;
    effect.timerId.emit('completed');
    assert.equal(env.completions.length, 1);
    assert.equal(env.completions[0], env.actor);
    assert.equal(extension._activeEffects.size, 0);
});

test('same-monitor animation retains the direct actor and clamps corrupt mesh settings', () => {
    const env = magicEnvironment();
    const extension = crossExtension(env);
    extension.getIcon = () => ({x: 2200, y: 1190, width: 48, height: 48, monitorIndex: 1});
    env.settingsData.X_TILES.get = () => 1e12;
    env.settingsData.Y_TILES.get = () => NaN;
    env.settingsData.DURATION.get = () => Infinity;
    extension.animate(env.actor, env.classes.MagicLampMinimizeEffect, 'minimize-magic-lamp-effect');
    assert.equal(env.Main.uiGroup.children.length, 0);
    assert.equal(env.actor.opacity, 255);
    const effect = env.actor.get_effect('minimize-magic-lamp-effect');
    assert.equal(effect.X_TILES, 50);
    assert.equal(effect.Y_TILES, 10);
    assert.equal(effect.DURATION, 400);
    effect.destroy();
});
