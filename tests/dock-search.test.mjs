import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const dockDir = 'dash2dock-lite@icedman.github.com/';
const searchDir = 'search-light@icedman.github.com/';
const quiet = {log() {}, error() {}};
class Actor {}
const registeredClass = (...args) => args.at(-1);

function source(path, names, mocks = {}) {
  let code = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  code = code.replace(/^import\b[\s\S]*?;\s*$/gm, '');
  code = code.replace(/export default class/g, 'class').replace(/\bexport (const|let|class)\b/g, '$1');
  const context = vm.createContext({
    console: quiet, TextDecoder, GObject: {registerClass: registeredClass, Object: class {}},
    Extension: class {}, St: {Widget: Actor, DrawingArea: Actor},
    Graphene: {Point: class {}}, Clutter: {}, Main: {}, ...mocks,
  });
  vm.runInContext(code, context, {filename: path});
  return Object.fromEntries(names.map(name => [name, vm.runInContext(name, context)]));
}

function timerHarness(dir) {
  const active = new Map();
  let id = 0;
  const GLib = {
    PRIORITY_DEFAULT: 0,
    timeout_add(priority, interval, callback) {
      active.set(++id, callback);
      return id;
    },
    source_remove(sourceId) {active.delete(sourceId);},
  };
  const {Timer} = source(dir + 'timer.js', ['Timer'], {GLib});
  const timer = new Timer('test');
  timer.initialize(15);
  return {timer, active, tick() {timer.onUpdate();}};
}

for (const dir of [dockDir, searchDir]) {
  test(dir + ' timer cancels callbacks and drops subscribers on shutdown', () => {
    const {timer, active, tick} = timerHarness(dir);
    let count = 0;
    timer.runOnce(() => timer.shutdown(), 15);
    timer.runOnce(() => count++, 15);
    tick();
    assert.equal(count, 0);
    assert.equal(timer._subscribers.length, 0);
    assert.equal(active.size, 0);
    timer.initialize(15);
    timer.runOnce(() => count++, 15);
    tick();
    assert.equal(count, 1);
  });

  test(dir + ' one failing callback does not starve other callbacks', () => {
    const {timer, tick} = timerHarness(dir);
    let count = 0;
    timer.runOnce(() => {throw new Error('callback failed');}, 15);
    timer.runOnce(() => count++, 15);
    tick();
    assert.equal(count, 1);
    assert.equal(timer._subscribers.length, 0);
    timer.shutdown();
  });

  test(dir + ' timer skips callbacks cancelled during an update', () => {
    const {timer, tick} = timerHarness(dir);
    let count = 0;
    let pending;
    timer.runOnce(() => timer.cancel(pending), 15);
    pending = timer.runOnce(() => count++, 15);
    tick();
    assert.equal(count, 0);
    timer.shutdown();
  });

  test(dir + ' monitor snapshots replace old state and ignore stale replies', () => {
    let proxy;
    class Proxy {
      constructor() {proxy = this; this.callbacks = [];}
      connectSignal(name, callback) {this.changed = callback; return 1;}
      disconnectSignal(id) {assert.equal(id, 1); this.disconnected = true;}
      GetCurrentStateRemote(callback) {this.callbacks.push(callback);}
    }
    const {MonitorsConfig} = source(dir + 'monitors.js', ['MonitorsConfig'], {
      Gio: {DBus: {session: {}}, DBusProxy: {makeProxyWrapper: () => Proxy}},
      GObject: {registerClass: registeredClass, Object: class {emit() {}}},
      logError() {},
    });
    const config = new MonitorsConfig();
    assert.equal(config.monitors.length, 0);
    const resources = connector => {
      const spec = [connector, 'vendor', 'model', 'serial'];
      return [1, [[spec, [], {}]], [[0, 0, 1, 0, true, [spec], {}]], {}];
    };
    proxy.callbacks.shift()(resources('HDMI-1'), null);
    assert.equal(config.monitors.length, 1);
    assert.equal(config.monitors[0].displayName, 'HDMI-1');
    proxy.changed();
    proxy.changed();
    const old = proxy.callbacks.shift();
    proxy.callbacks.shift()(resources('eDP-1'), null);
    old(resources('HDMI-1'), null);
    assert.equal(config.monitors.length, 1);
    assert.equal(config.primaryMonitor.connector, 'eDP-1');
    proxy.changed();
    const late = proxy.callbacks.shift();
    config.destroy();
    late(resources('HDMI-1'), null);
    config.destroy();
    assert.equal(config.monitors.length, 0);
    assert.equal(proxy.disconnected, true);
  });

  test(dir + ' reconnecting settings releases old signal handlers', () => {
    const {PrefKeys} = source(dir + 'preferences/prefKeys.js', ['PrefKeys'], {GLib: {}});
    const keys = new PrefKeys();
    keys.setKey('enabled', false, 'switch');
    let nextId = 0;
    const signals = new Set();
    const settings = {
      get_boolean: () => true,
      connect() {signals.add(++nextId); return nextId;},
      disconnect(id) {assert.ok(signals.delete(id));},
    };
    keys.connectSettings(settings);
    keys.connectSettings(settings);
    assert.equal(signals.size, 1);
    keys.disconnectSettings();
    assert.equal(signals.size, 0);
  });

  test(dir + ' monitor preferences follow logical rather than physical order', () => {
    let reply;
    class Proxy {
      connectSignal() {return 1;}
      disconnectSignal() {}
      GetCurrentStateRemote(callback) {reply = callback;}
    }
    const {MonitorsConfig} = source(dir + 'monitors.js', ['MonitorsConfig'], {
      Gio: {DBus: {session: {}}, DBusProxy: {makeProxyWrapper: () => Proxy}},
      GObject: {registerClass: registeredClass, Object: class {emit() {}}},
    });
    const config = new MonitorsConfig();
    const laptop = ['eDP-1', 'vendor', 'model', 'internal'];
    const external = ['HDMI-1', 'vendor', 'model', 'external'];
    const inactive = ['DP-1', 'vendor', 'model', 'inactive'];
    reply([1, [[laptop, [], {}], [inactive, [], {}], [external, [], {}]], [
      [0, 0, 1, 0, true, [external], {}], [1920, 0, 1, 0, false, [laptop], {}],
    ], {}], null);
    assert.deepEqual(Array.from(config.activeMonitors, m => m.connector), ['HDMI-1', 'eDP-1']);
    config.destroy();
  });
}

