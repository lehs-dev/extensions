import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, GObjectActor, registerGObjectClass, loadModule} from './helpers/shell.mjs';

async function setup() {
  class Widget extends GObjectActor {
    set_child(child) { this.add_child(child); }
    contains(actor) {
      for (let current = actor; current; current = current.parent)
        if (current === this) return true;
      return false;
    }
    get_preferred_height() {
      const visible = this.children.filter(child => child.visible);
      const size = visible.length
        ? visible.reduce((sum, child) => sum + child.get_preferred_height()[1], 0)
        : this.text !== undefined ? 16 : (this.icon_size ?? 18) + 8;
      return [size, size];
    }
    get_preferred_width() {
      const size = this.children.length
        ? Math.max(0, ...this.children.filter(c => c.visible).map(c => c.get_preferred_width()[1]))
        : this.text !== undefined ? this.text.length * 7 : (this.icon_size ?? 18) + 8;
      return [size, size];
    }
    get_transformed_position() {
      const parent = this.parent?.get_transformed_position() ?? [0, 0];
      return [parent[0] + this.x + (this.translation_x ?? 0), parent[1] + this.y];
    }
    should_pick() { return this.visible && this.reactive; }
    pick_box(context, box) { context.push(box); }
    queue_redraw() { this.redraws = (this.redraws ?? 0) + 1; }
    set_state(state) { this.state = state; this.repaints = (this.repaints ?? 0) + 1; }
  }
  const timelines = [];
  class Timeline extends Actor {
    constructor(params) { super(params); timelines.push(this); }
    set_progress_mode(mode) { this.mode = mode; }
    start() { this.running = true; }
    stop() { this.running = false; }
    get_progress() { return this.progress; }
    step(value) {
      this.progress = 1 - (1 - value) ** 3;
      this.emit('new-frame');
      if (value === 1) this.emit('completed');
    }
  }
  const settings = new Actor({reducedMotion: 0, enable_animations: true});
  const stage = new Actor();
  stage.get_key_focus = () => stage.focus;
  stage.get_actor_at_pos = () => stage.picked;
  const monitor = {index: 0, x: -1440, y: -80, width: 1440, height: 900};
  const chrome = new Set();
  const layout = {primaryMonitor: monitor, primaryIndex: 0,
    addChrome(actor, options) { chrome.add(actor); actor.chromeOptions = options; },
    removeChrome(actor) { chrome.delete(actor); },
    findMonitorForActor: () => monitor,
    getWorkAreaForMonitor: () => monitor};
  const nativePanelSource = new Widget();
  function makeMenu() {
    const menu = new Actor({isOpen: false, sourceActor: nativePanelSource, focusActor: nativePanelSource});
    menu.actor = new Widget();
    menu._boxPointer = new Widget({visible: false, _arrowSide: 0, _userArrowSide: 0});
    menu._boxPointer.setPosition = function (source, align) {
      this._sourceActor = source; this._arrowAlignment = align; this.positions = (this.positions ?? 0) + 1;
    };
    menu._boxPointer.updateArrowSide = function (side) { this._arrowSide = this._userArrowSide = side; };
    menu.open = function () { this.isOpen = true; this._boxPointer.visible = true; this.emit('open-state-changed', true); };
    menu.close = function () { this.isOpen = false; this.emit('open-state-changed', false); };
    menu.dismiss = function () { this._boxPointer.visible = false; this.emit('menu-closed'); };
    return menu;
  }
  const quickMenu = makeMenu(), dateMenu = makeMenu();
  const Main = {layoutManager: layout, panel: {statusArea: {
    quickSettings: {menu: quickMenu}, dateMenu: {menu: dateMenu},
  }}};
  const Clutter = {Timeline, AnimationMode: {EASE_OUT_CUBIC: 1},
    Orientation: {VERTICAL: 1}, ActorAlign: {CENTER: 0, FILL: 1},
    PickMode: {REACTIVE: 1}, ActorBox: class { constructor(params) { Object.assign(this, params); } },
    EVENT_STOP: true, EVENT_PROPAGATE: false, ScrollDirection: {UP: 0, DOWN: 1, SMOOTH: 4}};
  class BoxLayout extends Widget {
    constructor(params = {}) {
      if ('vertical' in params) {
        throw new Error('No property vertical on StBoxLayout');
      }
      super(params);
      this.orientation = params.orientation ?? 0;
      this.layout_manager = { orientation: this.orientation };
    }
  }
  const St = {Widget, Button: Widget, BoxLayout, Icon: Widget, Label: Widget,
    DrawingArea: Widget, Side: {LEFT: 3, RIGHT: 1}, Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}};
  const mocks = {'gi://St': {default: St}, 'gi://Clutter': {default: Clutter},
    'gi://GObject': {default: {registerClass: registerGObjectClass}},
    '../attachedBackground.js': {AttachedDockCanvas: Widget},
    'resource:///org/gnome/shell/ui/main.js': Main,
    'resource:///org/gnome/shell/ui/boxpointer.js': {PopupAnimation: {FULL: 3, NONE: 0}}};
  const globals = {global: {stage, get_pointer: () => [-1400, 70]}};
  const pods = await loadModule('dash2dock-lite@custom/systemDock/modularPods.js', {mocks, globals});
  const {SystemMenus} = await loadModule('dash2dock-lite@custom/systemDock/systemMenus.js', {mocks, globals});
  const {computeLeftModularGeometry} = await loadModule('dash2dock-lite@custom/systemDock/systemDockLayout.js');
  const listeners = new Set();
  const state = {network: {available: true, iconName: 'network-wireless-symbolic'},
    bluetooth: {available: true, iconName: 'bluetooth-active-symbolic'},
    audio: {available: true, iconName: 'audio-volume-high-symbolic'},
    battery: {present: true, iconName: 'battery-full-symbolic'},
    inputSource: {available: true, shortName: 'en'},
    time: {hours: '23', hours24: '23', minutes: '56', dayOfWeek: 'Sat', dayOfMonth: '25', month: 'Oct'},
    addListener(cb) { listeners.add(cb); }, removeListener(cb) { listeners.delete(cb); },
    emit(event, data) { for (const cb of listeners) cb(event, data); }};
  const menus = new SystemMenus({state});
  const extension = {modular_indicator_icon_size: 18, modular_elevation_distance: 8};
  let layouts = 0;
  const params = {extension, systemMenus: menus, systemState: state, onLayoutChanged: () => layouts++};
  const quick = new pods.QuickSettingsPod(params), clock = new pods.ClockPod(params);
  quick.enable(); clock.enable();
  const geometry = computeLeftModularGeometry({monitor, frameThickness: 6,
    quickSettingsContentHeight: quick.getMeasuredContentHeight(), clockContentHeight: clock.getMeasuredContentHeight(),
    quickSettingsContentWidth: quick.getMeasuredContentWidth(), clockContentWidth: clock.getMeasuredContentWidth()});
  quick.place(geometry.quickSettings); clock.place(geometry.clock);
  const crossing = (related = null) => ({get_related: () => related});
  function enter(pod, related) { pod.emit('enter-event', crossing(related)); }
  function leave(pod, related) { pod.emit('leave-event', crossing(related)); }
  function finish(pod) { pod._elevation._timeline?.step(1); }
  function destroy() { menus.destroy(); quick.destroy(); clock.destroy(); }
  return {quick, clock, extension, state, listeners, settings, stage, monitor, geometry, mocks, globals, pods, SystemMenus,
    menus, quickMenu, dateMenu, nativePanelSource, chrome, timelines, enter, leave, finish, destroy,
    get layouts() { return layouts; }};
}

