import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

class NativeActor extends Actor {
    get last_child() { return this.children.at(-1); }
    set_width(width) { this.width = width; }
    connectObject(name, callback) { return this.connect(name, callback); }
    set_clip(x, y, width, height) { this.clip = {x, y, width, height}; }
    remove_clip() { this.clip = null; }
}
class ScrollBox extends NativeActor {
    get_transformed_position() {
        const [x, y] = super.get_transformed_position();
        return [x, y - (this.adjustment?.value ?? 0)];
    }
}
class Adjustment extends Actor {
    constructor() { super(); this.lower = 0; this.upper = 1000; this.page_size = 200; this._value = 0; }
    get value() { return this._value; }
    set value(value) {
        if (this._value === value) return;
        this._value = value;
        this.emit('notify::value');
    }
}
class ScrollView extends NativeActor {
    constructor(params) { super(params); this.vadjustment = new Adjustment(); }
    set_child(child) {
        assert.ok(child === null || child instanceof ScrollBox,
            'GNOME 51 ScrollView requires a St.Scrollable child; native Dash is not one');
        if (this.child) this.remove_child(this.child);
        this.child = child;
        if (child) { child.adjustment = this.vadjustment; this.add_child(child); }
    }
}

test('a short modular viewport retains a full source icon even at maximum magnification', async () => {
    const {computeDockViewport} = await loadModule('dash2dock-lite@custom/dockOverflow.js');
    for (const availableHeight of [124, 160, 300, 600]) {
        const viewport = computeDockViewport({availableHeight, contentHeight: 1200,
            iconSize: 48, magnify: 1, spread: 1});
        assert.equal(viewport.overflow, true);
        assert.ok(viewport.bodyHeight >= 48, 'keyboard focus can expose an entire source icon');
        assert.ok(viewport.contentTop + viewport.bodyHeight <= viewport.height - 14,
            'source viewport stays between both flares');
    }
});

async function setup(count = 16) {
    const monitor = {index: 0, x: -1600, y: -100, width: 1600, height: 900, geometry_scale: 1.5};
    const constraints = {availableHeight: 300, centerY: 360, visible: true};
    const layoutManager = {mode: 1, getModularConstraints: () => layoutManager.mode === 1 ? constraints : null};
    const chromeChanges = [];
    const shellLayout = {primaryIndex: 0, primaryMonitor: monitor,
        monitors: [monitor, {...monitor, index: 1, x: 0}],
        untrackChrome: actor => chromeChanges.push(['untrack', actor]),
        trackChrome: (actor, params) => chromeChanges.push(['track', actor, params])};
    const {Dock} = await loadModule('dash2dock-lite@custom/dock.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {layoutManager: shellLayout},
        'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => [], _getIds: () => []})},
        'resource:///org/gnome/shell/misc/config.js': {PACKAGE_VERSION: '51'},
        'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}},
        'gi://Shell': {default: {}}, 'gi://Gio': {default: {}},
        'gi://GObject': {default: {registerClass: (meta, cls) => cls}},
        'gi://Clutter': {default: {ActorAlign: {CENTER: 0}, Orientation: {VERTICAL: 1},
            ScrollDirection: {UP: 0, DOWN: 1, SMOOTH: 4}, EVENT_STOP: true}},
        'gi://Graphene': {default: {Point: class {}}},
        'gi://St': {default: {Widget: NativeActor, BoxLayout: ScrollBox, ScrollView,
            PolicyType: {NEVER: 0, EXTERNAL: 3}}},
        './effects/tint_effect.js': {TintEffect: class {}},
        './effects/monochrome_effect.js': {MonochromeEffect: class {}},
        './dockItems.js': {DockIcon: NativeActor, DockItemContainer: NativeActor, DockBackground: NativeActor},
        './dockItemMenu.js': {DockItemList: class {}}, './autohide.js': {AutoHide: class {}},
        './animator.js': {Animator: class {}},
        './utils.js': {get_distance_sqr() {}, get_distance() {}, isInRect() {}, isOverlapRect() {}, tempPath() {}},
    }});
    const dock = new Dock();
    dock.extension = {desktopLayoutManager: layoutManager, dock_location: 0, icon_size: 48,
        icon_spacing: 0, animation_spread: 0.5, animation_magnify: 0.5,
        flare_width: 14, modular_show_appdock: true};
    dock.dash = new NativeActor();
    dock.dash.layout_manager = {};
    const container = new NativeActor();
    container.layout_manager = {};
    dock.dash.add_child(container);
    dock.dash._box = new NativeActor();
    dock.dash._box.layout_manager = {};
    container.add_child(dock.dash._box);
    dock.add_child(dock.dash);
    const icons = Array.from({length: count}, (_, i) => {
        const icon = new NativeActor({y: i * 54});
        icon._icon = new NativeActor();
        icon._appwell = icon;
        dock.dash._box.add_child(icon);
        return icon;
    });
    dock.renderArea = new NativeActor();
    dock.add_child(dock.renderArea);
    dock.struts = new NativeActor();
    dock.dwell = new NativeActor();
    dock._updateExtraIcons = () => {};
    dock._findIcons = () => icons;
    const queryMonitor = () => Dock.prototype.getMonitor.call(dock);
    dock.getMonitor = () => monitor;
    dock._beginAnimation = () => { dock.animations = (dock.animations ?? 0) + 1; };
    dock._debounceEndAnimation = () => {};
    const allocate = () => {
        const view = dock._scrollView;
        icons.forEach((icon, i) => { icon.y = i * icon.height; });
        view.vadjustment.upper = Math.max(dock.dash.height, view.height);
        view.vadjustment.page_size = view.height;
    };
    return {dock, icons, layoutManager, constraints, allocate, queryMonitor, monitor, chromeChanges};
}