function dockExtensionHarness() {
  const Main = {layoutManager: {
    monitors: [{index: 0, x: 0, y: 0}, {index: 1, x: 1920, y: 0}],
    primaryIndex: 1,
  }};
  const destroyed = [];
  class Dock {
    constructor() {
      this.struts = {destroy() {}};
      this.dwell = {destroy() {}};
    }
    dock() {this.initialMonitor = this._monitorIndex;}
    undock() {}
    cancelAnimations() {}
    destroyDash() {}
    destroy() {destroyed.push(this);}
  }
  const {Dash2DockLiteExt} = source(dockDir + 'extension.js', ['Dash2DockLiteExt'], {Main, Dock});
  const ext = new Dash2DockLiteExt();
  Object.assign(ext, {_config: {}, docks: [], multi_monitor_preference: 1, services: {}});
  return {Main, ext, destroyed};
}

test('docks are created once per monitor and fully destroyed on hotplug', () => {
  const {ext, Main, destroyed} = dockExtensionHarness();
  ext.createTheDocks();
  ext.createTheDocks();
  assert.equal(ext.docks.length, 2);
  assert.deepEqual(Array.from(ext.docks, d => d.initialMonitor), [0, 1]);
  Main.layoutManager.monitors.pop();
  ext.createTheDocks();
  assert.equal(ext.docks.length, 1);
  assert.equal(destroyed.length, 2);
  assert.deepEqual(Array.from(ext.listeners), [ext.services, ext.docks[0]]);
});

test('configured dock selects its matching monitor without a ReferenceError', () => {
  const {ext} = dockExtensionHarness();
  ext._config = {docks: [{monitor: {x: 1920, y: 0}, position: 'left'}]};
  ext.createTheDocks();
  ext.createTheDocks();
  assert.equal(ext.docks.length, 1);
  assert.equal(ext.docks[0].initialMonitor, 1);
  assert.equal(ext.docks[0]._config.position, 'left');
});

