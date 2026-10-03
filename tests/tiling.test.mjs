import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the installed extension's methods with small GNOME signal/actor fakes.
// These regressions do not start Shell, change settings or touch the live session.
const extensionRoot = new URL('../tilingshell@ferrarodomenico.com/', import.meta.url);
class Emitter {
  handlers = new Map();
  nextId = 1;
  connect(key, callback) {
    const id = this.nextId++;
    this.handlers.set(id, {key, callback});
    return id;
  }
  connect_after(...args) { return this.connect(...args); }
  disconnect(id) {
    assert.ok(this.handlers.delete(id), `handler ${id} must be disconnected exactly once`);
  }
  emit(key, ...args) {
    for (const [id, handler] of [...this.handlers])
      if (this.handlers.has(id) && handler.key === key) handler.callback(this, ...args);
  }
}
const baseMocks = {
  registerGObjectClass() {},
  logger: () => () => {},
  GObject: {
    Object: Emitter, ParamSpec: new Proxy({}, {get: () => () => ({})}),
    ParamFlags: {READWRITE: 1}, BindingFlags: {DEFAULT: 0},
  },
  Meta: {Window: {$gtype: 1}, Display: {$gtype: 2}, WindowType: {NORMAL: 0}},
  St: {DrawingArea: Emitter, Corner: {TOPLEFT: 0, TOPRIGHT: 1, BOTTOMLEFT: 2, BOTTOMRIGHT: 3}, Side: {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3}},
  Gio: {_promisify() {}},
  Shell: {Screenshot: {}},
  Extension: class {},
};
function load(path, names, mocks = {}) {
  const source = readFileSync(new URL(path, extensionRoot), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, {...baseMocks, ...mocks}, {filename: path});
}
const {SignalHandling} = load('utils/signalHandling.js', ['SignalHandling']);
const directions = {PREV: 2, NEXT: 1};
const json = value => JSON.parse(JSON.stringify(value));

test('signal tracker owns repeated names on different objects and selective handlers', () => {
  const tracker = new SignalHandling();
  const first = new Emitter();
  const second = new Emitter();
  const id = tracker.connect(first, 'changed', () => {});
  tracker.connect(first, 'changed', () => {});
  tracker.connect(second, 'changed', () => {});
  assert.equal(tracker.disconnect(first, id), true);
  assert.equal(first.handlers.size, 1);
  tracker.disconnect(first);
  assert.equal(first.handlers.size, 0);
  assert.equal(second.handlers.size, 1);
  tracker.disconnect();
  assert.equal(second.handlers.size, 0);
  assert.equal(tracker.disconnect(), false);
});

test('Raise Together disconnects every window and setting exactly once', () => {
  const settings = Object.assign(new Emitter(), {RAISE_TOGETHER: true, KEY_RAISE_TOGETHER: 'raise-together'});
  const display = new Emitter();
  const windows = [1, 2].map(id => Object.assign(new Emitter(), {get_id: () => id}));
  const {RaiseTogetherManager} = load('components/raiseTogether/raiseTogetherManager.js', ['RaiseTogetherManager'], {
    SignalHandling, Settings: settings, getWindows: () => windows, global: {display},
  });
  const manager = new RaiseTogetherManager();
  manager.enable();
  assert.equal(windows[0].handlers.size, 2);
  windows[0].emit('unmanaged');
  assert.equal(windows[0].handlers.size, 0);
  manager.destroy();
  assert.equal(windows[1].handlers.size, 0);
  assert.equal(display.handlers.size, 0);
  assert.equal(settings.handlers.size, 0);
});

test('destroyed keybinding manager cannot react to later setting changes', () => {
  const settings = Object.assign(new Emitter(), {ENABLE_MOVE_KEYBINDINGS: false, KEY_ENABLE_MOVE_KEYBINDINGS: 'keys'});
  const {KeyBindings} = load('keybindings.js', ['KeyBindings'], {SignalHandling, Settings: settings});
  const manager = new KeyBindings({});
  let removed = 0;
  manager._removeKeybindings = () => removed++;
  manager.destroy();
  assert.equal(removed, 1);
  assert.equal(settings.handlers.size, 0);
});