test('modular overflow keeps native Dash in a Scrollable wrapper, wheel/focus expose last app, mode restore retains actors', async () => {
    const {dock, icons, layoutManager, allocate} = await setup();
    const dash = dock.dash;
    assert.equal(dock.layout(), true);
    allocate();
    assert.equal(dock._scrollView.child, dock._scrollBox);
    assert.equal(dock.children.at(-1), dock.renderArea, 'painted click targets sit above native scroll wrappers');
    assert.equal(dash.get_parent(), dock._scrollBox);
    assert.equal(dock._modularViewport.overflow, true);
    assert.equal(dock._scaleFactor, 1, 'fractional monitor scale is not applied twice');
    assert.equal(dock._scaledDown, 1, 'overflow does not reduce configured icon size');
    assert.equal(dock.renderArea.clip.y, 14, 'render clip retains magnification headroom above source hit viewport');
    assert.ok(dock._modularViewport.contentTop > dock.renderArea.clip.y);
    const scroll = dock._scrollView;
    assert.equal(scroll.enable_mouse_scrolling, false, 'custom wheel handler owns each adjustment once');
    dock._onScrollEvent(dock.renderArea, {get_scroll_direction: () => 1});
    assert.equal(scroll.vadjustment.value, 30);
    icons.at(-1).emit('key-focus-in');
    const [, lastY] = icons.at(-1).get_transformed_position();
    const [, viewportY] = scroll.get_transformed_position();
    assert.ok(lastY >= viewportY - 1e-8 && lastY + icons.at(-1).height <= viewportY + scroll.height + 1e-8,
        'keyboard focus reveals the entire final application');
    assert.ok(dock.animations >= 2, 'scroll changes wake existing render animation');
    const height = dock.height;
    for (let i = 0; i < 10; i++) dock.layout();
    assert.equal(dock.height, height, 'layout stays stable during pointer animation');
    assert.equal(dock._scrollView, scroll, 'ordinary frame layout reuses scroll actors');
    layoutManager.mode = 0;
    dock.layout();
    assert.equal(dock._scrollView, null);
    assert.equal(scroll.destroyed, true);
    assert.equal(scroll.vadjustment.signals.size, 0, 'adjustment listener cleaned on mode exit');
    assert.equal(dock.dash, dash, 'switching modes preserves running apps, DnD and native context actors');
    assert.equal(dash.get_parent(), dock);
    assert.equal(dash.destroyed, undefined);
    assert.equal(dash.height, -1, 'normal Dash natural allocation is restored');
    assert.equal(dock.renderArea.clip, null);
    assert.equal(dock.extension.icon_size, 48, 'saved icon preference never changes');
    assert.equal(dock._position, 'bottom', 'previous user position is restored');
});

