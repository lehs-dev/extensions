import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {loadModule} from './helpers/shell.mjs';

async function setup() {
    const root = 'tiling-assistant@custom';
    class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return Boolean(this.cancelled); }
    }
    class Variant {
        constructor(type, value) { this.value = value; }
        static new_maybe() { return new Variant('mb', null); }
        deepUnpack() { return this.value; }
    }
    class GioSettings {
        constructor({schema_id}) { this.schemaId = schema_id; }
        get_strv() { return []; }
        get_user_value() { return null; }
        set_value() {}
        reset() {}
    }
    const settings = {initialize() {}, destroy() {}, reset() {},
        getUserValue: () => null, getValue: () => new Variant('a{sv}', {}),
        setValue() {}, getStrv: () => [], setInt() {}};
    const twm = {initialize() {}, destroy() {}};
    const originalPanel = () => 'native';
    const Main = {panel: {_getDraggableWindowForPosition: originalPanel}, sessionMode: {isLocked: false}};
    const Util = {initialize: async () => {}, destroy() {}};
    let loadContents;
    const Gio = {_promisify() {}, File: class {}, Settings: GioSettings, Cancellable};
    Gio.File.new_for_path = () => ({load_contents_async: () => loadContents()});
    const GLib = {Variant, VariantType: class {}, get_user_config_dir: () => '/tmp',
        build_filenamev: parts => parts.join('/')};
    const mocks = {
        './src/dependencies/gi.js': {Gio, GLib, Meta: {TabList: {NORMAL: 0}}},
        './src/dependencies/shell.js': {Extension: class {}, Main},
        './src/extension/utility.js': {Rect: class {}, Util},
        [resolve(root, 'src/common.js')]: {Settings: settings},
        [resolve(root, 'src/extension/tilingWindowManager.js')]: {TilingWindowManager: twm},
    };
    for (const name of ['moveHandler', 'resizeHandler', 'keybindingHandler', 'layoutsManager', 'altTab', 'focusHint'])
        mocks[`./src/extension/${name}.js`] = {default: class {destroy() {}}};
    const {default: Extension} = await loadModule(`${root}/extension.js`, {
        mocks, globals: {global: {display: {get_tab_list: () => []}}},
    });
    const extension = new Extension();
    extension.getSettings = () => ({});
    extension.metadata = {version: 56};
    return {extension, Main, originalPanel, settings, Cancellable,
        setLoad: fn => { loadContents = fn; }};
}

test('disable while the first dynamic import is pending preserves the native panel method', async () => {
    const {extension, Main, originalPanel} = await setup();
    const enabling = extension.enable();
    extension.disable();
    await enabling;
    assert.equal(Main.panel._getDraggableWindowForPosition, originalPanel);
    assert.equal(extension.settings, null);
});

test('disable while session restoration is pending cannot resume on destroyed settings', async () => {
    const {extension} = await setup();
    let finish;
    let restoring;
    const started = new Promise(resolve => { restoring = resolve; });
    extension._loadAfterSessionLock = () => {
        restoring();
        return new Promise(resolve => { finish = resolve; });
    };
    const enabling = extension.enable();
    await started;
    extension.disable();
    finish();
    await enabling;
    assert.equal(extension.settings, null);
});

test('disable preserves a panel override installed by another extension', async () => {
    const {extension, Main} = await setup();
    await extension.enable();
    const replacement = () => 'other extension';
    Main.panel._getDraggableWindowForPosition = replacement;
    extension.disable();
    assert.equal(Main.panel._getDraggableWindowForPosition, replacement);
});

test('a cancelled restore ignores data returned by an outstanding file read', async () => {
    const {extension, Cancellable, setLoad} = await setup();
    let finish;
    setLoad(() => new Promise(resolve => { finish = resolve; }));
    extension._wasLocked = true;
    let writes = 0;
    extension._twm = {setTileGroups: () => writes++, setTileStates: () => writes++};
    const cancellable = new Cancellable();
    const restoring = extension._loadAfterSessionLock(cancellable);
    cancellable.cancel();
    finish([new TextEncoder().encode('{"tileGroups":{},"windows":{}}')]);
    await restoring;
    assert.equal(writes, 0);
});
