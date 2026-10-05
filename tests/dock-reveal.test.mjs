import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function harness() {
  let pointer = [950, 1079];
  const pending = new Set();
  const code = readFileSync(new URL('../dash2dock-lite@icedman.github.com/autohide.js', import.meta.url), 'utf8')
    .replace(/^import\b[\s\S]*?;\s*$/gm, '').replace('export let ', 'let ');
  const AutoHide = vm.runInNewContext(`${code}\n;AutoHide`, {
    Meta: {WindowType: {}}, console: {log() {}},
    global: {get_pointer: () => pointer},
    isInRect: ([x, y, w, h], [px, py]) => px >= x && px <= x + w && py >= y && py <= y + h,
  });
  const auto = new AutoHide();
  auto._enabled = true;
  auto._shown = false;
  let shown = 0;
  auto.dock = {
    _position: 'bottom',
    _monitor: {x: 0, y: 0, width: 1900, height: 1080},
    dwell: {width: 1100, height: 2, get_transformed_position: () => [400, 1078]},
    struts: {width: 1100, height: 70, get_transformed_position: () => [400, 1010]},
    _isWithinDash: () => false,
    slideIn() {shown++;}, slideOut() {},
  };
  auto.extension = {
    autohide_dash: true, autohide_dodge: false,
    _hiTimer: {
      runOnce(func, delay) {const item = {func, delay}; pending.add(item); return item;},
      cancel(item) {pending.delete(item);},
    },
  };
  return {auto, pending, move: p => pointer = p, shown: () => shown,
    fire() {for (const item of [...pending]) {pending.delete(item); item.func();}}};
}

test('hidden dock geometry cannot reveal it while using a window status bar', () => {
  const env = harness();
  env.move([950, 1050]);
  assert.equal(env.auto._checkOverlap(), true);
  env.auto._onEnterEvent();
  assert.equal(env.pending.size, 0);
  env.auto._shown = true;
  assert.equal(env.auto._checkOverlap(), false, 'visible dock still stays open while hovered');
});

test('edge reveal waits once regardless of motion event frequency and accepts a stationary pointer', () => {
  const env = harness();
  env.auto._onEnterEvent();
  for (let i = 0; i < 100; i++) env.auto._onMotionEvent();
  assert.equal(env.pending.size, 1);
  assert.equal([...env.pending][0].delay, 100);
  assert.equal(env.shown(), 0);
  env.fire();
  assert.equal(env.shown(), 1);
  assert.equal(env.pending.size, 0);
});

test('leaving, disabling or moving to another monitor cancels a pending reveal', () => {
  for (const action of ['leave', 'disable', 'other-monitor', 'stale-pointer']) {
    const env = harness();
    env.auto._onEnterEvent();
    if (action === 'leave') env.auto._onLeaveEvent();
    if (action === 'disable') env.auto.disable();
    if (action === 'other-monitor') {env.move([950, 1100]); env.auto._onMotionEvent();}
    if (action === 'stale-pointer') env.move([950, 1050]);
    const before = env.shown();
    env.fire();
    assert.equal(env.shown(), before, action);
    assert.equal(env.pending.size, 0, action);
  }
});

test('explicit 100ms reveal applies regardless of the previous pressure sensitivity setting', () => {
  for (const sensitivity of [0, 1, 2, NaN]) {
    const env = harness();
    env.auto.extension.pressure_sense = true;
    env.auto.extension.pressure_sense_sensitivity = sensitivity;
    env.auto._onEnterEvent();
    assert.equal([...env.pending][0].delay, 100);
    env.auto._onLeaveEvent();
  }
});

test('hovering one pixel inward does not reveal; the actual edge works on all four sides', () => {
  for (const [position, origin, size, near, edge] of [
    ['bottom', [400, 1078], [1100, 2], [950, 1078], [950, 1079]],
    ['top', [400, 0], [1100, 2], [950, 1], [950, 0]],
    ['left', [0, 100], [2, 800], [1, 400], [0, 400]],
    ['right', [1898, 100], [2, 800], [1898, 400], [1899, 400]],
  ]) {
    const env = harness();
    env.auto.dock._position = position;
    env.auto.dock.dwell.get_transformed_position = () => origin;
    [env.auto.dock.dwell.width, env.auto.dock.dwell.height] = size;
    env.move(near);
    env.auto._onEnterEvent();
    assert.equal(env.pending.size, 0, position);
    env.move(edge);
    env.auto._onMotionEvent();
    assert.equal(env.pending.size, 1, position);
    env.fire();
    assert.equal(env.shown(), 1, position);
  }
});

test('real high-resolution timer reveals around 100ms rather than waiting for the 750ms timer', () => {
  const env = harness();
  let tick;
  const code = readFileSync(new URL('../dash2dock-lite@icedman.github.com/timer.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export const ', 'const ');
  const Timer = vm.runInNewContext(`${code}\n;Timer`, {
    console,
    GLib: {
      PRIORITY_DEFAULT: 0,
      timeout_add(_priority, interval, callback) {
        assert.equal(interval, 15);
        tick = callback;
        return 1;
      },
      source_remove() {},
    },
  });
  env.auto.extension._hiTimer = new Timer('reveal-test');
  env.auto.extension._hiTimer.initialize(15);
  env.auto.extension._loTimer = {runOnce() {assert.fail('reveal must not use the 750ms timer');}};
  env.auto._onEnterEvent();
  for (let i = 0; i < 6; i++) tick();
  assert.equal(env.shown(), 0, '90ms is too soon');
  tick();
  assert.equal(env.shown(), 1, '105ms is the first tick after the requested 100ms');
  assert.equal(env.auto.extension._hiTimer._subscribers.length, 0);
  env.auto.extension._hiTimer.shutdown();
});