test('native BaseIcon size matches the configured source slot and is not reset on ordinary frames', async () => {
    const {dock, icons} = await setup(3);
    let calls = 0, cleanups = 0;
    const previous = icons[0]._icon;
    dock._cleanupIcon = () => cleanups++;
    previous._destroyConnectId = previous.connect('destroy', () => dock._cleanupIcon(icons[0]));
    icons[0]._grid = {iconSize: 64, icon: previous, setIconSize(size) {
        this.icon.destroy();
        this.icon = new NativeActor();
        this.iconSize = size;
        calls++;
    }};
    dock.layout();
    assert.equal(icons[0]._grid.iconSize, 30, 'native minimum size no longer disagrees with renderer/source layout');
    assert.equal(icons[0]._icon, icons[0]._grid.icon, 'the renderer references the replacement texture');
    assert.equal(icons[0]._icon.opacity, 0);
    assert.equal(previous.destroyed, true);
    assert.equal(cleanups, 0, 'resizing the texture must not destroy its application menu or label');
    dock.layout();
    dock.layout();
    assert.equal(calls, 1);
    icons[0]._icon.destroy();
    assert.equal(cleanups, 1, 'final texture disposal still performs normal cleanup');
});

test('hidden modular Application Dock has no dwell or hover hit region', async () => {
    const {dock} = await setup(3);
    dock.extension.modular_show_appdock = false;
    dock.layout();
    assert.equal(dock.visible, false);
    assert.equal(dock.dwell.visible, false);
    assert.equal(dock.isWithinHoverArea([dock.x + 10, dock.y + 40]), false);
});

test('modular hover entry stays attached to source icons when the painted background changes size', async () => {
    const {dock, icons} = await setup(3);
    dock.layout();
    const inside = [dock.x + 20, dock.y + dock._modularViewport.contentTop + 20];
    const outside = [dock.x + dock._iconSizeScaledDown + 9, inside[1]];
    dock._background = new NativeActor({width: 1, height: 1});
    assert.equal(dock.isWithinHoverArea(inside), true, 'resting source stays interactive during contraction');
    dock._background.set_size(500, 500);
    assert.equal(dock.isWithinHoverArea(outside), false, 'expanded paint cannot initiate hover over an adjacent window');
    icons[0]._scale = 1.5;
    icons[0]._renderer = new NativeActor({x: outside[0] - 5, y: outside[1] - 5, width: 72, height: 72});
    assert.equal(dock.isWithinHoverArea(outside), true, 'actual magnified icons retain direct pointer interaction');
});

async function createBackground() {
    const {DockBackground} = await loadModule('dash2dock-lite@custom/dockItems.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {},
        'resource:///org/gnome/shell/ui/boxpointer.js': {},
        'resource:///org/gnome/shell/ui/popupMenu.js': {PopupMenu: class {}},
        'resource:///org/gnome/shell/ui/dash.js': {Dash: class {}, DashIcon: NativeActor, DashItemContainer: NativeActor},
        'gi://Shell': {default: {}}, 'gi://Gio': {default: {}},
        'gi://GObject': {default: {registerClass: (meta, cls) => cls}},
        'gi://Clutter': {default: {}}, 'gi://St': {default: {Widget: NativeActor}},
        './utils.js': {trySpawnCommandLine() {}},
        './dock.js': {DockPosition: {TOP: 'top', BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right'}},
        './attachedBackground.js': {AttachedDockCanvas: NativeActor},
    }});
    const background = new DockBackground();
    background._canvas = new NativeActor();
    background._canvas.set_state = state => {background._canvas.state = state;};
    return background;
}

test('modular capsule remains stable while content scrolls and encloses a single magnified application', async () => {
    const background = await createBackground();
    let scrollY = 0;
    const dock = {x: 0, y: 200, width: 150, height: 300, _modularViewport: {overflow: true},
        _dockHoverProgress: 1,
        isVertical: () => true,
        dash: {width: 60, height: 800, translationX: 0, translationY: 0,
            get_transformed_position: () => [0, 235 - scrollY]},
        extension: {desktopLayoutManager: {mode: 1}, background_style: 0,
            animation_magnify: 1, dock_padding: 0, flare_width: 14}};
    const first = {width: 34, _fixedPosition: [0, 235], _icon: {translationX: 0, translationY: 0},
        _renderer: new NativeActor({x: 0, y: 270, width: 60, height: 60})};
    dock._icons = [first];
    const params = {first, last: first, iconSize: 30, scaleFactor: 1,
        vertical: true, position: 'left', panel_mode: true, dock};
    background.update(params);
    assert.equal(background.opacity, 255, 'one running application still has an attached capsule');
    assert.equal(background.height, 300);
    assert.equal(background.y, 0);
    assert.ok(background.width >= 60, 'actual magnified renderer remains inside capsule');
    const width = background.width;
    scrollY = 450;
    background.update(params);
    assert.equal(background.height, 300);
    assert.equal(background.y, 0);
    assert.equal(background.width, width, 'scroll offsets never change capsule geometry');
    assert.equal(background._canvas.state.position, 'left');

    first._renderer.set_size(30, 30);
    dock._dockHoverProgress = 0;
    background.update(params);
    assert.ok(background.width < width, 'overflow capsule also contracts when magnification ends');
});

