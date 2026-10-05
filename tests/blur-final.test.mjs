import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function load(path, name, globals = {}) {
    const source = readFileSync(new URL(`../blur-my-shell@aunetx/${path}`, import.meta.url), 'utf8')
        .replace(/^import .*;\s*$/gm, '')
        .replace(/^(?:const St|let BlurOrShell) = await .*;\s*$/gm, '')
        .replace(/^\s*BlurOrShell = await .*;\s*$/gm, '')
        .replace(/export /g, '');
    return vm.runInNewContext(`${source}\n;${name}`, {console, ...globals});
}

test('native blur keeps logical corners through scale changes, pooled reuse and maximization', () => {
    const theme = {
        scale_factor: 2,
        connectObject(_signal, callback) {this.changed = callback;},
        change(scale) {this.scale_factor = scale; this.changed();},
    };
    const NativeBlur = load('effects/native_dynamic_gaussian_blur.js', 'NativeDynamicBlurEffect', {
        GObject: {registerClass: function (_metadata, EffectClass) {return EffectClass;}},
        St: {ThemeContext: {get_for_stage: () => theme}},
        global: {stage: {}},
        BlurOrShell: {
            BlurMode: {BACKGROUND: 1},
            BlurEffect: class {
                constructor(params) {Object.assign(this, params);}
                set(params) {Object.assign(this, params);}
            },
        },
        utils: {
            IS_IN_PREFERENCES: false,
            setup_params(effect, params) {
                for (const [key, defaultValue] of Object.entries(effect.constructor.default_params))
                    effect[key] = key in params ? params[key] : defaultValue;
            },
        },
    });
    const effect = new NativeBlur({unscaled_radius: 30, brightness: 0.6, corner_radius: 14});
    assert.equal(effect.corner_radius, 28);
    assert.equal(effect.unscaled_corner_radius, 14);
    theme.change(1);
    assert.equal(effect.corner_radius, 14);
    effect.set({corner_radius: 19});
    theme.change(2);
    assert.equal(effect.corner_radius, 38);
    assert.equal(effect.unscaled_corner_radius, 19);

    const ApplicationsBlur = load('components/applications.js', 'ApplicationsBlur');
    const component = {settings: {applications: {
        STATIC_BLUR: false, CORNER_WHEN_MAXIMIZED: false, CORNER_RADIUS: 19,
    }}};
    const window = {maximized_horizontally: true, bg_manager: {_bms_pipeline: {effect}}};
    ApplicationsBlur.prototype.update_corner_radius.call(component, window);
    theme.change(1);
    assert.equal(effect.corner_radius, 0, 'scale change must keep maximized corners straight');
    window.maximized_horizontally = false;
    ApplicationsBlur.prototype.update_corner_radius.call(component, window);
    theme.change(2);
    assert.equal(effect.corner_radius, 38);
    effect.set({corner_radius: 7});
    theme.change(1);
    assert.equal(effect.corner_radius, 7, 'pooled effect must use the newly configured logical radius');
});

test('malformed blur pipelines reset once and return fully decoded defaults without recursion', () => {
    const Settings = load('conveniences/settings.js', 'Settings', {
        imports: {signals: {addSignalMethods() {}}},
        console: {warn() {}},
    });
    const variant = value => ({deep_unpack: () => value});
    const valid = () => variant({default: {
        name: variant('Default'),
        effects: variant([variant({type: variant('blur'), id: variant('effect0'), params: variant({sigma: variant(5)})})]),
    }});
    const corrupt = [
        variant({broken: {name: variant('Missing effects')}}),
        variant({broken: {name: variant('Bad array'), effects: variant(null)}}),
        variant({broken: {name: variant('Bad effect'), effects: variant([variant({type: variant('blur')})])}}),
        variant({broken: {name: variant('Bad params'), effects: variant([variant({type: variant('blur'), id: variant('a'), params: variant(null)})])}}),
        {deep_unpack() {throw new Error('unpack failed');}},
    ];
    for (const value of corrupt) {
        let reads = 0;
        let resets = 0;
        const backend = {
            get_value() {reads++; return value;},
            get_default_value: valid,
            reset() {resets++;},
        };
        const settings = new Settings([{component: 'general', schemas: [{name: 'pipelines', type: 'Pipelines'}]}], backend);
        const decoded = settings.PIPELINES;
        assert.equal(reads, 1);
        assert.equal(resets, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(decoded)), {default: {
            name: 'Default', effects: [{type: 'blur', id: 'effect0', params: {sigma: 5}}],
        }});
    }
    const invalidDefault = new Settings([{component: 'general', schemas: [{name: 'pipelines', type: 'Pipelines'}]}], {
        get_value: () => corrupt[0], get_default_value: () => corrupt[0], reset() {},
    });
    assert.deepEqual(Object.keys(invalidDefault.PIPELINES), []);
});
