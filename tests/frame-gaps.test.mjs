import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

async function frameEnvironment() {
    const monitors = [{index: 0, x: -1600, y: -100, width: 1600, height: 900,
        geometry_scale: 1.5, inFullscreen: false}];
    const uiGroup = new Actor();
    const windowGroup = new Actor();
    const dock = new Actor();
    uiGroup.add_child(windowGroup);
    uiGroup.add_child(dock);
    const overview = new Actor({visible: false});
    const display = new Actor();
    const chrome = new Set();
    const calls = [];
    const context = Object.fromEntries(['setOperator', 'paint', 'newPath', 'moveTo', 'lineTo',
        'curveTo', 'closePath', 'setFillRule', 'setSourceRGBA', 'fill', '$dispose']
        .map(method => [method, (...args) => calls.push([method, ...args])]));
    class Canvas extends Actor {
        queue_repaint() { this.repaintCount = (this.repaintCount ?? 0) + 1; }
        get_context() { return context; }
        get_surface_size() { return [this.width, this.height]; }
    }
    const layoutManager = new Actor({monitors, primaryMonitor: monitors[0], primaryIndex: 0, uiGroup});
    layoutManager.addChrome = (actor, options) => {
        assert.deepEqual({...options}, {affectsStruts: false, trackFullscreen: false});
        uiGroup.add_child(actor);
        chrome.add(actor);
    };
    layoutManager.removeChrome = actor => {uiGroup.remove_child(actor); chrome.delete(actor);};
    const Main = {overview, layoutManager};
    const module = await loadModule('dash2dock-lite@custom/screenFrame.js', {mocks: {
        'gi://St': {default: {DrawingArea: Canvas}},
        'gi://cairo': {default: {Operator: {CLEAR: 0, OVER: 1}, FillRule: {EVEN_ODD: 1}}},
        'resource:///org/gnome/shell/ui/main.js': Main,
    }, globals: {global: {display, window_group: windowGroup}}});
    return {...module, monitors, overview, display, layoutManager, chrome, calls, uiGroup, dock, windowGroup};
}

test('frame paints rounded outer and inner contours in one fill, below dock, with nonreactive opening', async () => {
    const env = await frameEnvironment();
    const frame = new env.ScreenFrame({extension: {}});
    frame.enable();
    const [actor] = frame._actors;
    assert.equal(actor.reactive, false);
    assert.equal(actor.can_focus, false);
    assert.deepEqual(env.uiGroup.children, [env.windowGroup, actor, env.dock]);
    assert.equal(actor.x, -1600);
    assert.equal(actor.frameGeometry.thickness, 6);
    assert.equal(actor.frameGeometry.cornerRadius, 12);
    assert.equal(actor.frameGeometry.innerRadius, 6);
    actor.emit('repaint');
    const moves = env.calls.filter(call => call[0] === 'moveTo');
    assert.deepEqual(moves, [['moveTo', 12, 0], ['moveTo', 12, 6]]);
    assert.equal(env.calls.filter(call => call[0] === 'curveTo').length, 8, 'each contour has four smooth corners');
    assert.equal(env.calls.filter(call => call[0] === 'fill').length, 1, 'single fill prevents doubled alpha seams');
    assert.deepEqual(env.calls.find(call => call[0] === 'setFillRule'), ['setFillRule', 1], 'inner opening is cut out');
    assert.equal(env.calls.at(-1)[0], '$dispose', 'Cairo resources release after painting');
    env.overview.visible = true;
    env.overview.emit('showing');
    assert.equal(actor.visible, false);
    env.overview.visible = false;
    env.overview.emit('hidden');
    assert.equal(actor.visible, true);
    env.monitors[0].inFullscreen = true;
    env.display.emit('in-fullscreen-changed');
    assert.equal(actor.visible, false);
    frame.destroy();
    assert.equal(env.chrome.size, 0);
    assert.equal(env.display.signals.size, 0);
    assert.equal(env.overview.signals.size, 0);
    assert.equal(env.layoutManager.signals.size, 0);
});

test('frame initialization rolls back actors and subscriptions when Chrome insertion fails', async () => {
    const env = await frameEnvironment();
    env.layoutManager.addChrome = () => {throw new Error('chrome failed');};
    const frame = new env.ScreenFrame({extension: {}});
    assert.throws(() => frame.enable(), /chrome failed/);
    assert.equal(frame._enabled, false);
    assert.equal(frame._actors.length, 0);
    assert.equal(frame._signals.length, 0);
    assert.equal(env.overview.signals.size, 0);
});

test('outer gaps subtract existing struts once and follow live monitor scope and settings', async () => {
    const env = await frameEnvironment();
    const {computeWindowOuterGaps, WindowGapCoordinator} = await loadModule('dash2dock-lite@custom/windowGaps.js', {
        mocks: {'resource:///org/gnome/shell/ui/main.js': {layoutManager: env.layoutManager}},
    });
    const monitor = env.monitors[0];
    const workArea = {...monitor, x: monitor.x + 9, width: monitor.width - 9,
        y: monitor.y + 32, height: monitor.height - 32};
    assert.deepEqual({...computeWindowOuterGaps({monitor, workArea, frameThickness: 6, outerGap: 8})},
        {top: 0, left: 5, right: 14, bottom: 14});
    const extension = {enable_window_outer_gap: true, desktopLayoutManager: {mode: 1}, window_outer_gap_size: 8,
        enable_screen_frame: true, screen_frame_thickness: 6, screen_frame_all_monitors: false};
    const provider = new WindowGapCoordinator({extension});
    provider.enable();
    assert.deepEqual({...provider.getScreenGaps(0, workArea)}, {top: 0, left: 5, right: 14, bottom: 14});
    extension.window_outer_gap_size = 10;
    assert.equal(provider.getScreenGaps(0, monitor).top, 16);
    extension.enable_screen_frame = false;
    assert.equal(provider.getScreenGaps(0, monitor).top, 10);
    env.layoutManager.monitors.push({...monitor, index: 1, x: 0});
    assert.equal(provider.getScreenGaps(1), null);
    extension.screen_frame_all_monitors = true;
    assert.equal(provider.getScreenGaps(1).top, 10);
    extension.enable_window_outer_gap = false;
    assert.equal(provider.getScreenGaps(0), null);
    provider.destroy();
    assert.equal(provider.getScreenGaps(0), null);
});