test('modular frames reuse layout until content, settings or fullscreen really changes', async () => {
    const {dock} = await setup(5);
    let layouts = 0;
    const layout = dock.layout.bind(dock);
    dock.layout = () => { layouts++; return layout(); };
    assert.equal(dock._ensureLayout(), true);
    assert.equal(layouts, 1);
    for (let frame = 0; frame < 240; frame++) assert.equal(dock._ensureLayout(), true);
    assert.equal(layouts, 1, 'hover frames never call layout');
    dock.extension.animation_magnify = 1;
    dock._layoutDirty = true;
    dock._ensureLayout();
    assert.equal(layouts, 2, 'changed geometry preferences invalidate layout once');
    dock._onDockContentChanged();
    dock._ensureLayout();
    assert.equal(layouts, 3, 'native redisplay invalidates layout once');
    dock.getMonitor().inFullscreen = true;
    dock.autohider = {_debounceCheckHide() {}};
    dock._onFullScreen();
    dock._ensureLayout();
    assert.equal(layouts, 4);
    assert.equal(dock.visible, false, 'cached geometry cannot expose the dock over fullscreen');
    for (let frame = 0; frame < 240; frame++) dock._ensureLayout();
    assert.equal(layouts, 4);
});

test('native separator cleanup during rediscovery cannot invalidate the array being built', async () => {
    const {dock} = await setup(0);
    const box = dock.dash._box;
    const remove = box.remove_child.bind(box);
    box.remove_child = child => { remove(child); box.emit('child-removed', child); };
    box.connect('child-removed', () => dock._onDockContentChanged());
    for (let i = 0; i < 2; i++) box.add_child(new NativeActor({_cls: 'dash-separator'}));
    const icons = Object.getPrototypeOf(dock)._findIcons.call(dock);
    assert.equal(icons.length, 0);
    assert.equal(box.get_children().length, 0);
    assert.equal(dock._icons, icons);
    assert.equal(dock._findingIcons, false);
});

test('pointer motion and child crossings never resubscribe an active dock animation loop', async () => {
    const {dock} = await setup();
    dock.layout();
    const prototype = Object.getPrototypeOf(dock);
    let starts = 0;
    dock.extension._hiTimer = {runLoop() { starts++; return {}; }, cancel() {}};
    dock.extension._loTimer = {cancel() {}};
    dock.autohider = {_debounceCheckHide() {}};
    dock._updateFocusedIcon = () => {};
    dock._beginAnimation = prototype._beginAnimation.bind(dock);
    dock._onEnterEvent();
    assert.equal(starts, 1);
    for (let i = 0; i < 240; i++) {
        dock._onMotionEvent(); dock._onLeaveEvent(); dock._onEnterEvent();
    }
    assert.equal(starts, 1, 'one loop serves the entire hover session');
    dock._endAnimation();
    dock._onLeaveEvent();
    assert.equal(starts, 2, 'leaving idle painted space wakes the one return transition');
    dock._endAnimation();
});

test('secondary modular copies stay suppressed', async () => {
    const {dock, layoutManager} = await setup();
    const other = {};
    layoutManager.applicationDock = other;
    assert.equal(dock.layout(), false);
    assert.equal(dock._layoutSuppressed, true);
    assert.equal(dock.visible, false);
    assert.equal(dock.dwell.visible, false);
    assert.equal(dock.struts.visible, false);
    layoutManager.applicationDock = dock;
    assert.equal(dock.layout(), true);
    assert.equal(dock._layoutSuppressed, false);
    assert.equal(dock.visible, true);
});


test('a saved secondary-monitor preference restores after the primary modular layout', async () => {
    const {dock, layoutManager, queryMonitor, monitor} = await setup();
    dock._monitorIndex = 1;
    dock.extension._queryDisplay = () => 1;
    layoutManager.applicationDock = dock;
    assert.equal(queryMonitor(), monitor, 'Left Modular routes its retained dock to the pod monitor');
    assert.equal(dock._monitorIndex, 1, 'routing preserves saved Dual Edge monitor');
    layoutManager.mode = 0;
    assert.equal(queryMonitor().index, 1);
});