const geometryModule = await loadModule('dash2dock-lite@custom/attachedGeometry.js');
const {getAttachedEdgeGeometry, getAttachedPodPickBoxes} = geometryModule;
const baseGeometry = {width: 44, height: 220, position: 'left', flareWidth: 14, footDepth: 4, cornerRadius: 10};

test('corner-facing pod ends are square and clickable up to the screen edge, retaining the inner foot', () => {
  const normal = getAttachedEdgeGeometry(baseGeometry);
  for (const end of ['start', 'end']) {
    for (const offset of [0, 3, 8]) {
      const params = {...baseGeometry, [`${end}Flush`]: true, bodyOffset: offset};
      const g = getAttachedEdgeGeometry(params);
      const cornerY = end === 'start' ? 0 : g.height;
      const crown = end === 'start' ? 'topLeft' : 'topRight';
      assert.equal(g[crown].y, cornerY, 'paint reaches the physical screen edge at full width');
      assert.equal(g[crown].x, baseGeometry.width + offset);
      assert.equal(g[`${end}FlareWidth`], 0);
      const innerFoot = end === 'start' ? 'rightFootTip' : 'leftFootTip';
      assert.deepEqual(g[innerFoot], normal[innerFoot], 'opposite attachment stays anchored');
      const boxes = getAttachedPodPickBoxes(params);
      const picked = (x, y) => boxes.some(b => x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2);
      assert.equal(picked(g.width - 0.5, end === 'start' ? 0.5 : g.height - 0.5), true);
      assert.equal(picked(g.width - 0.5, end === 'start' ? g.height - 0.5 : 0.5), false,
        'transparent corner at the retained foot remains click-through');
      assert.equal(picked(g.width + 1, g.height / 2), false, 'animation reserve stays click-through');
    }
  }
});

