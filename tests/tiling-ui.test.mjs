import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Actor, loadModule} from './helpers/shell.mjs';

const root = 'tiling-assistant@leleat-on-github';
const presets = ['left-third', 'center-third', 'right-third', 'left-two-thirds', 'right-two-thirds'];

class Emitter extends Actor {
    connectObject(...args) {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2) {
            const id = this.connect(args[i], args[i + 1]);
            this.signals.get(id).owner = owner;
        }
    }
    disconnectObject(owner) {
        for (const [id, signal] of this.signals) {
            if (signal.owner === owner)
                this.disconnect(id);
        }
    }
}

async function setupPicker() {
    class Widget extends Emitter {
        _init(params) { Object.assign(this, params); }
        set_child(child) { this.add_child(child); }
        get_size() { return [this.width, this.height]; }
        get_preferred_width() { return [480, 480]; }
        get_preferred_height() { return [100, 100]; }
        get_theme_node() { return {get_padding: () => 0}; }
        set(values) { Object.assign(this, values); }
    }
    const display = new Emitter();
    display.get_current_monitor = () => 0;
    const global = new Emitter();
    global.display = display;
    global.workspace_manager = {get_active_workspace: () => ({
        get_work_area_for_monitor: () => ({x: 0, y: 32, width: 1920, height: 1048}),
    })};
    const layout = new Emitter();
    layout.monitors = [{x: 0, y: 0, width: 1920, height: 1080}];
    const tracked = new Set();
    layout.addChrome = actor => tracked.add(actor);
    layout.untrackChrome = actor => tracked.delete(actor);
    const {
        LayoutPicker,
        LayoutPickerTileType: types,
        LayoutPickerVisibility: visibilities,
    } = await loadModule(`${root}/src/extension/layoutPicker.js`, {
        globals: {global},
        mocks: {
            '../dependencies/gi.js': {
                Clutter: {Orientation: {HORIZONTAL: 0}, AnimationMode: {EASE_OUT_QUAD: 0}},
                GLib: {build_filenamev: values => values.join('/')},
                GObject: {registerClass: (meta, cls) => cls,
                    ParamSpec: {int() {}}, ParamFlags: {READWRITE: 1}},
                St: {Bin: Widget, BoxLayout: Widget, Icon: Widget, Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3}},
                Gio: {FileIcon: {new: file => file}, File: {new_for_path: path => path},
                    ThemedIcon: class {constructor(params) { Object.assign(this, params); }}},
            },
            '../dependencies/shell.js': {Main: {layoutManager: layout}},
            '../common.js': {Settings: {getExtension: () => ({path: root})}},
        },
    });
    const createPicker = () => {
        const picker = new LayoutPicker();
        picker._init();
        Object.values(picker._icons).forEach((icon, index) => {
            icon.set_position(index * 80, 0);
            icon.set_size(64, 64);
        });
        return picker;
    };
    return {types, visibilities, createPicker, global, display, layout, tracked};
}

test('every thirds shortcut is registered, has a schema entry, and is editable in preferences', async () => {
    const {Shortcuts} = await loadModule(`${root}/src/common.js`);
    const ui = await readFile(`${root}/src/ui/prefs.ui`, 'utf8');
    const schema = await readFile(`${root}/schemas/org.gnome.shell.extensions.tiling-assistant.gschema.xml`, 'utf8');
    for (const preset of presets) {
        for (const suffix of ['', '-ignore-ta']) {
            const key = `tile-${preset}${suffix}`;
            assert.ok(Shortcuts.getAllKeys().includes(key), `${key} is registered`);
            assert.match(schema, new RegExp(`<key name="${key}" type="as">`));
            assert.match(ui, new RegExp(`<object class="ShortcutListener" id="${key.replaceAll('-', '_')}">`),
                `${key} is configurable without gsettings commands`);
        }
    }
});