test('previous focus at the first window and excluded windows never indexes undefined', () => {
  let active;
  let windows;
  const settings = {WRAPAROUND_FOCUS: false};
  const {TilingShellExtension} = load('extension.js', ['TilingShellExtension'], {
    Settings: settings, FocusSwitchDirection: directions,
    filterUnfocusableWindows: () => windows,
    global: {get_current_time: () => 1},
  });
  const first = {has_focus: () => true, get_wm_class: () => 'app', get_transient_for: () => null,
    get_workspace: () => ({list_windows: () => windows}), activate: () => { active = 'first'; }};
  const second = {activate: () => { active = 'second'; }};
  const manager = Object.create(TilingShellExtension.prototype);
  windows = [first, second];
  const display = {get_focus_window: () => first};
  manager._onKeyboardFocusWin(display, directions.PREV);
  assert.equal(active, undefined);
  settings.WRAPAROUND_FOCUS = true;
  manager._onKeyboardFocusWin(display, directions.PREV);
  assert.equal(active, 'second');
  windows = [];
  assert.doesNotThrow(() => manager._onKeyboardFocusWin(display, directions.PREV));
});

test('monitor layout changes rebuild managers even when count remains the same', () => {
  const settings = new Emitter();
  const layoutManager = new Emitter();
  const display = new Emitter();
  const mutterSettings = [];
  class MockSettings extends Emitter { constructor() { super(); mutterSettings.push(this); } }
  let validated = 0;
  let builds = 0;
  let borderScaling;
  const {TilingShellExtension} = load('extension.js', ['TilingShellExtension'], {
    Settings: settings, SignalHandling,
    Main: {layoutManager}, global: {display}, Gio: {Settings: MockSettings},
    getMonitors: () => [{index: 0}, {index: 1}],
    GlobalState: {get: () => ({validate_selected_layouts: () => validated++})},
    OverriddenWindowMenu: new Emitter(),
    WindowBorderManager: class {constructor(scaling) { borderScaling = scaling; } enable() {}},
  });
  const manager = Object.create(TilingShellExtension.prototype);
  Object.assign(manager, {_signals: new SignalHandling(), _tilingManagers: [null, null], _keybindings: null,
    _createTilingManagers: () => builds++, _fractionalScalingEnabled: false,
    _isFractionalScalingEnabled: () => true});
  manager._setupSignals();
  layoutManager.emit('monitors-changed'); // Resolution/orientation/primary changes with two monitors.
  assert.equal(builds, 1);
  assert.equal(validated, 1);
  mutterSettings[0].emit('changed::experimental-features', mutterSettings[0]);
  assert.equal(borderScaling, false);
  manager._signals.disconnect();
  assert.equal(layoutManager.handlers.size, 0);
});

test('complementary resizing preserves coordinates left of and above the primary monitor', () => {
  const {ResizingManager} = load('components/tilingsystem/resizeManager.js', ['ResizingManager']);
  const manager = new ResizingManager();
  let moved;
  const other = {move_resize_frame: (...args) => { moved = args; }};
  manager._onResizingWindow({get_frame_rect: () => ({x: -1000, y: -500, width: 500, height: 400})},
    {x: -1000, y: -500, width: 400, height: 400}, 0, 1,
    [[other, {x: -600, y: -500, width: 400, height: 400}, -1, 3]]);
  assert.deepEqual(moved, [false, -500, -500, 300, 400]);
});

test('suggestion moves target monitor zero and use the correct shadow dimensions', () => {
  const actor = {get_x: () => -5, get_y: () => -10, show() {}, set_pivot_point() {}, set_position() {}, set_size() {}};
  let monitor;
  let animation;
  const {TilingShellWindowManager} = load('components/windowManager/tilingShellWindowManager.js', ['TilingShellWindowManager'], {
    Clutter: {Clone: class {ease(params) { animation = params; }}},
    Graphene: {Point: class {}}, global: {windowGroup: {add_child() {}}},
  });
  TilingShellWindowManager.easeMoveWindow({window: {
    get_compositor_private: () => actor, get_frame_rect: () => ({x: 0, y: 0}),
    move_to_monitor: index => { monitor = index; }, move_frame() {}, move_resize_frame() {},
  }, from: {x: 0, y: 0, width: 100, height: 100}, to: {x: 1, y: 2, width: 200, height: 300}, duration: 200, monitorIndex: 0});
  assert.equal(monitor, 0);
  assert.equal(animation.width, 210);
  assert.equal(animation.height, 320);
});