test('pod content hugs the left edge even with a previously saved wide body', async () => {
  const {computeLeftModularGeometry} = await loadModule('dash2dock-lite@custom/systemDock/systemDockLayout.js');
  const g = computeLeftModularGeometry({monitor: {x: -1920, y: -200, width: 1920, height: 1080},
    frameThickness: 12, frameRadius: 80, footDepth: 9,
    quickSettingsWidth: 44, quickSettingsContentWidth: 18, clockWidth: 44, clockContentWidth: 21,
    quickSettingsContentHeight: 96, clockContentHeight: 70});
  assert.equal(g.quickSettings.y, -200);
  assert.equal(g.clock.y + g.clock.height, 880);
  assert.equal(g.quickSettings.contentLeft, 2);
  assert.equal(g.quickSettings.contentWidth, 18, 'saved width does not stretch or center the content');
  assert.equal(g.clock.contentWidth, 21);
  assert.equal(g.quickSettings.width, 24, 'wide saved rail width leaves no empty shelf');
  assert.equal(g.clock.width, 25, 'localized clock text determines the compact width');
  assert.equal(g.clock.height - g.clock.contentTop - g.clock.contentHeight, 3,
    'bottom clock text has only the small inner padding before the screen edge');
});

test('elevation moves every body/corner point equally while both edge tips stay anchored', () => {
  const rest = getAttachedEdgeGeometry(baseGeometry);
  for (let step = 0; step <= 20; step++) {
    const offset = step * 0.4;
    const raised = getAttachedEdgeGeometry({...baseGeometry, bodyOffset: offset});
    for (const key of ['leftFootTip', 'rightFootTip', 'leftFootCP1', 'rightFootCP2', 'leftFootTipOvershoot', 'rightFootTipOvershoot'])
      assert.deepEqual(raised[key], rest[key], `${key} moved at ${offset}`);
    for (const key of ['topLeft', 'topRight', 'leftBodyBottom', 'leftBodyTop', 'rightBodyBottom', 'rightBodyTop', 'topLeftCP1', 'topLeftCP2', 'topRightCP1', 'topRightCP2']) {
      assert.ok(Math.abs(raised[key].x - rest[key].x - offset) < 1e-9, key);
      assert.equal(raised[key].y, rest[key].y);
    }
    assert.equal(raised.cornerRadius, rest.cornerRadius);
    assert.ok(raised.leftFootCP2.x >= rest.leftFootCP2.x);
    assert.ok(raised.leftFootCP2.x <= raised.leftBodyBottom.x);
  }
});