test('suppressing a modular copy releases only its own invisible work-area strut', async () => {
    const {dock, layoutManager, chromeChanges} = await setup();
    dock._onChrome = true;
    dock._strutSuppressed = false;
    layoutManager.applicationDock = {};
    dock.layout();
    assert.equal(chromeChanges.length, 2);
    assert.equal(chromeChanges[1][1], dock.struts);
    assert.equal(chromeChanges[1][2].affectsStruts, false);
    dock.layout();
    assert.equal(chromeChanges.length, 2, 'ordinary frames do not retrack chrome');
    layoutManager.applicationDock = dock;
    dock.layout();
    assert.equal(chromeChanges.length, 4);
    assert.equal(chromeChanges[3][2].affectsStruts, true);
});

test('Magic Lamp keeps a positive visible viewport target for an application scrolled beyond the monitor', async () => {
    const {Integrations} = await loadModule('dash2dock-lite@custom/integrations.js', {mocks: {
        'resource:///org/gnome/shell/ui/main.js': {}, 'gi://Shell': {default: {}},
    }});
    const integrations = new Integrations();
    const monitor = {index: 0, x: -1600, y: 0, width: 1600, height: 900};
    const dock = {_position: 'left', y: 200, _iconSizeScaledDown: 48,
        _modularViewport: {contentTop: 40, bodyHeight: 220}};
    for (const y of [-1500, 1500]) {
        const geometry = integrations._compizIconGeometry({
            get_transformed_position: () => [-1600, y],
            get_transformed_size: () => [48, 48],
        }, dock, monitor);
        assert.ok(geometry && geometry.width > 0 && geometry.height > 0);
        assert.ok(geometry.y >= 240 && geometry.y + geometry.height <= 460);
        assert.equal(geometry.dockPosition, 'left');
    }
});

test('native scroll wrappers remain click-through while painted input targets own pointer events', async () => {
    const {dock} = await setup(5);
    dock.layout();
    assert.equal(dock._scrollView.reactive, false, 'unused source viewport cannot eat application-edge clicks');
    assert.equal(dock._scrollBox.reactive, false, 'scroll wrapper adds no invisible hit rail');

    let scrollHandled = false;
    dock._onScrollEvent = () => { scrollHandled = true; return true; };
    dock._scrollView.emit('scroll-event', {get_scroll_direction: () => 1});
    assert.equal(scrollHandled, true, 'ScrollView forwards scroll events to dock handler');
});

test('modular Application Dock does not thrash height or y to monitor dimensions during layout passes', async () => {
    const {dock, monitor} = await setup(6);
    dock.layout();
    const stableHeight = dock.height;
    const stableY = dock.y;
    assert.ok(stableHeight < monitor.height, 'Modular dock height must be a compact capsule');
    assert.ok(stableY > monitor.y, 'Modular dock y must be centered between boundaries');

    const assignedHeights = [];
    const assignedYs = [];
    Object.defineProperty(dock, 'height', {
        get() { return this._h; },
        set(val) { assignedHeights.push(val); this._h = val; },
        configurable: true,
    });
    Object.defineProperty(dock, 'y', {
        get() { return this._y; },
        set(val) { assignedYs.push(val); this._y = val; },
        configurable: true,
    });
    dock._h = stableHeight;
    dock._y = stableY;

    for (let frame = 0; frame < 10; frame++) {
        dock.layout();
    }

    // No intermediate assignment should ever set height to monitor.height (900) or y to monitor.y (-100)
    assert.ok(!assignedHeights.includes(monitor.height), 'Height must never thrash to monitor.height');
    assert.ok(!assignedYs.includes(monitor.y), 'Y must never thrash to monitor.y');
    assert.equal(dock.height, stableHeight, 'Height remains stable across frames');
    assert.equal(dock.y, stableY, 'Y position remains stable across frames');
});