function tilingMocks() {
  const stage = new Emitter();
  const timers = new Map();
  let id = 0;
  const touch = {updateWindowPosition() {}, reset() {}};
  const mocks = {
    SignalHandling, Settings: {}, TouchPointer: {get: () => touch},
    global: {stage},
    GLib: {PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
      timeout_add: (_, duration, callback) => { timers.set(++id, callback); return id; },
      Source: {remove: id => assert.ok(timers.delete(id))}},
  };
  const {TilingManager} = load('components/tilingsystem/tilingManager.js', ['TilingManager'], mocks);
  const manager = Object.create(TilingManager.prototype);
  Object.assign(manager, {_grabSignals: new SignalHandling(), _signals: new SignalHandling(),
    _isGrabbingWindow: false, _movingWindowTimerId: null, _onMovingWindow: () => true,
    _workspaceTilingLayout: new Map(), _selectedTilesPreview: {close() {}}, _snapAssist: {close() {}},
    _snapAssistingInfo: {update() {}}, _edgeTilingManager: {abortEdgeTiling() {}}});
  const window = Object.assign(new Emitter(), {get_frame_rect: () => ({x: 0, y: 0}),
    get_monitor: () => 0, windowType: 0, get_transient_for: () => null, is_attached_dialog: () => false});
  return {mocks, manager, stage, timers, window};
}

test('repeated drags release stage callbacks and timers immediately, including window closure', () => {
  const {manager, stage, timers, window} = tilingMocks();
  for (let i = 0; i < 3; i++) {
    manager._onWindowGrabBegin(window, 1);
    assert.equal(stage.handlers.size, 2);
    assert.equal(timers.size, 1);
    manager._stopWindowGrab();
    assert.equal(stage.handlers.size, 0);
    assert.equal(timers.size, 0);
    assert.equal(window.handlers.size, 0);
  }
  manager._onWindowGrabBegin(window, 1);
  window.emit('unmanaged');
  assert.equal(stage.handlers.size, 0);
  assert.equal(timers.size, 0);
});

test('pending auto tiling is cancelled on disable and first-frame callbacks fire once', () => {
  const {mocks, window} = tilingMocks();
  mocks.Settings.ENABLE_AUTO_TILING = true;
  const {TilingManager} = load('components/tilingsystem/tilingManager.js', ['TilingManager'], mocks);
  const manager = Object.create(TilingManager.prototype);
  let tiled = 0;
  Object.assign(manager, {_monitor: {index: 0}, _signals: new SignalHandling(),
    _findEmptyTile: () => ({}), _easeWindowRectFromTile: () => tiled++});
  const actor = new Emitter();
  window.get_compositor_private = () => actor;
  manager._autoTile(window, true);
  assert.equal(actor.handlers.size, 2);
  manager._signals.disconnect();
  actor.emit('first-frame');
  assert.equal(tiled, 0);
  manager._autoTile(window, true);
  actor.emit('first-frame');
  actor.emit('first-frame');
  assert.equal(tiled, 1);
  assert.equal(actor.handlers.size, 0);
  window.get_compositor_private = () => null;
  assert.doesNotThrow(() => manager._autoTile(window, true));
});

test('invalid and deleted layouts fall back on every monitor', () => {
  const ws = {index: () => 0};
  let selected = [['missing', 'deleted']];
  const settings = {get_selected_layouts: () => selected, save_selected_layouts: value => { selected = value; }, save_layouts_json() {}};
  const {GlobalState} = load('utils/globalState.js', ['GlobalState'], {
    Settings: settings, Main: {layoutManager: {monitors: [{}, {}], primaryIndex: 0}},
    global: {workspaceManager: {get_n_workspaces: () => 1, get_workspace_by_index: () => ws}},
  });
  const state = Object.create(GlobalState.prototype);
  Object.assign(state, {_layouts: [{id: 'default'}, {id: 'deleted'}], _selected_layouts: new Map(), emit() {}});
  state.validate_selected_layouts();
  assert.deepEqual(json(selected), [['default', 'deleted']]);
  state.deleteLayout({id: 'deleted'});
  assert.deepEqual(json(selected), [['default', 'default']]);
  selected = [];
  assert.equal(state.getSelectedLayoutOfMonitor(1, 5).id, 'default');
});

test('ALT+TAB window groups release unmanaged callbacks when the popup is destroyed', () => {
  const windows = [new Emitter(), new Emitter()];
  const {MetaWindowGroup} = load('components/altTab/MetaWindowGroup.js', ['MetaWindowGroup'], {SignalHandling});
  const group = new MetaWindowGroup(windows);
  assert.equal(windows[0].handlers.size, 1);
  group.destroy();
  assert.equal(windows[0].handlers.size, 0);
  assert.equal(windows[1].handlers.size, 0);
});