test('configuration reads finishing after disable cannot modify the extension', async () => {
  let reply;
  let stylesheetLoads = 0;
  const Gio = {File: {new_for_path: path => ({
    query_exists: () => path.endsWith('config.json') || path.endsWith('style.css'),
  })}};
  const theme = {load_stylesheet() {stylesheetLoads++;}, unload_stylesheet() {}};
  const {Dash2DockLiteExt} = source(dockDir + 'extension.js', ['Dash2DockLiteExt'], {
    Gio, global: {stage: {}}, St: {ThemeContext: {get_for_stage: () => ({get_theme: () => theme})}},
    loadFile: () => new Promise(resolve => {reply = resolve;}),
  });
  const ext = new Dash2DockLiteExt();
  const pending = ext._loadConfig();
  ext._unloadConfig();
  reply('{"icon-size": 128}');
  await pending;
  assert.equal(ext._config['icon-size'], undefined);
  assert.equal(stylesheetLoads, 0);
});

test('primary and explicit monitor choices work when HDMI is unplugged', () => {
  const {ext, Main} = dockExtensionHarness();
  ext.multi_monitor_preference = 0;
  ext.preferred_monitor = 0;
  assert.equal(ext._queryDisplay(), 1);
  ext.preferred_monitor = 1;
  assert.equal(ext._queryDisplay(), 0);
  ext.preferred_monitor = 2;
  assert.equal(ext._queryDisplay(), 1);
  Main.layoutManager.monitors = [{index: 0, x: 0, y: 0}];
  Main.layoutManager.primaryIndex = 0;
  assert.equal(ext._queryDisplay(), 0);
});

test('window switching activates the destination workspace', () => {
  let destinationActivations = 0;
  const activeWorkspace = {activate_with_focus() {throw new Error('wrong workspace');}};
  const destination = {activate_with_focus(window, timestamp) {
    assert.equal(timestamp, 100); destinationActivations++;
  }};
  const {Dock} = source(dockDir + 'dock.js', ['Dock'], {
    global: {workspace_manager: {get_active_workspace: () => activeWorkspace}, get_current_time: () => 100},
  });
  Dock.prototype._raiseAndFocus.call({}, {get_workspace: () => destination});
  assert.equal(destinationActivations, 1);
});

test('rectangle hit testing works with default padding', () => {
  const {isInRect} = source(dockDir + 'utils.js', ['isInRect'], {GLib: {}, Gio: {}});
  assert.equal(isInRect([0, 0, 100, 40], [50, 20]), true);
  assert.equal(isInRect([0, 0, 100, 40], [100, 20]), false);
});

test('panel backgrounds stay in dock coordinates on a secondary monitor', () => {
  const {DockBackground} = source(dockDir + 'dockItems.js', ['DockBackground'], {
    PopupMenu: {PopupMenu: class {}}, DashIcon: Actor, DashItemContainer: Actor,
  });
  const background = new DockBackground();
  const first = {_icon: {translationX: 0, translationY: 0}};
  const last = {_icon: {translationX: 0, translationY: 0}};
  const dock = {
    x: 1920, y: 950, width: 1920, height: 130, isVertical: () => false,
    extension: {dock_padding: 0},
    dash: {get_transformed_position: () => [2100, 1000], width: 150, height: 64},
  };
  background.update({first, last, iconSize: 64, scaleFactor: 1, panel_mode: true, dock});
  assert.equal(background.x, 0);
  assert.equal(background.width, dock.width);
  dock.isVertical = () => true;
  dock.y = -1200;
  background.update({first, last, iconSize: 64, scaleFactor: 1, vertical: true, panel_mode: true, dock});
  assert.equal(background.y, 0);
  assert.equal(background.height, dock.height);
});

test('each monitor autohider owns and disconnects its window tracking', () => {
  const owners = new Set();
  const window = {
    connectObject(...args) {owners.add(args.at(-1));},
    disconnectObject(owner) {assert.ok(owners.delete(owner));},
  };
  const {AutoHide} = source(dockDir + 'autohide.js', ['AutoHide'], {
    Meta: {WindowType: {NORMAL: 0, DIALOG: 4, MODAL_DIALOG: 5, UTILITY: 9}},
  });
  const first = new AutoHide();
  const second = new AutoHide();
  const timer = {cancel() {}};
  for (const hide of [first, second]) {
    Object.assign(hide, {extension: {_hiTimer: timer, _loTimer: timer},
      dock: {_monitor: {inFullscreen: false}, slideIn() {}}});
    hide.enable();
    hide._track(window);
  }
  assert.equal(owners.size, 2);
  second.disable();
  assert.equal(owners.size, 1);
  first.disable();
  assert.equal(owners.size, 0);
});

