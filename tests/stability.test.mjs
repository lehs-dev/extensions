import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
function load(file, names, context = {}) {
    let source = readFileSync(new URL(file, root), 'utf8');
    source = source.replace(/^import\s+(?:[^'";]*?from\s+)?['"][^'"]+['"];?[\t ]*$/gm, '');
    source = source.replace(/export default class Extension/g, 'class Extension');
    source = source.replace(/export default class /g, 'class ');
    source = source.replace(/export (class|function|const) /g, '$1 ');
    return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, context, {filename: file});
}

class Signals {
    ids = new Map();
    next = 1;
    connect(name, fn) {
        const id = this.next++;
        this.ids.set(id, {name, fn, blocked: 0});
        return id;
    }
    disconnect(id) {
        assert.ok(this.ids.delete(id), `disconnect of stale signal ${id}`);
    }
    emit(name, ...args) {
        for (const signal of [...this.ids.values()]) {
            if (signal.name === name && !signal.blocked)
                signal.fn(this, ...args);
        }
    }
}

test('Window Gap reuses chrome actors and follows same-count monitor changes', () => {
    class Actor {
        constructor(props) { Object.assign(this, props); }
        set_position(x, y) { Object.assign(this, {x, y}); }
        set_size(width, height) { Object.assign(this, {width, height}); }
        destroy() { this.destroyed = true; }
    }
    const chrome = new Set();
    const layoutManager = {
        monitors: [{x: 0, y: 0, width: 1900, height: 1080}, {x: 1900, y: 0, width: 1900, height: 1200}],
        addChrome: actor => chrome.add(actor),
        removeChrome: actor => assert.ok(chrome.delete(actor)),
    };
    const {GapManager} = load('window-gap@amirhosseinkarimi.github.io/gapManager.js', ['GapManager'], {
        Clutter: {Actor}, Main: {layoutManager},
    });
    const manager = new GapManager({get_boolean: () => true, get_int: () => 20});
    manager.rebuild();
    const actors = [...chrome];
    manager.rebuild();
    assert.deepEqual([...chrome], actors);
    layoutManager.monitors = [{x: 0, y: 0, width: 1900, height: 1200}, {x: 0, y: 1200, width: 1900, height: 1080}];
    manager.rebuild();
    assert.equal(actors[4].y, 1200);
    assert.equal(actors[1].y, 1180);
    layoutManager.monitors = [layoutManager.monitors[0]];
    manager.rebuild();
    assert.equal(chrome.size, 4);
    assert.ok(actors[4].destroyed);
    layoutManager.monitors = [{x: 0, y: 0, width: 10, height: 10}];
    manager.rebuild();
    assert.ok([...chrome].every(actor => actor.width <= 10 && actor.height <= 10));
    manager.destroy();
    assert.equal(chrome.size, 0);
});

const objectStub = {Object: class {}, registerClass() {}};
const panelDir = 'kimpanel@kde.org/';
const panelLib = load(`${panelDir}lib.js`, ['parseProperty'], {
    PopupMenu: {PopupBaseMenuItem: class {}}, GObject: objectStub,
});

test('Kimpanel rejects malformed properties and reuses registered menu entries', () => {
    assert.equal(panelLib.parseProperty(null), null);
    assert.equal(panelLib.parseProperty('bad'), null);
    const {KimIndicator} = load(`${panelDir}indicator.js`, ['KimIndicator'], {
        GObject: objectStub, PanelMenu: {Button: class {}}, Lib: panelLib,
    });
    const indicator = Object.create(KimIndicator.prototype);
    Object.assign(indicator, {_properties: Object.create(null), _propertySwitch: Object.create(null),
        show() {}, hide() {}, _addPropertyItem(key) {
            this._propertySwitch[key] = {setIcon() {}, label: {}, destroy() { this.destroyed = true; }};
        }});
    indicator._updateProperties(['/Fcitx/im:EN:keyboard:English']);
    const item = indicator._propertySwitch['/Fcitx/im'];
    indicator._updateProperties(['/Fcitx/im:VI:keyboard:Vietnamese']);
    assert.equal(indicator._propertySwitch['/Fcitx/im'], item);
    assert.equal(item.label.text, 'VI');
    indicator._updateProperties([]);
    assert.ok(item.destroyed);
    assert.equal(Object.keys(indicator._properties).length, 0);
    let deactivated = false;
    indicator._deactive = () => { deactivated = true; };
    indicator._active();
    assert.ok(deactivated);
});

test('Kimpanel candidate popup uses finite rectangle dimensions on secondary monitor', () => {
    const {InputPanel} = load(`${panelDir}panel.js`, ['InputPanel'], {
        GObject: objectStub,
        Mtk: {Rectangle: class { constructor(rect) { Object.assign(this, rect); } }},
        St: {Side: {TOP: 0, BOTTOM: 1}},
        Main: {layoutManager: {monitors: [{x: 0, y: 0, width: 1900, height: 1080},
            {x: 1900, y: 0, width: 1900, height: 1200}]}},
        global: {display: {focus_window: {protocol_to_stage_rect: rect => rect}, get_monitor_index_for_rect: () => 1}},
    });
    const panel = Object.create(InputPanel.prototype);
    const cursor = {set_position(x, y) { Object.assign(this, {x, y}); },
        set_size(width, height) { Object.assign(this, {width, height}); }};
    Object.assign(panel, {kimpanel: {x: 1950, y: 1150, w: 8, h: 24, relative: false, showLookupTable: true},
        _cursor: cursor, panel: {get_height: () => 100}, show() {}, hide() {}});
    panel.updatePosition();
    assert.equal(cursor.width, 8);
    assert.equal(cursor.height, 24);
    assert.equal(panel._arrowSide, 1);
    const candidate = {};
    panel.lookupTableLayout = {get_children: () => [candidate]};
    panel.setLookupTable([], ['candidate'], true);
    assert.equal(candidate.text, 'candidate');
});

test('Kimpanel cursor changes compare candidate cursor and guard zero client scale', () => {
    const {Kimpanel} = load(`${panelDir}extension.js`, ['Kimpanel'], {GObject: objectStub, Extension: class {}});
    const panel = Object.create(Kimpanel.prototype);
    let updates = 0;
    Object.assign(panel, {_isDestroyed: false, cursor: 2, pos: 0, updateInputPanel: () => updates++});
    const parse = cursor => panel._parseSignal(null, null, null, null, 'UpdateLookupTableCursor', {deep_unpack: () => [cursor]});
    parse(0);
    assert.equal(updates, 1);
    parse(0);
    assert.equal(updates, 1);
    panel.setRect(5, 6, 7, 8, true, 0);
    assert.equal(panel.scale, 1);
});

function createAPI() {
    const display = new Signals();
    const indicators = new Signals();
    const uiGroup = {add_style_class_name() {}, remove_style_class_name() {}};
    const controller = new Signals();
    const quickSettings = {_indicators: indicators};
    const main = {panel: {statusArea: {quickSettings}}, layoutManager: {uiGroup},
        overview: {_overview: {controls: {_searchController: controller}}}};
    const gobject = {
        signal_handler_find: (object, {signalId}) => [...object.ids].find(([, signal]) => signal.name === signalId)?.[0] ?? 0,
        signal_handler_block: (object, id) => object.ids.get(id).blocked++,
        signal_handler_unblock: (object, id) => object.ids.get(id).blocked--,
        signal_handler_is_connected: (object, id) => object.ids.has(id),
    };
    const {API} = load('just-perfection-desktop@just-perfection/lib/API.js', ['API'], {global: {display}});
    const api = new API({Main: main, GObject: gobject, AltTab: {WindowIcon: class {}},
        OSDWindow: {OsdWindow: class {}}, Clutter: {ActorAlign: {START: 0, CENTER: 1, END: 2}}}, 50);
    return {api, main, display, indicators};
}

test('Just Perfection defers quick settings once and does not disconnect stale IDs at close', () => {
    const {api, main, indicators} = createAPI();
    api.quickSettingsDarkStyleToggleHide();
    api.quickSettingsDarkStyleToggleShow();
    assert.equal(indicators.ids.size, 1);
    let visible = false;
    main.panel.statusArea.quickSettings._darkMode = {quickSettingsItems: [{show() { visible = true; }}]};
    indicators.emit('child-added');
    assert.ok(visible);
    assert.equal(indicators.ids.size, 0);
    api.close();
});

test('Just Perfection quick settings hide/show cycles restore initially hidden toggle', () => {
    const {api, main} = createAPI();
    const toggle = new Signals();
    Object.assign(toggle, {visible: false, hide() { this.visible = false; }});
    main.panel.statusArea.quickSettings._backlight = {quickSettingsItems: [toggle]};
    for (let i = 0; i < 3; i++) {
        api.quickSettingsBacklightToggleHide();
        assert.equal(toggle.ids.size, 1);
        api.quickSettingsBacklightToggleShow();
        assert.equal(toggle.ids.size, 0);
        assert.equal(toggle.visible, false);
    }
});

test('Just Perfection preserves Shell attention handlers and balances repeated overlay blocks', () => {
    const {api, display} = createAPI();
    const first = display.connect('window-demands-attention', () => {});
    const second = display.connect('window-marked-urgent', () => {});
    const overlay = display.connect('overlay-key', () => {});
    for (let i = 0; i < 3; i++) {
        api.windowDemandsAttentionFocusEnable();
        assert.equal(display.ids.get(first).blocked, 1);
        assert.equal(display.ids.get(second).blocked, 1);
        api.windowDemandsAttentionFocusDisable();
        assert.equal(display.ids.get(first).blocked, 0);
        assert.equal(display.ids.get(second).blocked, 0);
        assert.equal(display.ids.size, 3);
    }
    api.blockOverlayKey();
    api.blockOverlayKey();
    api.unblockOverlayKey();
    assert.equal(display.ids.get(overlay).blocked, 0);
});

test('Just Perfection OSD positioning tolerates temporary absence of all monitors', () => {
    const {api, main} = createAPI();
    main.osdWindowManager = {_osdWindows: []};
    assert.doesNotThrow(() => api.osdPositionSet(0));
});

test('Workspace bounce rejects NaN and Infinity', () => {
    const {computeBounceParams} = load('static-workspace-background@CleoMenezesJr.github.io/bounce.js', ['computeBounceParams']);
    assert.equal(computeBounceParams({duration: NaN, target: 1}), null);
    assert.equal(computeBounceParams({duration: 100, target: Infinity}), null);
    assert.equal(computeBounceParams({duration: 100, target: 1, current: NaN}), null);
    assert.equal(computeBounceParams({duration: 100, target: 1}).target, 1);
});

test('Static background restores actors and completes interrupted Shell switch when disabled', () => {
    const uiGroup = new Signals();
    class BackgroundGroup extends Signals {
        visible = true;
        destroy() { this.emit('destroy'); }
    }
    let managers = 0;
    class MonitorGroup extends Signals {
        _init() {
            this.style = 'original';
            this._workspaceGroups = [{_background: {opacity: 180}}];
            this._container = {translation_x: 0, translation_y: 0,
                remove_transition: () => {
                    if (!this.returnParams) return;
                    const params = this.returnParams;
                    this.returnParams = null;
                    params.onStopped?.(false);
                }, ease: params => { this.returnParams = params; }};
            this.progress = 0;
        }
        get_style() { return this.style; }
        set_style(style) { this.style = style; }
        insert_child_below() {}
        get_stage() { return {}; }
        get_text_direction() { return 0; }
        remove_transition() {}
        ease_property(_property, value, params) { this.progress = value; this.slideParams = params; }
    }
    const origInit = MonitorGroup.prototype._init;
    const origEase = MonitorGroup.prototype.ease_property;
    const {Extension} = load('static-workspace-background@CleoMenezesJr.github.io/extension.js', ['Extension'], {
        WorkspaceAnimation: {MonitorGroup}, Meta: {BackgroundGroup},
        Background: {BackgroundManager: class { constructor() { managers++; } destroy() { managers--; } }},
        Main: {uiGroup}, Clutter: {TextDirection: {RTL: 1}, AnimationMode: {}},
        global: {workspace_manager: {layout_rows: 1}},
        computeBounceParams: () => ({target: 1, slideDuration: 75, returnDuration: 130, overshootPx: 14}),
        console: {log() {}},
    });
    for (const phase of ['slide', 'return']) {
        const extension = new Extension();
        extension.enable();
        const group = new MonitorGroup();
        group._init({index: 0}, [0, 1], null);
        const background = new BackgroundGroup();
        uiGroup.emit('child-added', background);
        assert.equal(background.visible, false);
        let completed = 0;
        const callbacks = [];
        group.ease_property('progress', 1, {duration: 100,
            onComplete: () => { completed++; callbacks.push('completed'); },
            onStopped: finished => callbacks.push(`stopped:${finished}`)});
        const lateSlide = group.slideParams.onComplete;
        if (phase === 'return')
            lateSlide();
        extension.disable();
        assert.equal(completed, 1);
        assert.deepEqual(callbacks, ['stopped:true', 'completed']);
        assert.equal(managers, 0);
        assert.equal(group.style, 'original');
        assert.equal(group._workspaceGroups[0]._background.opacity, 180);
        assert.equal(background.visible, true);
        assert.equal(uiGroup.ids.size, 0);
        assert.equal(MonitorGroup.prototype._init, origInit);
        assert.equal(MonitorGroup.prototype.ease_property, origEase);
        lateSlide();
        assert.equal(completed, 1);
    }

    // Another extension may retain our wrapper while installing its own.
    // Disabled wrappers must delegate without adding backgrounds/animations.
    const extension = new Extension();
    extension.enable();
    const wrappedInit = MonitorGroup.prototype._init;
    const laterOverride = function (...args) { wrappedInit.call(this, ...args); };
    MonitorGroup.prototype._init = laterOverride;
    extension.disable();
    assert.equal(MonitorGroup.prototype._init, laterOverride);
    const group = new MonitorGroup();
    group._init({index: 0}, [0, 1], null);
    assert.equal(group.style, 'original');
    assert.equal(managers, 0);
    MonitorGroup.prototype._init = origInit;
});