test('silhouette picking excludes empty corners and animation reserve at every progress value', () => {
  for (const offset of [0, 0.1, 2, 4, 6, 8]) {
    const boxes = getAttachedPodPickBoxes({...baseGeometry, bodyOffset: offset});
    const picked = (x, y) => boxes.some(b => x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2);
    assert.equal(picked(43 + offset, 1), false);
    assert.equal(picked(43 + offset, 219), false);
    assert.equal(picked(44 + offset + 0.01, 100), false);
    assert.equal(picked(20 + offset, 100), true);
    assert.equal(picked(0.1, 5), true);
    assert.ok(boxes.every(b => b.x2 <= 44 + offset && b.y1 >= 0 && b.y2 <= 220));
  }
});

test('both real pod classes move all content together with the shared attached canvas, keeping scales and allocations stable', async () => {
  const env = await setup();
  for (const pod of [env.quick, env.clock]) {
    const size = [pod.x, pod.y, pod.width, pod.height];
    const positions = [...pod._items.values()].map(item => item.get_transformed_position());
    env.enter(pod);
    assert.equal(pod._elevation._timeline.duration, 210);
    for (const progress of [0.25, 0.5, 0.75]) {
      pod._elevation._timeline.step(progress);
      const offset = pod._elevation.progress * 8;
      assert.equal(pod._contentBox.translation_x, offset);
      assert.equal(pod._canvas.state.bodyOffset, offset);
      assert.deepEqual([pod.x, pod.y, pod.width, pod.height], size);
      [...pod._items.values()].forEach((item, i) => {
        const moved = item.get_transformed_position();
        assert.ok(Math.abs(moved[0] - positions[i][0] - offset) < 1e-9);
        assert.equal(moved[1], positions[i][1]);
        assert.equal(item.scaleX, 1);
        assert.equal(item.scaleY, 1);
        if (item._icon) {
          assert.equal(item._icon.icon_size, 18);
          assert.equal(item._icon.scaleX, 1);
          assert.equal(item._icon.scaleY, 1);
        }
      });
      const context = [];
      pod._surface.vfunc_pick(context);
      assert.ok(context.length > 1, 'Shaped Clutter pick boxes are actually submitted');
    }
    env.finish(pod);
    assert.equal(pod._canvas.state.bodyOffset, 8);
    assert.equal(pod._elevation._timeline, null);
    env.leave(pod); env.finish(pod);
    assert.equal(pod._canvas.state.bodyOffset, 0);
    assert.equal(pod._contentBox.translation_x, 0);
  }
  env.destroy();
});

test('crossing between child buttons keeps one elevation and interrupted leave reverses from current progress', async () => {
  const env = await setup();
  const pod = env.quick;
  env.enter(pod);
  const timeline = pod._elevation._timeline;
  timeline.step(0.3);
  const progress = pod._elevation.progress;
  env.leave(pod, pod._items.get('network'));
  env.enter(pod, pod._items.get('volume'));
  assert.equal(pod._elevation._timeline, timeline);
  env.leave(pod);
  assert.equal(timeline.running, false);
  assert.equal(timeline.signals.size, 0);
  assert.equal(pod._elevation.progress, progress);
  pod._elevation._timeline.step(0.1);
  const returning = pod._elevation.progress;
  env.enter(pod);
  assert.equal(pod._elevation.progress, returning);
  env.finish(pod);
  assert.equal(pod._elevation.progress, 1);
  env.destroy();
});

