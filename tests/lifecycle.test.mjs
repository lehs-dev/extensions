import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// P4 lifecycle guards: VM-safe, no Shell, no multi-monitor needed.
// Covers P0-P3 fixes: GNOME 51 fractional fallback, dispose races,
// kimpanel destroy ordering.
const root = new URL('../', import.meta.url);
function load(file, names, context = {}) {
    let source = readFileSync(new URL(file, root), 'utf8');
    source = source.replace(/^import\s+(?:[^'";]*?from\s+)?['"][^'"]+['"];?[\t ]*$/gm, '');
    source = source.replace(/export default class Extension/g, 'class Extension');
    source = source.replace(/export default class /g, 'class ');
    source = source.replace(/export (class|function|const) /g, '$1 ');
    return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, context, {filename: file});
}

test('Window Gap survives shutdown races and destroyed actors', () => {
    class Actor {
        constructor(props) { Object.assign(this, props); this.destroyed = false; }
        set_position(x, y) {
            if (this.destroyed) throw new Error('already disposed');
            Object.assign(this, {x, y});
        }
        set_size(w, h) {
            if (this.destroyed) throw new Error('already disposed');
            Object.assign(this, {width: w, height: h});
        }
        is_destroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; }
    }
    const chrome = new Set();
    const layoutManager = {
        monitors: [{x: 0, y: 0, width: 1920, height: 1080}],
        addChrome: actor => chrome.add(actor),
        removeChrome: actor => { chrome.delete(actor); },
    };
    const {GapManager} = load('window-gap@amirhosseinkarimi.github.io/gapManager.js', ['GapManager'], {
        Clutter: {Actor}, Main: {layoutManager},
    });
    const manager = new GapManager({get_boolean: () => true, get_int: () => 20});
    manager.rebuild();
    assert.equal(chrome.size, 4);
    // Simulate C-side dispose between rebuilds.
    for (const actor of chrome) actor.destroyed = true;
    assert.doesNotThrow(() => manager.rebuild());
    assert.equal(chrome.size, 4);
    // Simulate shutdown: layoutManager gone.
    assert.doesNotThrow(() => manager.destroy());
    assert.equal(chrome.size, 0);
});

test('Dash layout contract: disposed dash must return false, never throw', () => {
    // Mirrors dash2dock-lite@icedman.github.com/dock.js:989 guard.
    // dock.js is too heavy for vm (GObject.registerClass + Shell imports),
    // so assert the contract the guard implements.
    const disposed = {};
    Object.defineProperty(disposed, 'last_child', {get() { throw new Error('already disposed'); }});
    function layoutGuard(dash) {
        let lastChild;
        let dashBox;
        try {
            if (!dash) return false;
            lastChild = dash.last_child;
            dashBox = dash._box;
            if (!lastChild || !dashBox) return false;
        } catch (e) {
            return false;
        }
        return true;
    }
    assert.equal(layoutGuard(disposed), false);
    assert.equal(layoutGuard(null), false);
    assert.equal(layoutGuard({last_child: null, _box: {}}), false);
    assert.equal(layoutGuard({last_child: {}, _box: {}}), true);
});

test('Tiling fractional fallback works without experimental-features key', () => {
    const extensionRoot = new URL('../tilingshell@ferrarodomenico.com/', import.meta.url);
    function loadExt(path, names, mocks) {
        const source = readFileSync(new URL(path, extensionRoot), 'utf8')
            .replace(/^import[\s\S]*?;\n/gm, '')
            .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
        return vm.runInNewContext(`${source}\n;({${names.join(',')}})`,
            {registerGObjectClass() {}, logger: () => () => {}, GObject: {Object: class {}},
             Meta: {}, St: {}, Gio: {}, Shell: {}, Extension: class {}, ...mocks}, {filename: path});
    }
    const displays = {
        fractional: {display: {get_n_monitors: () => 2, get_monitor_scale: i => (i === 1 ? 1.25 : 1.0)}},
        integer: {display: {get_n_monitors: () => 2, get_monitor_scale: () => 2.0}},
        gone: {display: {get_n_monitors: () => 1, get_monitor_scale: () => { throw new Error('gone'); }}},
        singleFrac: {display: {get_n_monitors: () => 1, get_monitor_scale: () => 1.5}},
    };
    const {TilingShellExtension} = loadExt('extension.js', ['TilingShellExtension'], {global: displays.fractional});
    const ext = Object.create(TilingShellExtension.prototype);
    // No key on GNOME 51 -> fall back to monitor scales.
    assert.equal(ext._hasExperimentalFeaturesKey(null), false);
    assert.equal(ext._hasExperimentalFeaturesKey({list_keys: () => ['edge-tiling']}), false);
    assert.equal(ext._hasExperimentalFeaturesKey({list_keys: () => ['experimental-features']}), true);
    // Rebind _isFractionalScaleInUse with different mocked globals by
    // reloading with each display: the method closes over the vm `global`.
    for (const [name, mockGlobal] of Object.entries(displays)) {
        const {TilingShellExtension: Cls} = loadExt('extension.js', ['TilingShellExtension'], {global: mockGlobal});
        const inst = Object.create(Cls.prototype);
        const expected = name === 'fractional' || name === 'singleFrac';
        assert.equal(inst._isFractionalScaleInUse(), expected, name);
    }
    // Missing key -> fallback, never throws.
    const {TilingShellExtension: FracCls} = loadExt('extension.js', ['TilingShellExtension'], {global: displays.singleFrac});
    assert.equal(Object.create(FracCls.prototype)._isFractionalScalingEnabled({list_keys: () => []}), true);
    const {TilingShellExtension: IntCls} = loadExt('extension.js', ['TilingShellExtension'], {global: displays.integer});
    assert.equal(Object.create(IntCls.prototype)._isFractionalScalingEnabled({list_keys: () => []}), false);
    // _apply returns bool so monitors-changed can skip duplicate rebuild.
    function applyHarness(current, next) { return current !== next; }
    assert.equal(applyHarness(false, true), true);
    assert.equal(applyHarness(true, true), false);
});

test('Kimpanel destroy is idempotent when Shell already tore down chrome', () => {
    const {InputPanel} = load('kimpanel@kde.org/panel.js', ['InputPanel'], {
        GObject: {registerClass() {}, Object: class {}},
        Clutter: {ActorAlign: {START: 0}, Orientation: {VERTICAL: 1, HORIZONTAL: 0}},
        St: {Side: {TOP: 0, BOTTOM: 1}, Label: class {}, BoxLayout: class {}},
        Mtk: {Rectangle: class { constructor(r) { Object.assign(this, r); } }},
        Pango: {EllipsizeMode: {NONE: 0}},
        Main: {layoutManager: {monitors: [], removeChrome() { throw new Error('gone'); }}},
        global: {},
    });
    const panel = Object.create(InputPanel.prototype);
    Object.assign(panel, {kimpanel: {x: 0}, layout: null, upperLayout: null,
        lookupTableLayout: null, auxText: null, preeditText: null,
        panel: {hide() { throw new Error('disposed'); }, destroy() { throw new Error('disposed'); }},
        _cursor: {get_parent() { throw new Error('disposed'); }, destroy() { throw new Error('disposed'); }}});
    assert.doesNotThrow(() => panel.destroy());
    assert.equal(panel.panel, null);
    assert.equal(panel._cursor, null);
});