test('smart border capture closes the stream and ignores a result for the previous window', async () => {
  let finish;
  let closed = 0;
  const {WindowBorder} = load('components/windowBorder/windowBorder.js', ['WindowBorder'], {
    Gio: {_promisify() {}, MemoryOutputStream: {new_resizable: () => ({close: () => closed++})}},
    Shell: {Screenshot: {composite_to_stream: () => new Promise(resolve => { finish = resolve; })}},
    buildRectangle: params => params,
  });
  const border = Object.create(WindowBorder.prototype);
  const actor = {paint_to_content: () => ({get_texture: () => ({})})};
  const window = {get_compositor_private: () => actor, get_frame_rect: () => ({x: 0, y: 0, height: 10})};
  Object.assign(border, {_destroyed: false, _radiusGeneration: 1, _window: window, _borderRadiusValue: [11, 11, 0, 0]});
  const capture = border._computeBorderRadius(actor, window, 1);
  border._window = {};
  border._radiusGeneration++;
  finish({get_pixels() { throw new Error('stale result must never be read'); }});
  await capture;
  assert.equal(closed, 1);
  assert.equal(window.__ts_cached_radius, undefined);
  assert.deepEqual(border._borderRadiusValue, [11, 11, 0, 0]);
});

test('a drag with no available workspace layout creates no orphan timeout', () => {
  const {manager, timers, window, stage} = tilingMocks();
  manager._onMovingWindow = () => false;
  manager._onWindowGrabBegin(window, 1);
  assert.equal(timers.size, 0);
  manager._stopWindowGrab();
  assert.equal(stage.handlers.size, 0);
});

test('window border toggles release the interface accent-color handler', () => {
  const settings = Object.assign(new Emitter(), {ENABLE_WINDOW_BORDER: true});
  const display = new Emitter();
  const interfaces = [];
  const {WindowBorderManager} = load('components/windowBorder/windowBorderManager.js', ['WindowBorderManager'], {
    SignalHandling, Settings: settings, global: {display},
    Gio: {Settings: class extends Emitter {constructor() {super(); interfaces.push(this);}}},
  });
  const manager = new WindowBorderManager(false);
  manager.enable();
  assert.equal(interfaces[0].handlers.size, 1);
  manager.destroy();
  assert.equal(interfaces[0].handlers.size, 0);
  assert.equal(display.handlers.size, 0);
});

test('monitor-name subprocess and late completion are cancelled after menu destruction', () => {
  let callback;
  let killed = 0;
  const process = {communicate_utf8_async: (_, cancellable, fn) => {callback = fn;},
    force_exit: () => killed++, communicate_utf8_finish: () => {throw new Error('cancelled');}};
  class Cancellable {cancelled = false; cancel() {this.cancelled = true;} is_cancelled() {return this.cancelled;}}
  const {DefaultMenu} = load('indicator/defaultMenu.js', ['DefaultMenu'], {
    St: {...baseMocks.St, BoxLayout: Emitter}, SignalHandling,
    getMonitors: () => [{}, {}], Gio: {Subprocess: {new: () => process}, SubprocessFlags: {}, Cancellable},
  });
  const menu = Object.create(DefaultMenu.prototype);
  Object.assign(menu, {_destroyed: false, _monitorDetailsProcess: null, _monitorDetailsCancellable: null,
    _indicator: {path: '/unused'}, _layoutsRows: [], _children: [], _signals: new SignalHandling(),
    _get_display_name: () => undefined});
  menu._computeMonitorsDetails();
  const cancellable = menu._monitorDetailsCancellable;
  menu.destroy();
  assert.equal(killed, 1);
  assert.equal(cancellable.is_cancelled(), true);
  assert.doesNotThrow(() => callback(process, {}));
});

test('settings containing only empty layouts recover before managers dereference layouts[0]', () => {
  let stored = '[{"id":"empty","tiles":[]}]';
  const {Settings} = load('settings/settings.js', ['Settings']);
  Settings._settings = {get_string: () => stored};
  Settings.reset_layouts_json = () => {stored = '[{"id":"default","tiles":[{}]}]';};
  assert.equal(Settings.get_layouts_json()[0].id, 'default');
});

test('complementary resize never includes an adjacent window on a different monitor', () => {
  const own = {assignedTile: {}, get_monitor: () => 1, get_frame_rect: () => ({copy: () => ({})})};
  const foreign = {assignedTile: {}, get_monitor: () => 0};
  const target = Object.assign(new Emitter(), {assignedTile: {}, get_monitor: () => 1, get_frame_rect: () => ({copy: () => ({})})});
  let candidates;
  const {ResizingManager} = load('components/tilingsystem/resizeManager.js', ['ResizingManager'], {
    SignalHandling, Settings: {}, getWindows: () => [own, foreign], Meta: {GrabOp: {RESIZING_E: 1}},
  });
  const manager = new ResizingManager();
  manager._signals = new SignalHandling();
  manager._findAdjacent = (window, side, remaining) => { candidates = [...remaining]; return []; };
  manager._onWindowResizingBegin(target, 1);
  assert.deepEqual(candidates, [own]);
  manager.destroy();
});