test('autohide tests window-type values and excludes dock windows', () => {
  const {isInRect, isOverlapRect} = source(dockDir + 'utils.js', ['isInRect', 'isOverlapRect'], {GLib: {}, Gio: {}});
  const types = {NORMAL: 0, DIALOG: 20, MODAL_DIALOG: 30, UTILITY: 40};
  let type = types.DIALOG;
  const window = {
    can_close: () => true, get_monitor: () => 1,
    get_workspace: () => ({index: () => 0}), showing_on_its_workspace: () => true,
    get_window_type: () => type, get_frame_rect: () => ({x: 0, y: 0, width: 100, height: 40}),
    connectObject() {},
  };
  const {AutoHide} = source(dockDir + 'autohide.js', ['AutoHide'], {
    Meta: {WindowType: types}, isInRect, isOverlapRect,
    global: {get_pointer: () => [9000, 9000], get_window_actors: () => [{get_meta_window: () => window}],
      workspace_manager: {get_active_workspace_index: () => 0}},
  });
  const hide = new AutoHide();
  hide.extension = {autohide_dash: true, autohide_dodge: true};
  hide.dock = {_monitor: {index: 1}, _isWithinDash: () => false,
    struts: {get_transformed_position: () => [0, 0], width: 100, height: 40}};
  assert.equal(hide._checkOverlap(), true);
  type = 1;
  assert.equal(hide._checkOverlap(), false);
});

function servicesHarness({infos = [], nextError = null, exists = true} = {}) {
  let offset = 0;
  let closes = 0;
  let iconLookups = 0;
  let syncCalls = 0;
  const enumerator = {
    next_files_async(count, priority, cancellable, callback) {
      const batch = infos.slice(offset, offset += count);
      queueMicrotask(() => callback(this, batch));
    },
    next_files_finish(batch) {if (nextError) throw nextError; return batch;},
    close_async(priority, cancellable, callback) {closes++; queueMicrotask(() => callback(this, true));},
    close_finish() {},
    next_file() {syncCalls++; throw new Error('synchronous scan');},
  };
  const directory = {
    get_path: () => '/localized/downloads', query_exists: () => exists,
    enumerate_children_async(attrs, flags, priority, cancellable, callback) {
      queueMicrotask(() => callback(this, enumerator));
    },
    enumerate_children_finish: result => result,
    enumerate_children() {syncCalls++; throw new Error('synchronous enumeration');},
    monitor() {throw new Error('monitor unavailable');},
  };
  class Cancellable {
    cancel() {this.cancelled = true;}
  }
  const Gio = {File: {new_for_path: () => directory}, Cancellable,
    FileQueryInfoFlags: {NONE: 0}, FileMonitorFlags: {WATCH_MOVES: 1},
    FILE_ATTRIBUTE_TIME_MODIFIED: 'time::modified'};
  const GLib = {PRIORITY_DEFAULT: 0, UserDirectory: {DIRECTORY_DOWNLOAD: 2},
    get_user_special_dir: () => '/localized/downloads', get_home_dir: () => '/home/user',
    build_filenamev: values => values.join('/')};
  const {Services} = source(dockDir + 'services.js', ['Services'], {Gio, GLib});
  const service = new Services();
  service.extension = {max_recent_items: 0, lookup_icon_from_names() {iconLookups++; return 'file';},
    _loTimer: {runDebounced() {}, cancel() {}}};
  return {service, directory, stats: () => ({closes, iconLookups, syncCalls})};
}

test('large download folders scan asynchronously and retain only the newest items', async () => {
  const infos = Array.from({length: 1000}, (_, index) => ({
    get_name: () => 'file-' + index, get_attribute_uint64: () => index,
    get_content_type: () => null, get_icon: () => ({get_names: () => ['text-file']}),
  }));
  const {service, stats} = servicesHarness({infos});
  const [items, total] = await service.checkRecentFilesInFolder('/localized/downloads');
  assert.equal(total, 1000);
  assert.deepEqual(Array.from(items, item => item.name), ['file-999', 'file-998', 'file-997', 'file-996', 'file-995']);
  assert.equal(items[0].type, 'application/octet-stream');
  assert.deepEqual(stats(), {closes: 1, iconLookups: 5, syncCalls: 0});
});

test('failed or cancelled directory scans still close the enumerator', async () => {
  const {service, stats} = servicesHarness({nextError: new Error('cancelled')});
  await assert.rejects(service.checkRecentFilesInFolder('/localized/downloads'), /cancelled/);
  assert.equal(stats().closes, 1);
});