test('only the native menu owning pod stays raised until dismissal finishes and stale grab hover clears', async () => {
  const env = await setup();
  env.enter(env.quick); env.finish(env.quick);
  const network = env.quick._items.get('network');
  network._onActivate();
  assert.equal(env.quickMenu.sourceActor, network);
  assert.equal(env.quickMenu._boxPointer._arrowSide, 3);
  assert.equal(env.quick._menuOpen, true);
  assert.equal(env.clock._menuOpen, false);
  env.leave(env.quick);
  assert.equal(env.quick._elevation.target, 1);
  env.quickMenu.close();
  assert.equal(env.quick._elevation.target, 1, 'Retain while native popup fades');
  env.quickMenu.dismiss();
  assert.equal(env.quick._elevation.target, 0);
  env.finish(env.quick);
  assert.equal(env.quick._elevation.progress, 0);
  assert.equal(env.quickMenu.sourceActor, env.nativePanelSource);
  env.clock._clockItem._onActivate();
  env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 1, 'Keyboard activation also raises the owner');
  assert.equal(env.quick._elevation.progress, 0);
  assert.ok(env.dateMenu._boxPointer.positions > 2, 'Popup tracks animated content anchor');
  env.clock._pointerInside = true; // crossing events suppressed by native grab
  env.stage.picked = null;
  env.menus.closeAll(); env.finish(env.clock);
  assert.equal(env.clock._pointerInside, false);
  assert.equal(env.clock._elevation.progress, 0);
  env.destroy();
});

test('menu dismissal over the current pod and keyboard focus retain elevation until interaction leaves', async () => {
  const env = await setup();
  const item = env.clock._clockItem;
  env.stage.focus = item;
  env.stage.emit('notify::key-focus'); env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 1);
  item._onActivate();
  env.stage.focus = null;
  env.stage.picked = env.clock._surface;
  env.menus.closeAll();
  assert.equal(env.clock._elevation.target, 1);
  env.leave(env.clock); env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 0);
  env.destroy();
});

test('reduced motion and disabled elevation use immediate or resting geometry and tear down interrupted timelines', async () => {
  const env = await setup();
  env.enter(env.quick);
  const timeline = env.quick._elevation._timeline;
  timeline.step(0.2);
  env.settings.reducedMotion = 1;
  env.settings.emit('notify::reduced-motion');
  assert.equal(timeline.running, false);
  assert.equal(env.quick._elevation.progress, 1);
  assert.equal(env.quick._elevation._timeline, null);
  env.leave(env.quick);
  assert.equal(env.quick._elevation.progress, 0);
  env.extension.modular_group_elevation = false;
  env.quick.place(env.geometry.quickSettings);
  env.enter(env.quick);
  assert.equal(env.quick._elevation.progress, 0);
  env.destroy();
  assert.equal(env.chrome.size, 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.settings.signals.size, 0);
  assert.equal(env.stage.signals.size, 0);
  assert.ok(env.timelines.every(t => !t.running && t.signals.size === 0));
});

test('fullscreen hides and resets the whole pod, closes its native menu and does not leave a running animation', async () => {
  const env = await setup();
  env.enter(env.quick); env.quick._items.get('network')._onActivate();
  env.monitor.inFullscreen = true;
  env.quick.place(env.geometry.quickSettings);
  // Native Clutter emits notify::visible when chrome changes visibility.
  env.quick.emit('notify::visible');
  assert.equal(env.quick.visible, false);
  assert.equal(env.quick._elevation.progress, 0);
  assert.equal(env.quick._elevation._timeline, null);
  assert.equal(env.quickMenu.isOpen, false);
  env.destroy();
});