test('pin/unpin changes the capsule by exactly one allocated icon slot with constant flares and padding', async () => {
    const {computeDockFrames} = await loadModule('dash2dock-lite@custom/dockOverflow.js');
    const {getAttachedEdgeGeometry} = await loadModule('dash2dock-lite@custom/attachedGeometry.js');
    for (const iconSpacing of [0, 0.5, 1]) {
        const {dock, icons, constraints} = await setup(12);
        dock.extension.icon_spacing = iconSpacing;
        constraints.availableHeight = 2000;
        const allIcons = [...icons];
        let previous;
        for (const count of [1, 2, 3, 7, 12, 7, 2, 1]) {
            icons.splice(0, icons.length, ...allIcons.slice(0, count));
            dock.layout();
            const viewport = dock._modularViewport;
            const frames = computeDockFrames({viewport, height: dock.height,
                restingWidth: 34, contentRight: 32, iconSize: 30, slotSize: icons[0].width,
                inset: 4, flareWidth: 14, magnify: 0.5});
            const g = getAttachedEdgeGeometry({...frames.resting, position: 'left', flareWidth: 14});
            assert.equal(dock.dash.height, count * icons[0].height);
            assert.equal(frames.resting.height, count * icons[0].height + 2 * (14 + 4));
            assert.equal(g.flareWidth, 14);
            assert.equal(dock._iconSizeScaledDown, 30);
            assert.equal(dock.extension.animation_magnify, 0.5);
            assert.ok(Math.abs(dock.y + dock.height / 2 - constraints.centerY) <= 0.5);
            if (previous) {
                const delta = (count - previous.count) * icons[0].height;
                assert.equal(frames.resting.height - previous.restingHeight, delta);
                assert.equal(dock.height - previous.height, delta);
            }
            previous = {count, restingHeight: frames.resting.height, height: dock.height};
        }
    }
});

test('vertical native separators and layout spacing cannot add another icon slot and restore on mode exit', async () => {
    const {dock, icons, layoutManager} = await setup(3);
    const separator = new NativeActor({width: 1, height: 64, style: 'margin-left: 8px;'});
    dock.dash._box.add_child(separator);
    dock._separators = [separator];
    dock.dash._box.layout_manager.spacing = 9;
    dock.layout();
    assert.equal(separator.height, 1);
    assert.equal(separator.width, 30);
    assert.equal(dock.dash._box.layout_manager.spacing, 0);
    assert.equal(dock.dash.height, 3 * icons[0].height + 1);
    layoutManager.mode = 0;
    dock.layout();
    assert.equal(separator.width, 1);
    assert.equal(separator.height, 64);
    assert.equal(separator.style, 'margin-left: 8px;');
    assert.equal(dock.dash._box.layout_manager.spacing, 9);
});

test('opening and closing an unpinned app keeps the resting dock at 34 px despite native redisplay bounds', async () => {
    const {dock, icons, allocate, constraints, layoutManager} = await setup(3);
    constraints.availableHeight = 1200;
    const background = await createBackground();
    function paint(progress, transientOffset = 0) {
        dock._dockHoverProgress = progress;
        for (const icon of icons) icon._fixedPosition = icon.get_transformed_position();
        icons.at(-1)._fixedPosition[0] += transientOffset;
        background.update({first: icons[0], last: icons.at(-1),
            iconSize: dock._iconSizeScaledDown, scaleFactor: 1, vertical: true,
            position: 'left', panel_mode: false, dock});
    }
    dock.layout(); allocate(); paint(0);
    assert.equal(background.width, 34);
    const initialHeight = dock.dash.height;
    paint(1);
    const expandedWidth = background.width;
    assert.ok(expandedWidth > 34, 'existing hover magnification is retained');

    const running = new NativeActor();
    running._icon = new NativeActor();
    running._grid = {iconSize: 48, icon: running._icon, setIconSize(size) {
        this.iconSize = size;
        this.icon = new NativeActor();
    }};
    dock.dash._box.add_child(running);
    icons.push(running);
    dock._onDockContentChanged();
    dock._ensureLayout(); allocate(); paint(0, 80);
    assert.equal(background.width, 34, 'native bounds cannot widen the resting body');
    assert.equal(background._canvas.state.width, 34);
    assert.equal(dock._restingWidth, 34);
    assert.equal(dock.dash.width, 34);
    assert.equal(dock._scrollView.width, 34);
    assert.ok(icons.every(icon => icon.width === 34));
    assert.equal(running._grid.iconSize, 30, 'new native 48 px textures fit the fixed body');
    assert.equal(dock.dash.height - initialHeight, running.height);
    paint(1);
    assert.equal(background.width, expandedWidth, 'expanded width also ignores app count');

    dock.dash._box.remove_child(running);
    icons.pop();
    dock._onDockContentChanged();
    dock._ensureLayout(); allocate(); paint(0);
    assert.equal(background.width, 34);
    assert.equal(dock.dash.height, initialHeight);
    assert.equal(dock.extension.icon_size, 48, 'Dual Edge preference is preserved');
    layoutManager.mode = 0;
    dock.layout();
    assert.equal(dock._iconSizeScaledDown, 48);
});