test('download scan results cannot arrive after disable or overwrite a newer scan', async () => {
  const {service, directory} = servicesHarness();
  service._downloadsDir = directory;
  service._enabled = true;
  const replies = [];
  service.checkRecentFilesInFolder = () => new Promise(resolve => replies.push(resolve));
  const old = service.checkDownloads();
  const latest = service.checkDownloads();
  replies[1]([['latest'], 1]);
  await latest;
  replies[0]([['old'], 1]);
  await old;
  assert.deepEqual(service._downloadFiles, ['latest']);
  service._volumeMonitor = {disconnectObject() {}};
  const pending = service.checkDownloads();
  service.disable();
  replies[2]([['disabled'], 1]);
  await pending;
  assert.deepEqual(service._downloadFiles, ['latest']);
});

test('missing download directory does not break enable or monitoring cleanup', () => {
  const {service} = servicesHarness({exists: false});
  service.setupDownloads();
  assert.equal(service._downloadFiles.length, 0);
  assert.equal(service._downloadFilesLength, 0);
  service._volumeMonitor = {disconnectObject() {}};
  service.disable();
});

test('mounted volumes preserve distinct names', () => {
  const {service} = servicesHarness();
  const mount = name => ({get_drive: () => null, get_volume: () => null,
    get_default_location: () => ({get_basename: () => name}), get_name: () => name});
  assert.equal(service._getMountName(mount('disk-one')), 'disk-one');
  assert.equal(service._getMountName(mount('disk-two')), 'disk-two');
});

class Emitter {
  constructor() {this.owners = new Map(); this.nextId = 0;}
  connectObject(...args) {
    const owner = args.at(-1);
    this.owners.set(owner, [...(this.owners.get(owner) || []), ...args.slice(0, -1)]);
  }
  disconnectObject(owner) {this.owners.delete(owner);}
  connect() {return ++this.nextId;}
  disconnect() {}
}
class FakeActor extends Emitter {
  constructor() {
    super(); this.children = []; this.classes = new Set(); this.width = 100; this.height = 50;
  }
  get_parent() {return this.parent || null;}
  get_children() {return this.children;}
  add_child(child) {this.children.push(child); child.parent = this;}
  insert_child_at_index(child, index) {this.children.splice(index, 0, child); child.parent = this;}
  remove_child(child) {
    const index = this.children.indexOf(child); assert.ok(index >= 0);
    this.children.splice(index, 1); child.parent = null;
  }
  add_style_class_name(name) {this.classes.add(name);}
  remove_style_class_name(name) {this.classes.delete(name);}
  remove_all_transitions() {this.transition = null;}
  ease(params) {this.transition = params;}
  show() {this.visible = true;}
  hide() {this.visible = false;}
  grab_key_focus() {}
  destroy() {this.destroyed = true; for (const child of this.children) child.destroy();}
}

function searchHarness() {
  const parent = new FakeActor();
  const before = new FakeActor();
  const entry = new FakeActor();
  const search = new FakeActor();
  const after = new FakeActor();
  for (const actor of [before, entry, search, after]) parent.add_child(actor);
  const text = new FakeActor();
  entry.add_child(text);
  search._text = text;
  search._searchCancelled = function originalCancel() {};
  search._searchResults = new FakeActor();
  search._searchResults.activateDefault = function originalActivate() {};
  const overview = Object.assign(new Emitter(), {searchEntry: entry, searchController: search,
    visible: false, toggle() {}, hide() {}});
  const oldToggle = overview.toggle;
  const oldHide = overview.hide;
  const display = new Emitter();
  const stage = new Emitter();
  const appSystem = new Emitter();
  const layout = Object.assign(new Emitter(), {
    monitors: [{index: 0, x: 0, y: 0, width: 1920, height: 1200},
      {index: 1, x: 1920, y: 0, width: 1920, height: 1080}],
    primaryIndex: 1, removeChrome() {},
  });
  layout.primaryMonitor = layout.monitors[1];
  let unredirect = 0;
  const {SearchLightExt} = source(searchDir + 'extension.js', ['SearchLightExt'], {
    Main: {overview, layoutManager: layout}, Shell: {AppSystem: {get_default: () => appSystem}},
    Clutter: {AnimationMode: {EASE_OUT: 1}},
    St: {Widget: Actor, ThemeContext: {get_for_stage: () => ({scale_factor: 1})}},
    global: {display, stage, get_pointer: () => [1920, 500], compositor: {
      disable_unredirect() {unredirect++;}, enable_unredirect() {unredirect--;},
    }},
  });
  const {timer, tick} = timerHarness(searchDir);
  const ext = new SearchLightExt();
  Object.assign(ext, {
    _eventOwner: {}, _settings: {set_int() {}}, _settingsKeys: {disconnectSettings() {}},
    _desktopSettings: {disconnectObject() {}}, _style: {unloadAll() {}},
    mainContainer: new FakeActor(), container: new FakeActor(), _hiTimer: timer, _loTimer: timer,
    _useAnimations: true, _animationSpeed: 100, _updateCss() {},
    _layout() {this._queryDisplay(); this.width = 600; this.height = 400; this._visible = true;},
  });
  ext.mainContainer.add_child(ext.container);
  overview.connectObject('showing', () => {}, ext);
  display.connectObject('window-created', () => {}, ext);
  appSystem.connectObject('app-state-changed', () => {}, ext);
  return {ext, overview, entry, search, parent, before, after, oldToggle, oldHide,
    stage, display, appSystem, layout, tick, unredirect: () => unredirect};
}

