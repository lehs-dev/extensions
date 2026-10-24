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
        'resource:///org/gnome/shell/ui/appFavorites.js': {getAppFavorites: () => ({getFavorites: () => []})},
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
    assert.equal(dash.get_parent(), dock._scrollBox);
    assert.equal(dock._modularViewport.overflow, true);
    assert.equal(dock._scaleFactor, 1, 'fractional monitor scale is not applied twice');
    assert.equal(dock._scaledDown, 1, 'overflow does not reduce configured icon size');
    assert.equal(dock.renderArea.clip.y, 14, 'render clip retains magnification headroom above source hit viewport');
    assert.ok(dock._modularViewport.contentTop > dock.renderArea.clip.y);
    const scroll = dock._scrollView;
    assert.equal(scroll.enable_mouse_scrolling, false, 'custom wheel handler owns each adjustment once');
    dock._onScrollEvent(dock.renderArea, {get_scroll_direction: () => 1});
    assert.equal(scroll.vadjustment.value, 48);
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

test('hidden modular Application Dock has no dwell or hover hit region', async () => {
    const {dock} = await setup(3);
    dock.extension.modular_show_appdock = false;
    dock.layout();
    assert.equal(dock.visible, false);
    assert.equal(dock.dwell.visible, false);
    assert.equal(dock.isWithinHoverArea([dock.x + 10, dock.y + 40]), false);
});

test('modular capsule remains stable while content scrolls and encloses a single magnified application', async () => {
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
    let scrollY = 0;
    const dock = {x: 0, y: 200, width: 150, height: 300, _modularViewport: {},
        isVertical: () => true,
        dash: {width: 60, height: 800, translationX: 0, translationY: 0,
            get_transformed_position: () => [0, 235 - scrollY]},
        extension: {desktopLayoutManager: {mode: 1}, background_style: 0,
            animation_magnify: 1, dock_padding: 0, flare_width: 14}};
    const first = {_icon: {translationX: 0, translationY: 0}};
    const params = {first, last: first, iconSize: 48, scaleFactor: 1,
        vertical: true, position: 'left', panel_mode: true, dock};
    background.update(params);
    assert.equal(background.opacity, 255, 'one running application still has an attached capsule');
    assert.equal(background.height, 300);
    assert.equal(background.y, 0);
    assert.ok(background.width >= 96, 'configured maximum magnification remains inside capsule');
    const width = background.width;
    scrollY = 450;
    background.update(params);
    assert.equal(background.height, 300);
    assert.equal(background.y, 0);
    assert.equal(background.width, width, 'scroll offsets never change capsule geometry');
    assert.equal(background._canvas.state.position, 'left');
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