test('unchanged provider/clock values do not relayout or repaint the background; hardware changes do', async () => {
  const env = await setup();
  const layouts = env.layouts;
  const repaints = env.quick._canvas.repaints;
  const labels = env.clock._clockItem._hourLabel;
  env.state.emit('audio-changed', env.state.audio);
  env.state.time.minutes = '57';
  env.state.emit('clock-changed', env.state.time);
  assert.equal(env.layouts, layouts);
  assert.equal(env.quick._canvas.repaints, repaints);
  assert.equal(env.clock._clockItem._hourLabel, labels);
  env.state.battery.present = false;
  env.state.emit('battery-changed', env.state.battery);
  assert.equal(env.quick._items.get('battery').visible, false);
  assert.equal(env.layouts, layouts + 1);
  env.destroy();
});

test('layout uses measured content widths and the existing dock geometry without collisions or extra struts', async () => {
  const {computeLeftModularGeometry} = await loadModule('dash2dock-lite@custom/systemDock/systemDockLayout.js');
  const g = computeLeftModularGeometry({monitor: {x: -1440, y: 0, width: 1440, height: 1080},
    frameThickness: 6, flareWidth: 23, footDepth: 9, cornerRadius: 13,
    quickSettingsWidth: 32, quickSettingsContentWidth: 40, clockContentWidth: 34});
  assert.equal(g.flareWidth, 23);
  assert.equal(g.quickSettings.footDepth, 9);
  assert.equal(g.clock.cornerRadius, 13);
  assert.ok(g.quickSettings.contentWidth >= 40);
  assert.ok(g.clock.contentWidth >= 34);
  assert.ok(g.quickSettings.y + g.quickSettings.height < g.appDock.topBoundary);
  assert.ok(g.appDock.bottomBoundary < g.clock.y);
  const env = await setup();
  assert.equal(env.quick.reactive, false);
  assert.equal(env.clock.reactive, false);
  assert.equal(env.quick.chromeOptions.affectsStruts, false);
  assert.equal(env.quick.chromeOptions.trackFullscreen, true);
  assert.equal(env.quick._surface.height, env.quick.height);
  assert.ok(env.quick._surface.height < env.monitor.height / 2);
  env.destroy();
});

test('the real Cairo renderer stretches the contour from its original edge through the elevated crown, excluding reserved space', async () => {
  const env = await setup();
  const mocks = {...env.mocks, 'gi://cairo': {default: {
    Operator: {CLEAR: 0, OVER: 1}, LineCap: {ROUND: 0}, LineJoin: {ROUND: 0},
  }}};
  const {AttachedDockCanvas} = await loadModule('dash2dock-lite@custom/attachedBackground.js', {mocks});
  const canvas = new AttachedDockCanvas();
  const points = [];
  const context = {newPath() {}, moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    curveTo(...coords) { for (let i = 0; i < coords.length; i += 2) points.push(coords.slice(i, i + 2)); },
    closePath() {}, save() {}, restore() {}, stroke() {}, strokePreserve() {},
    fill() {}, paint() {}, setOperator() {}, setLineCap() {}, setLineJoin() {},
    setSourceRGBA() {}, setLineWidth() {}, $dispose() { this.disposed = true; }};
  canvas.get_context = () => context;
  canvas.get_surface_size = () => [56, 220];
  const state = {...baseGeometry, bodyOffset: 8, elevationProgress: 1};
  canvas.set_state(state);
  const paints = canvas.repaints;
  canvas.set_state({...state});
  assert.equal(canvas.repaints, paints, 'Unchanged geometry/theme does not repaint');
  canvas.vfunc_repaint();
  assert.equal(Math.max(...points.map(p => p[0])), 52, 'Crown is resting width + lift, excluding reserve');
  assert.ok(points.some(([x, y]) => x === 0 && y === 0), 'Upper attachment remains on edge');
  assert.ok(points.some(([x, y]) => x === 0 && y === 220), 'Lower attachment remains on edge');
  assert.equal(context.disposed, true);
  canvas.destroy(); env.destroy();
});

