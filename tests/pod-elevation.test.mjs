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
        ? this.orientation === 0 ? Math.max(0, ...visible.map(child => child.get_preferred_height()[1])) : visible.reduce((sum, child) => sum + child.get_preferred_height()[1], 0)
        : this.text !== undefined ? 16 : (this.icon_size ?? 18) + 8;
      return [size, size];
    }
    get_preferred_width() {
      const size = this.children.length
        ? this.orientation === 0 ? this.children.filter(c => c.visible).reduce((sum, c) => sum + c.get_preferred_width()[1], 0) : Math.max(0, ...this.children.filter(c => c.visible).map(c => c.get_preferred_width()[1]))
        : this.text !== undefined ? this.text.length * 7 : (this.icon_size ?? 18) + 8;
      return [size, size];
    }
    get_transformed_position() {
      const parent = this.parent?.get_transformed_position() ?? [0, 0];
      return [parent[0] + this.x + (this.translation_x ?? 0), parent[1] + this.y + (this.translation_y ?? 0)];
    }
    should_pick() { return this.visible && this.reactive; }
    pick_box(context, box) { context.push(box); }
    set_clip(x, y, width, height) { this.clip = {x, y, width, height}; }
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
  const pointerChecks = new Map();
  let nextCheck = 0;
  const GLib = {PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, SOURCE_REMOVE: false,
    timeout_add(priority, interval, callback) {
      const id = ++nextCheck;
      pointerChecks.set(id, {interval, callback});
      return id;
    },
    source_remove(id) { assert.ok(pointerChecks.delete(id), 'remove each pointer check once'); },
    Source: {set_name_by_id() {}},
  };
  const stage = new Actor();
  stage.get_key_focus = () => stage.focus;
  let pointer = [-2000, -2000];
  Object.defineProperty(stage, 'picked', {get() { return this._picked; }, set(actor) {
    this._picked = actor;
    const pod = actor?._systemPod;
    const box = pod?._surface.boxes.reduce((best, b) => !best || (b.x2 - b.x1) * (b.y2 - b.y1) > (best.x2 - best.x1) * (best.y2 - best.y1) ? b : best, null);
    pointer = box ? [pod.x + (box.x1 + box.x2) / 2, pod.y + (box.y1 + box.y2) / 2] : [-2000, -2000];
  }});
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
  const quickMenu = makeMenu(), dateMenu = makeMenu(), inputMenu = makeMenu();
  const Main = {layoutManager: layout, panel: {statusArea: {
    quickSettings: {menu: quickMenu}, dateMenu: {menu: dateMenu}, keyboard: {menu: inputMenu},
  }}};
  const Clutter = {Timeline, AnimationMode: {EASE_OUT_CUBIC: 1},
    Orientation: {VERTICAL: 1, HORIZONTAL: 0}, EventType: {MOTION: 1, ENTER: 2, LEAVE: 3}, ActorAlign: {CENTER: 0, FILL: 1},
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
    DrawingArea: Widget, Side: {TOP: 0, BOTTOM: 2, LEFT: 3, RIGHT: 1}, Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}};
  const mocks = {'gi://St': {default: St}, 'gi://Clutter': {default: Clutter},
    'gi://GLib': {default: GLib},
    'gi://Pango': {default: {WrapMode: {WORD_CHAR: 2}, EllipsizeMode: {NONE: 0, END: 3}}},
    'gi://GObject': {default: {registerClass: registerGObjectClass}},
    '../attachedBackground.js': {AttachedDockCanvas: Widget},
    'resource:///org/gnome/shell/ui/main.js': Main,
    'resource:///org/gnome/shell/ui/boxpointer.js': {PopupAnimation: {FULL: 3, NONE: 0}}};
  const globals = {global: {stage, get_pointer: () => pointer}};
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
  const quick = new pods.QuickSettingsPod(params), clock = new pods.ClockPod(params), input = new pods.InputMethodPod(params);
  quick.enable(); clock.enable(); input.enable();
  const geometry = computeLeftModularGeometry({monitor, frameThickness: 6,
    showInputMethod: true, inputMethodContentHeight: input.getMeasuredContentHeight(), inputMethodContentWidth: input.getMeasuredContentWidth(),
    quickSettingsContentHeight: quick.getMeasuredContentHeight(), clockContentHeight: clock.getMeasuredContentHeight(),
    quickSettingsContentWidth: quick.getMeasuredContentWidth(), clockContentWidth: clock.getMeasuredContentWidth()});
  quick.place(geometry.quickSettings); clock.place(geometry.clock); input.place(geometry.inputMethod);
  function setHover(pod, hover, related) {
    if (related && pod.contains(related)) return;
    stage.picked = hover ? pod._surface : null;
    pod._surface.hover = hover;
    pod._surface.emit('notify::hover');
  }
  function enter(pod, related) { setHover(pod, true, related); }
  function leave(pod, related) { setHover(pod, false, related); }
  function finish(pod) { pod._elevation._timeline?.step(1); }
  function destroy() { menus.destroy(); quick.destroy(); clock.destroy(); input.destroy(); }
  return {quick, clock, input, inputMenu, Main, extension, state, listeners, settings, stage, monitor, geometry, mocks, globals, pods, SystemMenus,
    menus, quickMenu, dateMenu, nativePanelSource, chrome, timelines, enter, leave, finish, destroy,
    pointerChecks,
    checkPointer() {
      for (const [id, check] of [...pointerChecks])
        if (pointerChecks.has(id) && !check.callback()) pointerChecks.delete(id);
    },
    setPointer: coords => { pointer = coords; },
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

test('pods share the 34 px dock width and center compact content despite old saved widths', async () => {
  const {computeLeftModularGeometry} = await loadModule('dash2dock-lite@custom/systemDock/systemDockLayout.js');
  const g = computeLeftModularGeometry({monitor: {x: -1920, y: -200, width: 1920, height: 1080},
    frameThickness: 12, frameRadius: 80, footDepth: 9,
    quickSettingsWidth: 44, quickSettingsContentWidth: 18, clockWidth: 44, clockContentWidth: 21,
    quickSettingsContentHeight: 96, clockContentHeight: 70});
  assert.equal(g.quickSettings.y, -200);
  assert.equal(g.clock.y + g.clock.height, 880);
  assert.equal(g.quickSettings.contentLeft, 8);
  assert.equal(g.quickSettings.contentWidth, 18, 'saved width does not stretch or center the content');
  assert.equal(g.clock.contentWidth, 21);
  assert.equal(g.quickSettings.width, 34);
  assert.equal(g.clock.width, 34);
  assert.equal(g.clock.contentLeft, 6.5);
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
  for (const pod of [env.quick, env.input, env.clock]) {
    const size = [pod.x, pod.y, pod.width, pod.height];
    const positions = [...pod._items.values()].map(item => item.get_transformed_position());
    env.enter(pod);
    assert.equal(pod._elevation._timeline.duration, 210);
    assert.equal(pod._elevation._timeline.actor, pod, 'Mutter 51 needs the pod actor to select its frame clock');
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
          assert.equal(item._icon.icon_size, 16);
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
  env.quick._surface.emit('clicked');
  assert.equal(env.quickMenu.sourceActor, env.quick._menuAnchor);
  assert.equal(env.quickMenu.focusActor, env.quick._surface);
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
  env.clock._surface.emit('clicked');
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

test('hover after menu dismissal retains expansion, but returned keyboard focus cannot latch it open', async () => {
  const env = await setup();
  const item = env.clock._surface;
  env.stage.focus = item;
  env.stage.emit('notify::key-focus'); env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 0, 'focus alone does not reveal hover information');
  item.emit('clicked');
  env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 1, 'the open native menu retains its capsule');
  env.stage.picked = env.clock._surface;
  env.menus.closeAll();
  assert.equal(env.clock._elevation.target, 1);
  env.leave(env.clock); env.finish(env.clock);
  assert.equal(env.clock._elevation.progress, 0);
  assert.equal(env.stage.focus, item);
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
  assert.equal(env.pointerChecks.size, 0);
  assert.ok(env.timelines.every(t => !t.running && t.signals.size === 0));
});

test('fullscreen hides and resets the whole pod, closes its native menu and does not leave a running animation', async () => {
  const env = await setup();
  env.enter(env.quick); env.quick._surface.emit('clicked');
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
  assert.equal(g.quickSettings.width, 34);
  assert.equal(g.quickSettings.contentWidth, 30);
  assert.equal(g.clock.width, 34);
  assert.equal(g.clock.contentWidth, 30);
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
    translate(x, y) { this.origin = [x, y]; }, setSourceRGBA() {}, setLineWidth() {}, $dispose() { this.disposed = true; }};
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
  points.length = 0;
  canvas.get_surface_size = () => [200, 220];
  canvas.set_state({...state, position: 'right', alignEnd: true});
  canvas.vfunc_repaint();
  assert.deepEqual(context.origin, [148, 0], 'right contour is anchored at the far edge of the stable reserve');
  assert.ok(points.some(([x, y]) => x === 52 && y === 0));
  assert.ok(points.some(([x, y]) => x === 52 && y === 220));
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

test('real pod actors release providers, anchors and timelines through repeated enable/disable', async () => {
  const env = await setup();
  env.quick.destroy(); env.clock.destroy(); env.input.destroy();
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
  for (let i = 0; i < 8; i++) {
    manager.enable();
    const quick = manager.quickSettingsPod;
    env.enter(quick);
    quick._elevation._timeline.step(0.2);
    quick._surface.emit('clicked');
    assert.equal(env.chrome.size, 3);
    assert.equal(stateOwners, 1);
    manager.destroy();
    assert.equal(manager.quickSettingsPod, null);
    assert.equal(manager.clockPod, null);
    assert.equal(env.quickMenu.sourceActor, env.nativePanelSource);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.settings.signals.size, 0);
    assert.equal(env.stage.signals.size, 0);
  }
  env.menus.destroy();
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

test('one shaped button owns the entire pod and all status presenters are passive', async () => {
  const env = await setup();
  for (const pod of [env.quick, env.input, env.clock]) {
    assert.equal(pod._contentBox.reactive, false);
    assert.equal(pod._surface.reactive, true);
    assert.equal(pod._surface.can_focus, true);
    for (const item of pod._items.values()) {
      assert.equal(item.reactive, false);
      assert.equal(item.can_focus, false);
      assert.equal(item.track_hover, false);
    }
  }
  env.quick._surface.emit('clicked');
  assert.equal(env.quickMenu.isOpen, true);
  assert.equal(env.quickMenu.sourceActor, env.quick._menuAnchor);
  env.menus.closeAll();
  env.clock._surface.emit('clicked');
  assert.equal(env.dateMenu.isOpen, true);
  env.menus.closeAll();
  env.input._surface.emit('clicked');
  assert.equal(env.inputMenu.isOpen, true);
  assert.equal(env.inputMenu.sourceActor, env.input._menuAnchor);
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

test('all three information pods reveal data with their contour and pick only the visible capsule', async () => {
  const env = await setup();
  env.state.network.name = 'Home Wi-Fi';
  env.state.bluetooth.enabled = true;
  env.state.audio.volume = 0.42;
  env.state.battery.percentage = 73;
  env.state.inputSource.displayName = 'Vietnamese Telex';
  env.state.inputSource.mode = 'Vietnamese';
  env.state.time.fullWeekday = 'Sunday';
  env.state.time.fullDate = '25 October 2026';
  for (const pod of [env.quick, env.input, env.clock]) pod._refreshContent();
  assert.equal(env.quick._detailLabels.get('network').text, 'Home Wi-Fi');
  assert.equal(env.quick._detailLabels.get('bluetooth').text, 'Bluetooth: On');
  assert.equal(env.quick._detailLabels.get('volume').text, 'Volume: 42%');
  assert.equal(env.quick._detailLabels.get('battery').text, 'Battery: 73%');
  assert.match(env.input._detailLabels.get('input-source').text, /Vietnamese Telex.*Vietnamese/);
  assert.equal(env.clock._detailLabels.get('time').text, '23:56');
  assert.equal(env.clock._detailLabels.get('weekday').text, 'Sunday');
  assert.equal(env.clock._detailLabels.get('date').text, '25 October 2026');
  const layouts = env.layouts;
  for (const pod of [env.quick, env.input, env.clock]) {
    const allocation = [pod.x, pod.y, pod.width, pod.height];
    const otherGeometry = [env.quick._geom, env.input._geom, env.clock._geom];
    assert.equal(pod._detailsBox.opacity, 0);
    let geometryWrites = 0;
    for (const actor of [pod, pod._canvas, pod._surface, pod._contentBox, pod._detailsBox, pod._menuAnchor]) {
      for (const method of ['set_position', 'set_size']) {
        const original = actor[method];
        actor[method] = function (...args) { geometryWrites++; return original.apply(this, args); };
      }
    }
    env.enter(pod);
    for (const fraction of [0.1, 0.4, 0.7, 1]) {
      pod._elevation._timeline.step(fraction);
      const p = pod._elevation.progress;
      const state = pod._canvas.state;
      const width = state.width + state.bodyOffset;
      assert.equal(state.width, pod._geom.width + pod._expansion * p);
      assert.ok(width > pod._geom.width);
      assert.ok(pod._detailsBox.opacity > 0);
      assert.equal(pod._detailsBox.translation_x, pod._contentBox.translation_x);
      assert.equal(pod._detailsBox.opacity, Math.round(255 * p));
      assert.ok(pod._detailsBox.clip.width <= pod._expansion * p);
      assert.ok(pod._surface.boxes.every(box => box.x2 <= width));
      assert.ok(pod._surface.boxes.some(box => box.x1 === 0), 'attachment stays on the screen edge');
      assert.deepEqual([pod.x, pod.y, pod.width, pod.height], allocation);
      assert.deepEqual([env.quick._geom, env.input._geom, env.clock._geom], otherGeometry);
      assert.equal(env.layouts, layouts);
    }
    env.leave(pod); env.finish(pod);
    assert.equal(pod._detailsBox.opacity, 0);
    assert.equal(pod._detailsBox.clip.width, 0);
    assert.equal(geometryWrites, 0, 'hover never changes actor sizes or allocation positions');
    assert.equal(pod._canvas.state.width, pod._geom.width);
    assert.ok(pod._surface.boxes.every(box => box.x2 <= pod._geom.width), 'unused reserve never catches the pointer');
  }
  env.destroy();
});

test('input method changes update only its information, anchor the active menu and stay expanded through dismissal', async () => {
  const env = await setup();
  // Use the native-menu implementation from this fixture for the Kimpanel owner.
  env.Main.panel.statusArea.kimpanel = {menu: env.inputMenu};
  env.state.inputSource.provider = 'kimpanel';
  env.state.inputSource.displayName = 'Fcitx Telex';
  env.state.emit('input-source-changed', env.state.inputSource);
  const geometry = env.input._geom;
  const layouts = env.layouts;
  env.input._surface.emit('clicked'); env.finish(env.input);
  assert.equal(env.inputMenu.isOpen, true);
  assert.equal(env.input._elevation.progress, 1);
  env.leave(env.input);
  env.state.inputSource.mode = 'ASCII';
  env.state.emit('input-source-changed', env.state.inputSource);
  assert.equal(env.layouts, layouts);
  assert.equal(env.input._geom, geometry);
  assert.match(env.input._detailLabels.get('input-source').text, /ASCII/);
  assert.equal(env.input._elevation.target, 1);
  env.inputMenu.close();
  assert.equal(env.input._elevation.target, 1);
  env.inputMenu.dismiss(); env.finish(env.input);
  assert.equal(env.input._elevation.progress, 0);
  assert.equal(env.inputMenu.sourceActor, env.nativePanelSource);
  env.destroy();
});

test('Shell 51 native menu options disable closing animation before restoring its panel anchor', async () => {
  const env = await setup();
  env.quickMenu._getPopupAnimationFromParams = () => {};
  const open = env.quickMenu.open;
  const close = env.quickMenu.close;
  env.quickMenu.open = function (options) {
    assert.deepEqual({...options}, {animate: true});
    open.call(this);
  };
  env.quickMenu.close = function (options) {
    assert.deepEqual({...options}, {animate: false});
    close.call(this);
    this.dismiss();
  };
  env.quick._surface.emit('clicked');
  assert.equal(env.quickMenu.sourceActor, env.quick._menuAnchor);
  env.menus.closeAll();
  assert.equal(env.quickMenu.sourceActor, env.nativePanelSource);
  assert.equal(env.quick._menuOpen, false);
  env.destroy();
});

test('time-only compact clock reserves room for the full date without relayout on later clock ticks', async () => {
  const env = await setup();
  env.extension.modular_clock_show_weekday = env.extension.modular_clock_show_date = false;
  const height = env.clock.getMeasuredContentHeight();
  env.clock.getMeasuredContentWidth();
  assert.ok(height >= 3 * 16 + 6);
  env.clock.place({...env.clock._geom, contentHeight: height});
  const layouts = env.layouts;
  env.enter(env.clock); env.finish(env.clock);
  assert.equal(env.clock._detailLabels.size, 3);
  assert.equal(env.clock._detailsBox.height, height);
  env.state.time.minutes = '57';
  env.state.emit('clock-changed', env.state.time);
  assert.equal(env.layouts, layouts);
  env.destroy();
});

test('native surface hover reveals every pod before any click or keyboard focus and click opens only its menu', async () => {
  const env = await setup();
  for (const [pod, menu] of [[env.quick, env.quickMenu], [env.input, env.inputMenu], [env.clock, env.dateMenu]]) {
    assert.equal(env.stage.focus, undefined);
    assert.equal(menu.isOpen, false);
    assert.equal(pod._canvas.state.width, 34);
    env.enter(pod);
    assert.equal(pod._pointerInside, true);
    assert.equal(pod._elevation.target, 1);
    env.finish(pod);
    assert.equal(pod._detailsBox.opacity, 255);
    assert.ok(pod._canvas.state.width > 34);
    assert.equal(menu.isOpen, false, 'hover reveals information without opening the menu');
    const timelines = env.timelines.length;
    const width = pod._canvas.state.width;
    pod._surface.emit('clicked');
    assert.equal(menu.isOpen, true);
    assert.equal(env.timelines.length, timelines, 'click does not start another expansion');
    assert.equal(pod._canvas.state.width, width);
    env.leave(pod);
    assert.equal(pod._elevation.target, 1, 'its open menu retains the current expansion');
    env.menus.closeAll(); env.finish(pod);
    assert.equal(pod._canvas.state.width, 34);
    assert.equal(pod._detailsBox.opacity, 0);
    assert.ok(pod._surface.boxes.every(box => box.x2 <= 34));
  }
  assert.equal(env.geometry.inputMethod.y - env.geometry.quickSettings.y - env.geometry.quickSettings.height, 3);
  env.destroy();
});

test('recording stop is actionable inside the unified pod and crossing its button preserves hover', async () => {
  const env = await setup();
  const recording = {id: 41, kind: 'recording', iconName: 'screencast-stop-symbolic',
    accessibleName: 'Stop Screencast'};
  const privacy = {id: 42, kind: 'quick-settings', iconName: 'media-record-symbolic',
    accessibleName: 'Microphone in use'};
  const actions = [];
  env.state.activateDynamicIndicator = indicator => {
    if (!env.state.dynamicIndicators.includes(indicator)) return false;
    actions.push(indicator.id);
    return true;
  };
  env.state.dynamicIndicators = [recording, privacy];
  env.state.emit('indicators-changed');
  const stop = env.quick._items.get('dynamic-41');
  const passive = env.quick._items.get('dynamic-42');
  assert.equal(stop.reactive, true);
  assert.equal(stop.can_focus, true);
  assert.equal(passive.reactive, false);
  assert.equal(passive.can_focus, false);
  const width = env.quick._geom.width;
  env.enter(env.quick); env.finish(env.quick);
  const layouts = env.layouts;

  // Native crossing may clear the departing actor before setting the arriving
  // actor's hover flag. The pointer pick must keep one continuous expansion.
  env.stage.picked = stop;
  env.quick._surface.hover = false;
  env.quick._surface.emit('notify::hover');
  assert.equal(env.quick._elevation.target, 1);
  stop.hover = true; stop.emit('notify::hover');
  assert.equal(env.quick._elevation._timeline, null);
  stop.emit('clicked');
  assert.deepEqual(actions, [41]);
  assert.equal(env.quickMenu.isOpen, false);
  assert.equal(env.layouts, layouts);
  assert.equal(env.quick._geom.width, width);

  env.stage.picked = env.quick._surface;
  stop.hover = false; stop.emit('notify::hover');
  assert.equal(env.quick._elevation.target, 1);
  env.quick._surface.hover = true;
  env.quick._surface.emit('notify::hover');
  assert.equal(env.quick._elevation._timeline, null);
  env.quick._surface.emit('clicked');
  assert.equal(env.quickMenu.isOpen, true, 'the regular cluster retains its native menu');
  env.menus.closeAll();
  env.leave(env.quick); env.finish(env.quick);
  assert.equal(env.quick._elevation.progress, 0);

  env.state.dynamicIndicators = [];
  env.state.emit('indicators-changed');
  assert.equal(stop.destroyed, true);
  assert.equal(env.quick._items.has('dynamic-41'), false);
  stop._onActivate();
  assert.deepEqual(actions, [41], 'stale stop callbacks cannot restart or stop another operation');
  assert.equal(env.quickMenu.isOpen, false);
  env.destroy();
  assert.equal(env.listeners.size, 0);
});

test('right pods reveal inward, pick only their mirrored contour and open native menus toward the screen interior', async () => {
  const env = await setup();
  for (const pod of [env.quick, env.input, env.clock]) {
    const g = {...pod._geom, position: 'right'};
    g.x = env.monitor.x + env.monitor.width - g.width;
    pod.place(g);
    const allocation = [pod.x, pod.y, pod.width, pod.height];
    const edge = env.monitor.x + env.monitor.width;
    assert.equal(pod.x + pod.width, edge);
    assert.equal(pod._canvas.state.alignEnd, true);
    assert.equal(pod._canvas.state.position, 'right');
    assert.ok(pod._surface.boxes.every(b => b.x1 >= pod.width - g.width));
    env.enter(pod);
    for (const p of [0.2, 0.5, 1]) {
      pod._elevation._timeline.step(p);
      const state = pod._canvas.state;
      assert.ok(pod._contentBox.translation_x < 0);
      assert.equal(pod.x + pod.width, edge);
      assert.deepEqual([pod.x, pod.y, pod.width, pod.height], allocation);
      const origin = pod.width - state.width - state.bodyOffset;
      assert.ok(pod._surface.boxes.every(b => b.x1 >= origin - 1e-9 && b.x2 <= pod.width));
      assert.ok(pod._surface.boxes.some(b => b.x2 === pod.width));
    }
    pod._surface.emit('clicked');
    const menu = pod === env.quick ? env.quickMenu : pod === env.input ? env.inputMenu : env.dateMenu;
    assert.equal(menu._boxPointer._arrowSide, 1);
    assert.equal(menu.sourceActor, pod._menuAnchor);
    const maxWidth = Number(menu.actor.style.match(/max-width: ([\d.]+)px/)[1]);
    assert.ok(maxWidth <= pod.popupBounds.left - env.monitor.x - 12);
    env.menus.closeAll();
    env.leave(pod); env.finish(pod);
    assert.ok(pod._surface.boxes.every(b => b.x1 >= pod.width - g.width));
  }
  env.destroy();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.settings.signals.size, 0);
});

test('global scale reaches system icons, clock/input text, details, padding, elevation and borders together', async () => {
  const env = await setup();
  env.extension.global_scale = 1.5;
  env.extension.border_thickness = 2;
  const background = [0.2, 0.3, 0.4, 0.5], border = [0.7, 0.8, 0.9, 1];
  env.extension._dockColors = {'background-color': background, 'border-color': border};
  for (const pod of [env.quick, env.input, env.clock]) {
    pod.place({...pod._geom, width: 51, flareWidth: 21, footDepth: 6, cornerRadius: 15});
    assert.equal(pod._canvas.state.borderThickness, 3);
    assert.equal(pod._canvas.state.scaleFactor, 1);
    assert.equal(pod._canvas.state.backgroundColor, background);
    assert.equal(pod._canvas.state.borderColor, border);
    assert.equal(pod._elevation.distance, 12);
    assert.match(pod._contentBox.style, /spacing: 4.5px/);
    for (const label of pod._detailLabels.values()) assert.match(label.style, /font-size: 18px/);
    for (const item of pod._items.values()) {
      assert.match(item.style, /padding: 3px 1.5px/);
      if (item._icon) assert.equal(item._icon.icon_size, 24);
    }
  }
  assert.match(env.clock._clockItem._hourLabel.style, /font-size: 16.5px/);
  assert.match(env.input._items.get('input-source')._label.style, /font-size: 16.5px/);
  env.destroy();
});

test('pointer motion collapses every pod despite stale hover flags and stale stage picks', async () => {
  const env = await setup();
  for (const pod of [env.quick, env.input, env.clock]) {
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const horizontal = edge === 'top' || edge === 'bottom';
      const g = {...pod._geom, position: edge, x: -1400, y: 40, width: horizontal ? 180 : 34, height: horizontal ? 34 : 180,
        contentLeft: 3, contentTop: 3, contentWidth: horizontal ? 160 : 28, contentHeight: horizontal ? 28 : 160};
      pod.place(g);
      env.enter(pod); env.finish(pod);
      assert.equal(pod._elevation.progress, 1);
      assert.ok(env.stage.signals.size > 0);
      assert.equal(pod._surface.hover, true);
      env.setPointer([2000, 2000]);
      env.stage.emit('captured-event', {type: () => 1, get_coords: () => [2000, 2000]});
      assert.equal(pod._surface.hover, true, 'simulate St failing to emit a leave notification');
      assert.equal(env.stage.picked, pod._surface, 'simulate a previous pick retained during contour changes');
      assert.equal(pod._pointerInside, false);
      assert.equal(pod._elevation.target, 0);
      env.finish(pod);
      assert.equal(pod._detailsBox.opacity, 0);
      assert.equal(env.stage.signals.size, 0, 'idle pods keep no stage hook');
    }
  }
  env.destroy();
});

test('top and bottom pods keep upright content, reveal inward, anchor native menus and leave no reactive reserve', async () => {
  const env = await setup();
  for (const edge of ['top', 'bottom']) {
    for (const pod of [env.quick, env.input, env.clock]) {
      pod.place({...pod._geom, position: edge, x: -1400, y: edge === 'top' ? -80 : 786,
        width: 180, height: 34, contentLeft: 17, contentTop: 3, contentWidth: 146, contentHeight: 28});
      assert.equal(pod._contentBox.orientation, 0);
      const allocation = [pod.x, pod.y, pod.width, pod.height];
      env.enter(pod); env.finish(pod);
      assert.deepEqual([pod.x, pod.y, pod.width, pod.height], allocation);
      assert.equal(pod._canvas.state.width, 180);
      assert.ok(pod._canvas.state.height > 34);
      assert.equal(pod._canvas.state.position, edge);
      assert.equal(pod._contentBox.translation_x, 0);
      assert.ok(edge === 'top' ? pod._contentBox.translation_y > 0 : pod._contentBox.translation_y < 0);
      pod._surface.emit('clicked');
      const menu = pod === env.quick ? env.quickMenu : pod === env.clock ? env.dateMenu : env.inputMenu;
      assert.equal(menu._boxPointer._arrowSide, edge === 'top' ? 0 : 2);
      assert.equal(menu.sourceActor, pod._menuAnchor);
      env.leave(pod); env.menus.closeAll(); env.finish(pod);
      assert.equal(pod._detailsBox.opacity, 0);
      assert.ok(pod._surface.boxes.every(b => edge === 'top' ? b.y2 <= 34 : b.y1 >= pod.height - 34));
    }
  }
  env.destroy();
});


test('system text settles on the physical pixel grid without quantizing hover progress', async () => {
  const env = await setup();
  for (const edge of ['left', 'right', 'top', 'bottom']) for (const scale of [1, 1.25, 1.5, 2]) {
    const pod = env.input;
    pod.get_resource_scale = () => scale;
    env.extension.global_scale = 1.25;
    env.extension.modular_elevation_distance = 3;
    pod.place({...pod._geom, position: edge, x: -1400.25, y: 80.25,
      contentLeft: 4.5, contentTop: 3.75});
    const rest = pod._contentBox.get_transformed_position();
    assert.ok(rest.every(v => Math.abs(v * scale - Math.round(v * scale)) < 1e-9));
    const allocation = [pod.x, pod.y, pod.width, pod.height];
    env.enter(pod);
    pod._elevation._timeline.step(0.25);
    const expected = pod._elevation.progress * pod._elevation.distance;
    const moved = edge === 'left' || edge === 'right' ? pod._contentBox.translation_x : pod._contentBox.translation_y;
    assert.equal(Math.abs(moved), expected, 'animation retains fractional coordinates between endpoints');
    env.finish(pod);
    const raised = pod._contentBox.get_transformed_position();
    assert.ok(raised.every(v => Math.abs(v * scale - Math.round(v * scale)) < 1e-9));
    assert.deepEqual([pod.x, pod.y, pod.width, pod.height], allocation);
    env.leave(pod); env.finish(pod);
  }
  env.destroy();
});

test('pod content has finite positions before Shell allocates the root actor', async () => {
  const env = await setup();
  try {
    for (const pod of [env.quick, env.input, env.clock]) {
      // Clutter cannot transform an actor whose allocation is still pending.
      // Placement must use the known monitor geometry rather than that result.
      pod.get_transformed_position = () => [NaN, NaN];
      for (const edge of ['left', 'right', 'top', 'bottom']) {
        pod.place({...pod._geom, position: edge});
        for (const actor of [pod, pod._contentBox, pod._detailsBox, pod._menuAnchor])
          for (const property of ['x', 'y', 'width', 'height'])
            assert.ok(Number.isFinite(actor[property]), `${pod.name} ${edge} ${property} is finite before allocation`);
        env.state.emit('input-source-changed', env.state.inputSource);
        assert.ok(Number.isFinite(pod._contentBox.x) && Number.isFinite(pod._contentBox.y),
          'provider refresh before allocation also preserves valid content');
      }
    }
  } finally { env.destroy(); }
});

test('pods collapse when the pointer enters an application without Shell crossing or motion events', async () => {
  const env = await setup();
  try {
    assert.equal(env.pointerChecks.size, 0, 'collapsed pods do not poll');
    for (const pod of [env.quick, env.input, env.clock]) for (const edge of ['left', 'right', 'top', 'bottom']) {
      pod.place({...pod._geom, position: edge});
      env.enter(pod); env.finish(pod);
      assert.equal(pod._elevation.progress, 1);
      assert.equal(env.pointerChecks.size, 1, 'one active check for the expanded pod');
      assert.ok([...env.pointerChecks.values()].every(check => check.interval <= 100));
      // Model a native application surface taking pointer motion, with both
      // St.hover and the stage's picked actor still cached on the old pod.
      env.setPointer([2000, 2000]);
      env.checkPointer();
      assert.equal(pod._surface.hover, true, 'no notify::hover was delivered');
      assert.equal(env.stage.picked, pod._surface, 'no stage pick update was delivered');
      assert.equal(pod._pointerInside, false);
      assert.equal(pod._elevation.target, 0, 'real pointer position starts contraction');
      env.finish(pod);
      assert.equal(pod._detailsBox.opacity, 0);
      assert.equal(env.pointerChecks.size, 0, 'check removed after contraction');
      assert.equal(env.stage.signals.size, 0, 'stage listener removed after contraction');
    }
  } finally { env.destroy(); }
});

test('pointer checks preserve native menus, support re-entry and stop on hide or destruction', async () => {
  const env = await setup();
  try {
    env.enter(env.quick); env.finish(env.quick);
    env.quick._surface.emit('clicked');
    env.setPointer([2000, 2000]); env.checkPointer();
    assert.equal(env.quick._pointerInside, false);
    assert.equal(env.quick._elevation.target, 1, 'native popup keeps its pod open');
    env.menus.closeAll(); env.finish(env.quick);
    assert.equal(env.pointerChecks.size, 0);
    env.enter(env.quick); env.finish(env.quick);
    env.setPointer([2000, 2000]); env.checkPointer();
    env.quick._elevation._timeline.step(0.4);
    env.stage.picked = env.quick._surface; env.checkPointer();
    assert.equal(env.quick._elevation.target, 1, 're-entering mid-collapse reverses from the current state');
    env.finish(env.quick);
    env.quick.visible = false; env.quick.emit('notify::visible');
    assert.equal(env.pointerChecks.size, 0, 'hidden pods have no remaining check');
    env.quick.visible = true;
    env.enter(env.quick); env.finish(env.quick);
    const callback = [...env.pointerChecks.values()][0].callback;
    env.quick.destroy();
    assert.equal(env.pointerChecks.size, 0, 'destroy releases a running check');
    assert.equal(callback(), false, 'a queued callback cannot access a destroyed pod');
    assert.equal(env.stage.signals.size, 0);
  } finally { env.destroy(); }
});