test('dragging across picker thirds selects all five presets with distinct available icons', async () => {
    const {types, createPicker} = await setupPicker();
    const picker = createPicker();
    const selections = [
        ['thirds', 1 / 6, types.LEFT_THIRD, 'tile-left-third'],
        ['thirds', 1 / 2, types.CENTER_THIRD, 'tile-center-third'],
        ['thirds', 5 / 6, types.RIGHT_THIRD, 'tile-right-third'],
        ['thirds', 1, types.RIGHT_THIRD, 'tile-right-third'],
        ['twoThirds', 1 / 4, types.LEFT_TWO_THIRDS, 'tile-left-two-thirds'],
        ['twoThirds', 3 / 4, types.RIGHT_TWO_THIRDS, 'tile-right-two-thirds'],
        ['horizontal', 1 / 4, types.LEFT, 'tile-left'],
        ['horizontal', 3 / 4, types.RIGHT, 'tile-right'],
    ];
    for (const [group, portion, type, name] of selections) {
        const icon = picker._icons[group];
        const [x, y] = icon.get_transformed_position();
        picker._updateLayoutPickerTileType(x + portion * icon.width, y + icon.height / 2);
        assert.equal(picker.tileType, type);
        assert.equal(icon.gicon.name, `${name}-symbolic`);
        assert.match(await readFile(icon.fallback_gicon, 'utf8'), /<svg/);
    }
    picker._updateLayoutPickerTileType(-100, -100);
    assert.equal(picker.tileType, types.NONE);
    picker.destroy();
});

test('picker instances own their icons and release global listeners when destroyed', async () => {
    const {types, createPicker, global, display, layout, tracked} = await setupPicker();
    const first = createPicker();
    const second = createPicker();
    first._setLayoutPickerIcon(types.LEFT_THIRD);
    assert.equal(first._icons.thirds.gicon.name, 'tile-left-third-symbolic');
    assert.equal(second._icons.thirds.gicon.name, 'tile-thirds-symbolic');
    first.destroy();
    second.destroy();
    for (const emitter of [global, display, layout])
        assert.equal(emitter.signals.size, 0);
    assert.equal(tracked.size, 0);
});

test('center-third in dynamic focus mode tiles directly without an undefined focus direction', async () => {
    const window = {isTiled: true, get_monitor: () => 0, get_work_area_current_monitor: () => ({})};
    let selected;
    const {default: Handler} = await loadModule(`${root}/src/extension/keybindingHandler.js`, {
        mocks: {
            '../dependencies/gi.js': {Clutter: {}, Meta: {}, Shell: {}, St: {}},
            '../dependencies/shell.js': {_: text => text, Main: {}},
            '../common.js': {Direction: {N: 1, S: 2, W: 3, E: 4}, DynamicKeybindings: {}, Settings: {}, Shortcuts: {}},
            './utility.js': {Rect: class {}, Util: {}},
            './tilingWindowManager.js': {TilingWindowManager: {
                getTopTileGroup: () => [window, {}],
                getNearestWindow() { assert.fail('a centered preset has no focus direction'); },
                getTileFor: shortcut => shortcut,
                toggleTiling: (target, rect) => { selected = {target, rect}; },
            }},
        },
    });
    Handler.prototype._dynamicFocus.call({}, window, 'tile-center-third');
    assert.equal(selected.target, window);
    assert.equal(selected.rect, 'tile-center-third');
});

test('picker initializes completely hidden and never leaks visibility during early session startup', async () => {
    const {visibilities, createPicker, display, layout} = await setupPicker();

    // Test 1: Standard initialization must be completely hidden and non-reactive
    const picker = createPicker();
    assert.equal(picker.visible, false, 'Picker must be invisible upon init');
    assert.equal(picker.opacity, 0, 'Picker must have opacity 0 upon init');
    assert.equal(picker.reactive, false, 'Picker must be non-reactive upon init');
    assert.equal(picker._visibility, visibilities.HIDDEN);

    // Test 2: Early session startup / reboot condition where display has no focused monitor (-1)
    display.get_current_monitor = () => -1;
    picker._updateAllocation(-1);
    assert.equal(picker.visible, false, 'Picker stays invisible when monitor is -1');
    assert.equal(picker.opacity, 0, 'Picker opacity remains 0 when monitor is -1');
    assert.equal(picker.reactive, false);

    // Test 3: Showing and hiding lifecycle
    picker._setVisibility(visibilities.PEAK);
    assert.equal(picker.visible, true);
    assert.equal(picker.opacity, 255);
    assert.equal(picker.reactive, true);

    picker._setVisibility(visibilities.HIDDEN);
    assert.equal(picker.reactive, false, 'Reactive should be disabled immediately when starting to hide');
    picker.complete('ease');
    assert.equal(picker.visible, false);
    assert.equal(picker.opacity, 0);
    assert.equal(picker.reactive, false);

    picker.destroy();
});