test('natural content measurement bypasses previous fixed allocation requests', async () => {
  const env = await setup();
  const box = env.quick._contentBox;
  const height = box.get_preferred_height();
  const width = box.get_preferred_width();
  box.get_preferred_height = () => [999, 999];
  box.get_preferred_width = () => [999, 999];
  box.layout_manager = {
    get_preferred_height(actor, forWidth) { assert.equal(actor, box); assert.equal(forWidth, -1); return height; },
    get_preferred_width(actor, forHeight) { assert.equal(actor, box); assert.equal(forHeight, -1); return width; },
  };
  assert.equal(env.quick.getMeasuredContentHeight(), height[1]);
  assert.equal(env.quick.getMeasuredContentWidth(), width[1]);
  env.destroy();
});

test('real pod actors and menu anchors release providers, focus listeners and timelines through repeated mode switches', async () => {
  const env = await setup();
  env.quick.destroy(); env.clock.destroy();
  let stateOwners = 0;
  class State {
    constructor() { stateOwners++; return env.state; }
  }
  env.state.destroy = () => stateOwners--;
  class Rail extends Actor {
    enable() {} updateLayout() {} updateTheme() {} onSettingsChanged() {}
  }
  const {DesktopLayoutManager} = await loadModule('dash2dock-lite@custom/desktopLayoutManager.js', {
    mocks: {...env.mocks, './systemDock/modularPods.js': env.pods,
      './systemDock/systemState.js': {SystemState: State},
      './systemDock/systemMenus.js': {SystemMenus: env.SystemMenus},
      './systemDock/systemDock.js': {SystemDock: Rail}}, globals: env.globals,
  });
  env.extension.desktop_layout = 1;
  const manager = new DesktopLayoutManager({extension: env.extension});
  manager.enable();
  for (let i = 0; i < 8; i++) {
    const quick = manager.quickSettingsPod;
    env.enter(quick);
    quick._elevation._timeline.step(0.2);
    quick._items.get('network')._onActivate();
    manager.onSettingsChanged('desktop-layout', 0);
    assert.equal(manager.quickSettingsPod, null);
    assert.equal(manager.clockPod, null);
    assert.equal(env.quickMenu.sourceActor, env.nativePanelSource);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.settings.signals.size, 0);
    assert.equal(env.stage.signals.size, 0);
    assert.equal(stateOwners, 1);
    manager.onSettingsChanged('desktop-layout', 1);
    assert.equal(manager.systemDock, null);
    assert.equal(env.chrome.size, 2);
    assert.equal(stateOwners, 1);
  }
  manager.destroy(); env.menus.destroy();
  assert.equal(stateOwners, 0);
  assert.equal(env.chrome.size, 0);
  assert.equal(env.listeners.size, 0);
  assert.ok(env.timelines.every(t => !t.running && t.signals.size === 0));
});

test('Left Modular suppresses only the rectangular dock blur and restores the saved Dual Edge choice', async () => {
  const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {mocks: {
    'resource:///org/gnome/shell/ui/main.js': {}, 'gi://Shell': {default: {}},
  }});
  const integration = new Integrations();
  integration._bms = {metadata: {version: 70}};
  const bms = new Actor();
  bms.get_name = () => 'bms-dash-backgroundgroup';
  const extension = {blur_background: true, desktopLayoutManager: {mode: 1}, integrations: integration};
  const animator = {dock: {extension, _background: {}, renderArea: {}, get_children: () => [bms]}};
  integration.bms_update_size(animator);
  assert.equal(bms.visible, false);
  assert.equal(extension.blur_background, true);
  extension.desktopLayoutManager.mode = 0;
  integration.bms_update_size(animator);
  assert.equal(bms.visible, true);
  extension.blur_background = false;
  integration.bms_update_size(animator);
  assert.equal(bms.visible, false);
});