test('Search Light show/hide retains permanent signals and cancels delayed opening', () => {
  const h = searchHarness();
  h.ext.show();
  assert.equal(h.entry.get_parent(), h.ext.container);
  assert.equal(h.unredirect(), 1);
  h.ext.hide();
  h.tick();
  assert.equal(h.ext._visible, false);
  assert.ok(h.overview.owners.has(h.ext));
  assert.ok(h.display.owners.has(h.ext));
  assert.ok(h.appSystem.owners.has(h.ext));
  assert.equal(h.entry.get_parent(), h.parent);
  assert.equal(h.entry.classes.has('slc'), false);
  h.ext.mainContainer.transition.onComplete();
  assert.equal(h.unredirect(), 0);
  h.ext.disable();
});

test('Search Light disable restores borrowed UI order and balances compositor state', () => {
  const h = searchHarness();
  h.ext.show();
  const owned = h.ext.mainContainer;
  h.ext.disable();
  assert.equal(h.unredirect(), 0);
  assert.equal(owned.destroyed, true);
  assert.deepEqual(h.parent.children, [h.before, h.entry, h.search, h.after]);
  assert.equal(h.overview.toggle, h.oldToggle);
  assert.equal(h.overview.hide, h.oldHide);
  assert.equal(h.overview.owners.size, 0);
  assert.equal(h.display.owners.size, 0);
  assert.equal(h.stage.owners.size, 0);
  assert.equal(h.appSystem.owners.size, 0);
  assert.equal(h.ext.mainContainer, null);
});

test('Search Light can reopen during closing without double disabling unredirect', () => {
  const h = searchHarness();
  h.ext.show();
  h.ext.hide();
  h.ext.show();
  assert.equal(h.unredirect(), 1);
  h.ext.disable();
  assert.equal(h.unredirect(), 0);
});

test('Search Light pointer chooses exactly one monitor at the shared edge', () => {
  const h = searchHarness();
  h.ext.popup_at_cursor_monitor = true;
  h.ext._queryDisplay();
  assert.equal(h.ext.monitor.index, 1);
  h.ext.popup_at_cursor_monitor = false;
  h.ext.preferred_monitor = 1;
  h.ext._queryDisplay();
  assert.equal(h.ext.monitor.index, 0);
  h.layout.monitors = [];
  h.layout.primaryMonitor = null;
  assert.doesNotThrow(() => h.ext._queryDisplay());
  h.ext.disable();
});

test('unchanged badge arrays do not repaint on every animation frame', () => {
  const {DotCanvas} = source(dockDir + 'apps/dot.js', ['DotCanvas']);
  const canvas = new DotCanvas();
  let repaints = 0;
  canvas.state = {};
  canvas.queue_repaint = () => repaints++;
  canvas.set_state({count: 1, color: [1, 1, 1, 1], translate: [0, -0.85]});
  canvas.set_state({count: 1, color: [1, 1, 1, 1], translate: [0, -0.85]});
  assert.equal(repaints, 1);
  canvas.set_state({count: 2, color: [1, 1, 1, 1], translate: [0, -0.85]});
  assert.equal(repaints, 2);
});

test('Search Light settings module can load in Shell without importing Gdk', () => {
  const runtime = readFileSync(new URL('../' + searchDir + 'preferences/prefKeys.js', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /^import .*['"]gi:\/\/(?:Gdk|Gtk|Adw)/m);
});