test('system pod hover elevation does not trigger DesktopLayoutManager or dock relayout', async () => {
  const env = await setup();
  let layoutCalls = 0;
  const mockDock = {
    layout: () => { layoutCalls++; return true; },
  };
  env.extension.docks = [mockDock];

  // Record baseline layout count
  const initialLayouts = env.layouts;
  const initialDockLayouts = layoutCalls;

  // Elevate QuickSettings pod through hover enter and steps
  env.enter(env.quick);
  assert.equal(env.layouts, initialLayouts, 'Enter must not trigger DesktopLayoutManager.updateLayout');
  assert.equal(layoutCalls, initialDockLayouts, 'Enter must not trigger dock.layout');

  for (const progress of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    env.quick._elevation._timeline?.step(progress);
    assert.equal(env.layouts, initialLayouts, `Progress ${progress} must not trigger DesktopLayoutManager.updateLayout`);
    assert.equal(layoutCalls, initialDockLayouts, `Progress ${progress} must not trigger dock.layout`);
  }

  // Elevate Clock pod
  env.enter(env.clock);
  for (const progress of [0.3, 0.7, 1.0]) {
    env.clock._elevation._timeline?.step(progress);
    assert.equal(env.layouts, initialLayouts, 'Clock hover must not trigger DesktopLayoutManager.updateLayout');
    assert.equal(layoutCalls, initialDockLayouts, 'Clock hover must not trigger dock.layout');
  }

  // Leave and return to rest
  env.leave(env.quick);
  env.finish(env.quick);
  env.leave(env.clock);
  env.finish(env.clock);

  assert.equal(env.layouts, initialLayouts, 'Hover exit must not trigger DesktopLayoutManager.updateLayout');
  assert.equal(layoutCalls, initialDockLayouts, 'Hover exit must not trigger dock.layout');

  env.destroy();
});

test('pod content box is reactive and child buttons receive activation directly', async () => {
  const env = await setup();

  // Verify content box is reactive
  assert.equal(env.quick._contentBox.reactive, true, 'QuickSettings _contentBox must be reactive');
  assert.equal(env.clock._contentBox.reactive, true, 'Clock _contentBox must be reactive');

  // Verify individual buttons inside QuickSettings can be activated directly
  let activated = null;
  const volumeItem = env.quick._items.get('volume');
  volumeItem._onActivate = () => { activated = 'volume'; };
  volumeItem.emit('clicked');
  assert.equal(activated, 'volume', 'Direct clicked event on VolumeItem activates volume');

  const batteryItem = env.quick._items.get('battery');
  batteryItem._onActivate = () => { activated = 'battery'; };
  batteryItem.emit('clicked');
  assert.equal(activated, 'battery', 'Direct clicked event on BatteryItem activates battery');

  // Single-item pod (ClockPod) activates clock on surface click
  let clockActivated = false;
  env.clock._clockItem._onActivate = () => { clockActivated = true; };
  env.clock._surface.emit('button-release-event', {get_button: () => 1});
  assert.equal(clockActivated, true, 'Single item pod surface click activates the clock');

  env.destroy();
});

test('natural height auto-scales when items are toggled without oversized fixed container', async () => {
  const env = await setup();

  // In setup(), 5 indicators are visible. Measure baseline height
  const heightAll = env.quick.getMeasuredContentHeight();

  // Hide 2 indicators
  env.extension.modular_show_bluetooth = false;
  env.extension.modular_show_battery = false;
  env.quick._refreshContent();

  const heightReduced = env.quick.getMeasuredContentHeight();
  assert.ok(heightReduced < heightAll, `Reduced indicators (${heightReduced}px) must be shorter than all indicators (${heightAll}px)`);

  // Restore indicators
  env.extension.modular_show_bluetooth = true;
  env.extension.modular_show_battery = true;
  env.quick._refreshContent();

  const heightRestored = env.quick.getMeasuredContentHeight();
  assert.equal(heightRestored, heightAll, 'Restoring indicators restores content height');

  env.destroy();
});
