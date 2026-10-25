import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, Actor } from './helpers/shell.mjs';

class MockSignalActor extends Actor {
  _init(params = {}) { Object.assign(this, params); }
  get_preferred_height() {
    if (this.children.length) {
      const heights = this.children.filter(c => c.visible).map(c => c.get_preferred_height?.(-1)?.[1] ?? 26);
      const height = heights.reduce((a, b) => a + b, 0);
      return [height, height];
    }
    const height = this.text !== undefined ? 16 : 26;
    return [height, height];
  }
  constructor(params = {}) {
    super(params);
    this._styleProps = {};
  }
  set_child(child) {
    this.child = child;
    if (child) child.parent = this;
  }
  set_style(style) {
    this.style = style;
  }
  set_position(x, y) {
    if (Number.isNaN(x) || Number.isNaN(y))
      throw new Error(`clutter_actor_set_position: assertion '!isnan (x) && !isnan (y)' failed`);
    this.x = x;
    this.y = y;
  }
  set_size(w, h) {
    if (Number.isNaN(w) || Number.isNaN(h))
      throw new Error(`clutter_actor_set_size: assertion '!isnan (width) && !isnan (height)' failed`);
    this.width = w;
    this.height = h;
  }
  get_transformed_position() {
    return [this.x, this.y];
  }
  get_transformed_size() {
    return [this.width, this.height];
  }
  destroy() {
    if (this.destroyed) return;
    this.emit('destroy');
    this.destroyed = true;
    this.children.forEach(c => c.destroy?.());
  }
}

async function setupSystemDockEnvironment() {
  const settingsStore = new Map();
  class MockSettings {
    constructor({ schema_id } = {}) {
      this.schema_id = schema_id;
      this.listeners = new Map();
    }
    get_string(key) {
      return settingsStore.get(`${this.schema_id}:${key}`) ?? '24h';
    }
    set_string(key, val) {
      settingsStore.set(`${this.schema_id}:${key}`, val);
      this.emit(`changed::${key}`);
    }
    get_boolean(key) {
      return settingsStore.get(`${this.schema_id}:${key}`) ?? true;
    }
    set_boolean(key, val) {
      settingsStore.set(`${this.schema_id}:${key}`, val);
      this.emit(`changed::${key}`);
    }
    get_int(key) {
      return settingsStore.get(`${this.schema_id}:${key}`) ?? 0;
    }
    set_int(key, val) {
      settingsStore.set(`${this.schema_id}:${key}`, val);
      this.emit(`changed::${key}`);
    }
    connect(signal, cb) {
      const id = Symbol(signal);
      this.listeners.set(id, { signal, cb });
      return id;
    }
    disconnect(id) {
      this.listeners.delete(id);
    }
    emit(sig) {
      for (const { signal, cb } of this.listeners.values()) {
        if (signal === sig) cb();
      }
    }
  }

  const primaryMonitor = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    geometry_scale: 1.0,
    inFullscreen: false,
  };

  const panelBox = new MockSignalActor({
    visible: true,
    height: 32,
    translation_y: 0,
  });

  const uiGroup = new MockSignalActor();
  uiGroup.add_child(panelBox);

  const nativeDateMenu = {
    menu: {
      isOpen: false,
      sourceActor: null,
      _boxPointer: { _arrowSide: 0 },
      open() { this.isOpen = true; this.emit('open-state-changed', true); },
      close() { this.isOpen = false; this.emit('open-state-changed', false); },
      toggle() { if (this.isOpen) this.close(); else this.open(); },
      signals: new Map(),
      connect(name, cb) {
        const id = Symbol(name);
        this.signals.set(id, { name, cb });
        return id;
      },
      disconnect(id) { this.signals.delete(id); },
      emit(name, ...args) {
        for (const { name: s, cb } of this.signals.values()) {
          if (s === name) cb(this, ...args);
        }
      },
    },
    _indicator: new MockSignalActor({ visible: false, _count: 0 }),
  };

  const nativeQuickSettings = {
    menu: {
      isOpen: false,
      sourceActor: null,
      _boxPointer: { _arrowSide: 0 },
      open() { this.isOpen = true; this.emit('open-state-changed', true); },
      close() { this.isOpen = false; this.emit('open-state-changed', false); },
      toggle() { if (this.isOpen) this.close(); else this.open(); },
      signals: new Map(),
      connect(name, cb) {
        const id = Symbol(name);
        this.signals.set(id, { name, cb });
        return id;
      },
      disconnect(id) { this.signals.delete(id); },
      emit(name, ...args) {
        for (const { name: s, cb } of this.signals.values()) {
          if (s === name) cb(this, ...args);
        }
      },
    },
    _network: new MockSignalActor({ visible: true, _indicator: new MockSignalActor({ icon_name: 'network-wireless-signal-excellent-symbolic' }) }),
    _bluetooth: new MockSignalActor({ visible: true, _indicator: new MockSignalActor({ icon_name: 'bluetooth-active-symbolic' }) }),
    _volumeOutputIndicator: new MockSignalActor({
      visible: true,
      _indicator: new MockSignalActor({ icon_name: 'audio-volume-high-symbolic' }),
      _stream: { volume: 49152, is_muted: false, change_is_muted(m) { this.is_muted = m; }, push_volume() {} },
      _control: { get_vol_max_norm: () => 65536 },
    }),
    _system: new MockSignalActor({
      visible: true,
      _indicator: new MockSignalActor({ icon_name: 'battery-level-80-symbolic' }),
    }),
  };

  const chromeActors = new Set();
  const MainMock = {
    layoutManager: {
      primaryMonitor,
      primaryIndex: 0,
      monitors: [primaryMonitor],
      panelBox,
      uiGroup,
      addChrome(actor) {
        chromeActors.add(actor);
        uiGroup.add_child(actor);
      },
      removeChrome(actor) {
        chromeActors.delete(actor);
        if (actor.get_parent?.() === uiGroup) uiGroup.remove_child(actor);
      },
      connect() { return Symbol('monitors-changed'); },
      disconnect() {},
    },
    panel: {
      statusArea: {
        dateMenu: nativeDateMenu,
        quickSettings: nativeQuickSettings,
      },
    },
    uiGroup,
    sessionManager: {
      logout() {},
      shutdown() {},
    },
    screenShield: {
      lock() {},
    },
  };

  const StMock = {
    Widget: MockSignalActor,
    Button: MockSignalActor,
    BoxLayout: class extends MockSignalActor {
      constructor(params = {}) {
        if ('vertical' in params) {
          throw new Error('No property vertical on StBoxLayout');
        }
        super(params);
        this.orientation = params.orientation ?? 0;
        this.layout_manager = { orientation: this.orientation };
      }
    },
    Label: class extends MockSignalActor {
      constructor(params = {}) {
        super(params);
        this.text = params.text || '';
      }
    },
    Icon: class extends MockSignalActor {
      constructor(params = {}) {
        super(params);
        this.icon_name = params.icon_name || '';
        this.icon_size = params.icon_size || 22;
      }
    },
    DrawingArea: class extends MockSignalActor {
      constructor(params = {}) {
        super(params);
        this.repaints = 0;
        this.state = null;
      }
      queue_repaint() { this.repaints++; }
      set_state(s) { this.state = s; this.queue_repaint(); }
    },
    Side: { TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3 },
  };

  const ClutterMock = {
    Orientation: { HORIZONTAL: 0, VERTICAL: 1 },
    ActorAlign: { CENTER: 0, START: 1, END: 2 },
    BinLayout: class {},
    BoxLayout: class { constructor() { this.orientation = 0; } },
    KEY_Return: 65293,
    KEY_space: 32,
    EVENT_STOP: true,
    EVENT_PROPAGATE: false,
    ScrollDirection: { UP: 0, DOWN: 1, SMOOTH: 4 },
  };

  const GObjectMock = {
    registerClass(meta, cls = meta) {
      return class Registered extends cls {
        constructor(...args) {
          super(...args);
          if (new.target === Registered && !this._initialized) this._init(...args);
        }
      };
    },
  };

  const GLibMock = {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    timeout_add_seconds: () => 1234,
    source_remove: () => true,
    DateTime: {
      new_now_local: () => ({
        format: fmt => (fmt === '%H' ? '20' : fmt === '%M' ? '36' : fmt === '%l' ? ' 8' : '20:36'),
        get_seconds: () => 15,
      }),
    },
  };

  const GioMock = {
    Settings: MockSettings,
  };

  const sharedMocks = {
    'resource:///org/gnome/shell/ui/main.js': MainMock,
    'resource:///org/gnome/shell/ui/boxpointer.js': { PopupAnimation: { FULL: 1, NONE: 0 } },
    'resource:///org/gnome/shell/ui/popupMenu.js': {
      PopupMenu: class {
        constructor(sourceActor, align, side) {
          this.sourceActor = sourceActor;
          this.side = side;
          this.isOpen = false;
          this.actor = new MockSignalActor();
        }
        open() { this.isOpen = true; }
        close() { this.isOpen = false; }
        addMenuItem() {}
        addAction() {}
      },
      PopupMenuItem: class extends MockSignalActor { constructor(text) { super(); this.text = text; } },
      PopupSeparatorMenuItem: class extends MockSignalActor {},
    },
    'gi://St': { default: StMock },
    'gi://Clutter': { default: ClutterMock },
    'gi://GObject': { default: GObjectMock },
    'gi://GLib': { default: GLibMock },
    'gi://Gio': { default: GioMock },
    'gi://cairo': { default: { Operator: { CLEAR: 0, OVER: 1 }, LineCap: { ROUND: 0 }, LineJoin: { ROUND: 0 } } },
  };

  return {
    MainMock,
    StMock,
    sharedMocks,
    settingsStore,
    primaryMonitor,
    panelBox,
    chromeActors,
    nativeDateMenu,
    nativeQuickSettings,
  };
}

/* =========================================================================
   1. VISUAL & GEOMETRY TESTS
   ========================================================================= */

test('System Dock Layout: Attaches flush to right screen edge and centers vertically', async () => {
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const geom = computeSystemDockGeometry({
    monitor,
    dockWidth: 44,
    flareWidth: 14,
    footDepth: 4,
    cornerRadius: 10,
    iconSize: 22,
    iconSpacing: 6,
    clockHeight: 36,
    showClock: true,
    itemsCount: 6,
    scaleFactor: 1.0,
  });

  // 1. Right edge attachment: x + width must exactly equal monitor.x + monitor.width
  assert.equal(geom.x + geom.width, monitor.x + monitor.width, 'Base of dock must be flush with right screen edge');
  assert.equal(geom.width, 44, 'Dock body width must match configured width 44px');

  // 2. Vertical centering: y must be centered within monitor height
  const expectedY = Math.round((monitor.height - geom.height) / 2);
  assert.equal(geom.y, expectedY, 'Dock must be vertically centered');
  assert.equal(geom.position, 'right', 'Attached edge orientation must be right');
});

test('System Dock Layout: Handles multi-monitor setups and negative origins correctly', async () => {
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  // Monitor with non-zero / offset origin
  const secondaryMonitor = { x: 1920, y: 120, width: 2560, height: 1440, geometry_scale: 1.0 };
  const geom1 = computeSystemDockGeometry({ monitor: secondaryMonitor, dockWidth: 44 });
  assert.equal(geom1.x + geom1.width, secondaryMonitor.x + secondaryMonitor.width);
  assert.equal(geom1.y, secondaryMonitor.y + Math.round((secondaryMonitor.height - geom1.height) / 2));

  // Monitor with negative x origin (left display)
  const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const geom2 = computeSystemDockGeometry({ monitor: leftMonitor, dockWidth: 44 });
  assert.equal(geom2.x + geom2.width, 0, 'Right edge of left monitor is at x = 0');
});

test('System Dock Layout: Fractional and HiDPI scaling scales geometry without rounding gaps', async () => {
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 3840, height: 2160, geometry_scale: 2.0 };
  const geom = computeSystemDockGeometry({
    monitor,
    dockWidth: 44,
    flareWidth: 14,
    footDepth: 4,
    scaleFactor: 2.0,
    itemsCount: 5,
  });

  assert.equal(geom.width, 88, '44px logical width scaled by 2.0 must be 88px');
  assert.equal(geom.flareWidth, 28, '14px flare scaled by 2.0 must be 28px');
  assert.equal(geom.footDepth, 8, '4px foot depth scaled by 2.0 must be 8px');
  assert.equal(geom.x + geom.width, monitor.width, 'Attached edge must remain flush under 2x scaling');
});

test('System Dock Layout: Dynamic height updates when items are toggled', async () => {
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };

  // All 6 items + clock
  const geomFull = computeSystemDockGeometry({ monitor, showClock: true, itemsCount: 6 });
  // Clock hidden, only 2 items
  const geomMinimal = computeSystemDockGeometry({ monitor, showClock: false, itemsCount: 2 });

  assert.ok(geomFull.height > geomMinimal.height, 'Height must shrink when items/clock are hidden');
  assert.ok(geomMinimal.height >= geomMinimal.width, 'Height must never be less than width');
});

test('System Dock Attached Edge: Geometry mirrors left dock and preserves flare symmetry and overshoots', async () => {
  const { getAttachedEdgeGeometry } = await loadModule(
    'dash2dock-lite@custom/attachedBackground.js',
    {
      mocks: {
        'gi://GObject': { default: { registerClass: (m, c) => c } },
        'gi://St': { default: { DrawingArea: Actor } },
        'gi://cairo': { default: {} },
      },
    }
  );

  const geomRight = getAttachedEdgeGeometry({
    width: 44,
    height: 300,
    flareWidth: 14,
    footDepth: 4,
    cornerRadius: 10,
    scaleFactor: 1.0,
    position: 'right',
  });

  // Base is at x = w (44). Screen edge is at x = 44.
  assert.equal(geomRight.leftFootTip.x, 44, 'Top foot tip attaches at screen edge x = 44');
  assert.equal(geomRight.leftFootTip.y, 0, 'Top foot tip is at y = 0');
  assert.equal(geomRight.rightFootTip.x, 44, 'Bottom foot tip attaches at screen edge x = 44');
  assert.equal(geomRight.rightFootTip.y, 300, 'Bottom foot tip is at y = 300');

  // Inner crown faces into the screen to the left (x = 0)
  assert.equal(geomRight.topLeft.x, 0, 'Crown starts at x = 0 facing inside');
  assert.equal(geomRight.topRight.x, 0, 'Crown ends at x = 0 facing inside');

  // Flare symmetry: top and bottom flares span equal length fw (14)
  assert.equal(geomRight.leftBodyBottom.y, 14, 'Top flare boundary is at y = 14');
  assert.equal(geomRight.rightBodyBottom.y, 300 - 14, 'Bottom flare boundary is at y = 286');

  // Subpixel overshoot into screen edge (w + 2 = 46)
  assert.equal(geomRight.leftFootTipOvershoot.x, 46, 'Top foot overshoot extends 2px past screen edge');
  assert.equal(geomRight.rightFootTipOvershoot.x, 46, 'Bottom foot overshoot extends 2px past screen edge');
});

test('System Dock Hover: Strict silhouette hit testing allows transparent corner click-through', async () => {
  const { isWithinSystemDockHoverArea } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const dockRect = { x: 1876, y: 390, width: 44, height: 300 };
  const fw = 14;
  const fd = 4;

  // 1. Center of solid body: inside
  assert.ok(isWithinSystemDockHoverArea([1890, 540], dockRect, fw, fd), 'Center of body must be hit');

  // 2. Far outside bounding box: outside
  assert.ok(!isWithinSystemDockHoverArea([1800, 540], dockRect, fw, fd), 'Outside bounding box x must be false');
  assert.ok(!isWithinSystemDockHoverArea([1890, 200], dockRect, fw, fd), 'Outside bounding box y must be false');

  // 3. Top-left corner of bounding box (outer flare transparent zone):
  // x is between 1876 and 1876 + 44 - 4 = 1916; y is within flare zone (390..404)
  assert.ok(!isWithinSystemDockHoverArea([1880, 395], dockRect, fw, fd), 'Top-left cutout outside flare curve must be transparent');

  // 4. Bottom-left corner of bounding box (outer flare transparent zone):
  assert.ok(!isWithinSystemDockHoverArea([1880, 685], dockRect, fw, fd), 'Bottom-left cutout outside flare curve must be transparent');

  // 5. Attached foot tip against right screen edge:
  assert.ok(isWithinSystemDockHoverArea([1918, 395], dockRect, fw, fd), 'Attached foot at right edge must be solid hit');
  assert.ok(isWithinSystemDockHoverArea([1918, 685], dockRect, fw, fd), 'Attached foot at bottom right edge must be solid hit');
});

/* =========================================================================
   2. FUNCTIONAL INDICATOR TESTS
   ========================================================================= */

test('System State: Clock formats stacked digits upright and updates on minute boundary', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemState } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemState.js',
    { mocks: env.sharedMocks }
  );

  const state = new SystemState();
  assert.equal(state.time.hours, '20', 'Hour must be upright tabular digit');
  assert.equal(state.time.minutes, '36', 'Minute must be upright tabular digit');

  let clockUpdate = null;
  state.addListener((event, data) => {
    if (event === 'clock-changed') clockUpdate = data;
  });

  // Switch to 12h clock
  env.settingsStore.set('org.gnome.desktop.interface:clock-format', '12h');
  state._updateClock();
  assert.equal(clockUpdate.hours, '8', '12h clock should format hour without leading zero');
  assert.equal(clockUpdate.minutes, '36');

  state.destroy();
});

test('System State: Audio volume, mute, and scroll adjustments reflect in state', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemState } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemState.js',
    { mocks: env.sharedMocks }
  );

  const state = new SystemState();
  assert.equal(state.audio.muted, false);
  assert.equal(state.audio.iconName, 'audio-volume-high-symbolic');

  // Adjust volume down via scroll handler
  state.adjustVolume(-0.2);
  assert.ok(state.audio.volume <= 0.6, 'Volume must decrease');

  // Toggle mute
  state.toggleMute();
  assert.equal(state.audio.muted, true);
  assert.equal(state.audio.iconName, 'audio-volume-muted-symbolic');

  state.destroy();
});

test('System State: Network changes update icon name and connected status', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemState } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemState.js',
    { mocks: env.sharedMocks }
  );

  const state = new SystemState();
  assert.equal(state.network.connected, true);
  assert.equal(state.network.iconName, 'network-wireless-signal-excellent-symbolic');

  // Simulate network disconnect
  env.nativeQuickSettings._network._indicator.icon_name = 'network-wireless-offline-symbolic';
  state._updateNetwork();
  assert.equal(state.network.connected, false);
  assert.equal(state.network.iconName, 'network-wireless-offline-symbolic');

  state.destroy();
});

test('System State: Gracefully hides battery indicator on desktops without batteries', async () => {
  const env = await setupSystemDockEnvironment();

  // Desktop without battery: quickSettings has no battery indicator or visible=false
  env.nativeQuickSettings._system.visible = false;
  env.nativeQuickSettings._system._indicator.icon_name = '';

  const { SystemState } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemState.js',
    { mocks: env.sharedMocks }
  );

  const state = new SystemState();
  assert.equal(state.battery.present, false, 'Desktops without battery must have present=false');

  state.destroy();
});

test('System State: Notifications reflect unread counts and Do Not Disturb state', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemState } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemState.js',
    { mocks: env.sharedMocks }
  );

  const state = new SystemState();
  assert.equal(state.notifications.unreadCount, 0);
  assert.equal(state.notifications.dnd, false);

  // Unread notification arrived
  env.nativeDateMenu._indicator.visible = true;
  env.nativeDateMenu._indicator._count = 3;
  state._updateNotifications();
  assert.equal(state.notifications.unreadCount, 3);
  assert.equal(state.notifications.iconName, 'preferences-system-notifications-symbolic');

  // Turn on DND (show-banners = false)
  env.settingsStore.set('org.gnome.desktop.notifications:show-banners', false);
  state._updateNotifications();
  assert.equal(state.notifications.dnd, true);
  assert.equal(state.notifications.iconName, 'notifications-disabled-symbolic');

  state.destroy();
});

/* =========================================================================
   3. MENU RE-ANCHORING & POSITIONING TESTS
   ========================================================================= */

test('System Menus: Opens native menu anchored to button with St.Side.RIGHT (opens to LEFT)', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemMenus } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemMenus.js',
    { mocks: env.sharedMocks }
  );

  const sourceButton = new env.StMock.Button();
  sourceButton.x = 1876;
  sourceButton.y = 450;
  sourceButton.width = 44;
  sourceButton.height = 44;

  const menus = new SystemMenus({ state: {} });

  // 1. Trigger Quick Settings menu
  menus.toggleQuickSettings(sourceButton, 'network');
  const qsMenu = env.nativeQuickSettings.menu;

  assert.equal(qsMenu.isOpen, true, 'Quick settings menu must open');
  assert.equal(qsMenu.sourceActor, sourceButton, 'Menu must be anchored to the dock button');
  assert.equal(qsMenu._boxPointer._arrowSide, env.StMock.Side.RIGHT, 'Arrow side must be RIGHT so menu opens to LEFT');

  // 2. Close menu and verify original anchor restoration
  qsMenu.close();
  assert.equal(qsMenu.isOpen, false);
  assert.equal(qsMenu.sourceActor, null, 'Source actor must restore cleanly on close');

  menus.destroy();
});

/* =========================================================================
   4. TOP BAR INTEGRATION & JUST PERFECTION COORDINATION
   ========================================================================= */

test('Top Bar Management: Safely hides panel and restores on disable', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  const extensionMock = {
    system_dock_hide_topbar: true,
    system_dock_show_clock: true,
    system_dock_show_network: true,
    system_dock_show_bluetooth: true,
    system_dock_show_volume: true,
    system_dock_show_battery: true,
    system_dock_show_notifications: true,
    system_dock_show_power: true,
  };

  const dock = new SystemDock({ extension: extensionMock });
  dock.enable();

  // Top Bar should be hidden safely
  assert.equal(env.panelBox.visible, false, 'Panel box must be hidden when system_dock_hide_topbar is enabled');
  assert.ok(env.panelBox.translation_y < 0, 'Panel box must be translated off screen');

  // Disabling System Dock restores top panel
  dock.destroy();
  assert.equal(env.panelBox.visible, true, 'Panel box must be restored visible on disable');
  assert.equal(env.panelBox.translation_y, 0, 'Panel box translation must reset to 0');
});

test('Top Bar Management: Respects Just Perfection if it already owns panel visibility', async () => {
  const env = await setupSystemDockEnvironment();

  // Just Perfection has panel turned off (false)
  env.settingsStore.set('org.gnome.shell.extensions.just-perfection:panel', false);
  env.panelBox.visible = false;

  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  const extensionMock = {
    system_dock_hide_topbar: true,
  };

  const dock = new SystemDock({ extension: extensionMock });
  dock.enable();
  dock.destroy();

  // Should NOT force panel visible if Just Perfection hid it
  assert.equal(env.panelBox.visible, false, 'Should not force panel visible if Just Perfection has it disabled');
});

/* =========================================================================
   5. SETTINGS & LIFECYCLE CLEANUP
   ========================================================================= */

test('System Dock: Settings toggles update visibility and destroy cleans up all resources', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  const extensionMock = {
    system_dock_show_clock: true,
    system_dock_show_network: true,
    system_dock_show_bluetooth: false,
    system_dock_show_volume: true,
    system_dock_show_battery: true,
    system_dock_show_notifications: true,
    system_dock_show_power: true,
    system_dock_icon_size: 22,
    system_dock_icon_spacing: 6,
    system_dock_width: 44,
  };

  const dock = new SystemDock({ extension: extensionMock });
  dock.enable();

  assert.equal(dock._items.get('bluetooth').visible, false, 'Bluetooth should be hidden by setting');
  assert.equal(dock._items.get('clock').visible, true, 'Clock should be visible');

  // Toggle bluetooth on
  extensionMock.system_dock_show_bluetooth = true;
  dock.onSettingsChanged('system-dock-show-bluetooth', true);
  assert.equal(dock._items.get('bluetooth').visible, true, 'Bluetooth should become visible');

  // Destroy dock: verify cleanup
  dock.destroy();
  assert.equal(dock._enabled, false);
  assert.equal(dock._signals.length, 0, 'Signals must be cleared on destroy');
  assert.equal(dock._items.size, 0, 'Items map must be cleared');
  assert.equal(env.chromeActors.has(dock), false, 'Dock actor must be removed from chrome');
});

/* =========================================================================
   6. SCREEN FRAME (6PX DESKTOP FRAME)
   ========================================================================= */

test('ScreenFrame: Edge geometry calculation produces exact zero-gap, zero-overlap invariants', async () => {
  const env = await setupSystemDockEnvironment();
  const { computeScreenFrameEdgeGeometries } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    { mocks: env.sharedMocks }
  );

  // 1. Standard 1080p display with 6px thickness
  const geom1080 = computeScreenFrameEdgeGeometries({
    monitor: { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 },
    thickness: 6,
    scaleFactor: 1.0,
  });

  assert.equal(geom1080.thickness, 6);
  assert.deepEqual({ ...geom1080.top }, { x: 0, y: 0, width: 1920, height: 6 });
  assert.deepEqual({ ...geom1080.bottom }, { x: 0, y: 1074, width: 1920, height: 6 });
  assert.deepEqual({ ...geom1080.left }, { x: 0, y: 6, width: 6, height: 1068 });
  assert.deepEqual({ ...geom1080.right }, { x: 1914, y: 6, width: 6, height: 1068 });

  // Mathematical zero-gap invariant:
  // Along left edge: y spans [0, 6) on top, [6, 1074) on left, [1074, 1080) on bottom
  assert.equal(geom1080.top.height + geom1080.left.height + geom1080.bottom.height, 1080);
  // Along right edge:
  assert.equal(geom1080.top.height + geom1080.right.height + geom1080.bottom.height, 1080);

  // Area partition invariant:
  const frameArea =
    geom1080.top.width * geom1080.top.height +
    geom1080.bottom.width * geom1080.bottom.height +
    geom1080.left.width * geom1080.left.height +
    geom1080.right.width * geom1080.right.height;
  const expectedArea = 1920 * 1080 - (1920 - 12) * (1080 - 12);
  assert.equal(frameArea, expectedArea, 'Total frame area must exactly equal outer minus inner area');

  // 2. High-DPI Display: stage coordinates remain logical at 1.5x
  const geomHidpi = computeScreenFrameEdgeGeometries({
    monitor: { x: 1920, y: 0, width: 3840, height: 2160, geometry_scale: 1.5 },
    thickness: 6,
    scaleFactor: 1.5,
  });
  assert.equal(geomHidpi.thickness, 6);
  assert.deepEqual({ ...geomHidpi.top }, { x: 1920, y: 0, width: 3840, height: 6 });
  assert.deepEqual({ ...geomHidpi.bottom }, { x: 1920, y: 2154, width: 3840, height: 6 });
  assert.deepEqual({ ...geomHidpi.left }, { x: 1920, y: 6, width: 6, height: 2148 });
  assert.deepEqual({ ...geomHidpi.right }, { x: 1920 + 3840 - 6, y: 6, width: 6, height: 2148 });

  // 3. Multi-monitor with negative origin
  const geomNegative = computeScreenFrameEdgeGeometries({
    monitor: { x: -1920, y: -200, width: 1920, height: 1200, geometry_scale: 1.0 },
    thickness: 6,
    scaleFactor: 1.0,
  });
  assert.equal(geomNegative.thickness, 6);
  assert.deepEqual({ ...geomNegative.top }, { x: -1920, y: -200, width: 1920, height: 6 });
  assert.deepEqual({ ...geomNegative.bottom }, { x: -1920, y: -200 + 1200 - 6, width: 1920, height: 6 });
  assert.deepEqual({ ...geomNegative.left }, { x: -1920, y: -200 + 6, width: 6, height: 1188 });
  assert.deepEqual({ ...geomNegative.right }, { x: -6, y: -200 + 6, width: 6, height: 1188 });
});

test('ScreenFrame: Zero thickness or degenerate dimensions return safe zeroed rects', async () => {
  const env = await setupSystemDockEnvironment();
  const { computeScreenFrameEdgeGeometries } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    { mocks: env.sharedMocks }
  );

  const zeroThickness = computeScreenFrameEdgeGeometries({
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    thickness: 0,
  });
  assert.equal(zeroThickness.thickness, 0);
  assert.equal(zeroThickness.top.width, 0);

  const negativeDim = computeScreenFrameEdgeGeometries({
    monitor: { x: 0, y: 0, width: -100, height: 1080 },
    thickness: 6,
  });
  assert.equal(negativeDim.thickness, 0);
});

test('ScreenFrame: Edge actors are strictly non-reactive and pass through all pointer events', async () => {
  const env = await setupSystemDockEnvironment();
  const { ScreenFrame } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    {
      mocks: env.sharedMocks,
    }
  );

  const extensionMock = {
    screen_frame_thickness: 6,
    screen_frame_color: [0.07, 0.07, 0.08, 0.95],
    screen_frame_opacity: 0.95,
    screen_frame_all_monitors: false,
  };

  const frame = new ScreenFrame({ extension: extensionMock });
  frame.enable();

  assert.equal(frame._actors.length, 1, 'A single Cairo ring paints all four edges without seams');

  for (const edge of frame._actors) {
    assert.equal(edge.reactive, false, 'Edge actor must be non-reactive');
    assert.equal(edge.track_hover, false, 'Edge actor must not track hover');
    assert.equal(edge.can_focus, false, 'Edge actor must not accept focus');
    assert.equal(env.chromeActors.has(edge), true, 'Edge actor must be added to Chrome');
  }

  // Cleanup
  frame.destroy();
  assert.equal(frame._actors.length, 0);
  assert.equal(frame._signals.length, 0);
  assert.equal(frame._enabled, false);
});

test('ScreenFrame: Multi-monitor, settings updates, fullscreen suppression, and independent lifecycle', async () => {
  const env = await setupSystemDockEnvironment();

  // Configure 2 monitors
  const monitor1 = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0, index: 0, inFullscreen: false };
  const monitor2 = { x: 1920, y: 0, width: 2560, height: 1440, geometry_scale: 1.0, index: 1, inFullscreen: false };
  env.MainMock.layoutManager.monitors = [monitor1, monitor2];
  env.MainMock.layoutManager.primaryMonitor = monitor1;

  const { ScreenFrame } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    {
      mocks: env.sharedMocks,
    }
  );

  const extensionMock = {
    screen_frame_thickness: 6,
    screen_frame_color: [0.07, 0.07, 0.08, 0.95],
    screen_frame_opacity: 0.95,
    screen_frame_all_monitors: true,
  };

  const frame = new ScreenFrame({ extension: extensionMock });
  frame.enable();

  // A single non-reactive ring per monitor.
  assert.equal(frame._actors.length, 2);

  // Change thickness setting to 8px
  extensionMock.screen_frame_thickness = 8;
  frame.onSettingsChanged('screen-frame-thickness', 8);

  const monitorFrame = frame._actors.find(e => e.monitorIndex === 0);
  assert.equal(monitorFrame.frameGeometry.thickness, 8, 'Ring thickness updates without overlapping edge actors');

  // Fullscreen suppression test: monitor2 enters fullscreen
  monitor2.inFullscreen = true;
  frame._checkFullscreen();

  const m1Edges = frame._actors.filter(e => e.monitorIndex === 0);
  const m2Edges = frame._actors.filter(e => e.monitorIndex === 1);

  m1Edges.forEach(e => assert.equal(e.visible, true, 'Monitor 1 edges must remain visible'));
  m2Edges.forEach(e => assert.equal(e.visible, false, 'Monitor 2 edges must hide in fullscreen'));

  // Exit fullscreen
  monitor2.inFullscreen = false;
  frame._checkFullscreen();
  m2Edges.forEach(e => assert.equal(e.visible, true, 'Monitor 2 edges must restore visibility'));

  // Destroy
  frame.destroy();
  assert.equal(frame._actors.length, 0);
});

/* =========================================================================
   7. GSETTINGS SLIDER TYPES & PREFERENCE SERIALIZATION
   ========================================================================= */

test('Preferences Serialization: GSettings slider types correctly handle integer (i) vs double (d)', async () => {
  const env = await setupSystemDockEnvironment();
  const calls = [];
  const storedValues = new Map();

  const mockSettings = {
    settings_schema: {
      has_key(k) {
        return true;
      },
      get_key(k) {
        return {
          get_value_type() {
            return {
              dup_string() {
                if (
                  k === 'system-dock-icon-size' ||
                  k === 'system-dock-icon-spacing' ||
                  k === 'system-dock-width' ||
                  k === 'screen-frame-thickness'
                ) {
                  return 'i';
                }
                return 'd';
              },
            };
          },
        };
      },
    },
    set_int(k, v) {
      calls.push({ method: 'set_int', key: k, val: v });
      storedValues.set(k, v);
    },
    get_int(k) {
      calls.push({ method: 'get_int', key: k });
      return storedValues.get(k) ?? 22;
    },
    set_double(k, v) {
      calls.push({ method: 'set_double', key: k, val: v });
      storedValues.set(k, v);
    },
    get_double(k) {
      calls.push({ method: 'get_double', key: k });
      return storedValues.get(k) ?? 14.0;
    },
    connect() {
      return 1;
    },
    disconnect() {},
  };

  const { PrefKeys } = await loadModule(
    'dash2dock-lite@custom/preferences/prefKeys.js',
    {
      mocks: env.sharedMocks,
    }
  );

  const prefKeys = new PrefKeys();
  prefKeys.setKeys({
    'system-dock-icon-size': {
      default_value: 22,
      widget_type: 'scale',
      value_type: 'i',
    },
    'system-dock-flare-width': {
      default_value: 14.0,
      widget_type: 'scale',
      value_type: 'd',
    },
  });

  prefKeys.connectSettings(mockSettings);

  // 1. Integer scale key: setting floating-point 24.7 should round to integer 25 and call set_int
  prefKeys.setValue('system-dock-icon-size', 24.7);
  const intCall = calls.find(c => c.method === 'set_int' && c.key === 'system-dock-icon-size');
  assert.ok(intCall, 'Must call set_int for integer scale key');
  assert.equal(intCall.val, 25, 'Float value must be rounded to nearest integer');

  // Verify that set_double was NOT called for integer key
  const badDoubleCall = calls.find(c => c.method === 'set_double' && c.key === 'system-dock-icon-size');
  assert.equal(badDoubleCall, undefined, 'Must NEVER call set_double for integer key');

  // 2. Double scale key: setting 14.5 should call set_double with float value
  prefKeys.setValue('system-dock-flare-width', 14.5);
  const doubleCall = calls.find(c => c.method === 'set_double' && c.key === 'system-dock-flare-width');
  assert.ok(doubleCall, 'Must call set_double for double scale key');
  assert.equal(doubleCall.val, 14.5);
});

test('Geometry Fallbacks: Gracefully restores defaults when preferences provide 0 or negative values', async () => {
  const env = await setupSystemDockEnvironment();
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js',
    { mocks: env.sharedMocks }
  );

  // If broken preferences yield 0 for dockWidth, iconSize, etc., fallback safely
  const geom = computeSystemDockGeometry({
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    dockWidth: 0,
    iconSize: 0,
    flareWidth: 0,
    footDepth: 0,
  });

  assert.equal(geom.width, 48, 'Must fallback to default 48px when width is 0');
  assert.equal(geom.flareWidth, 14, 'Must fallback to default 14px when flareWidth is 0');
  assert.equal(geom.footDepth, 4, 'Must fallback to default 4px when footDepth is 0');
  assert.ok(geom.height > 50, 'Height must be non-zero');
});

test('Visual Smoke Test: DebugVisuals renders magenta box and top line correctly on Chrome', async () => {
  const env = await setupSystemDockEnvironment();
  const { DebugVisuals } = await loadModule(
    'dash2dock-lite@custom/debugVisuals.js',
    { mocks: env.sharedMocks }
  );

  const debug = new DebugVisuals();
  debug.enable();

  assert.ok(debug._rect, 'Magenta box actor must be created');
  assert.ok(debug._line, 'Magenta top line actor must be created');

  assert.equal(debug._rect.reactive, false, 'Box must be non-reactive');
  assert.equal(debug._line.reactive, false, 'Line must be non-reactive');

  assert.equal(debug._rect.width, 40, 'Box logical width must be 40px');
  assert.equal(debug._rect.height, 120, 'Box logical height must be 120px');
  assert.equal(debug._line.height, 6, 'Line height must be 6px');
  assert.equal(debug._line.width, 1920, 'Line width must cover monitor width');

  assert.equal(env.chromeActors.has(debug._rect), true, 'Box must be added to Chrome');
  assert.equal(env.chromeActors.has(debug._line), true, 'Line must be added to Chrome');

  debug.destroy();
  assert.equal(debug._rect, null);
  assert.equal(debug._line, null);
});

test('Top Bar Safety: Does not hide top bar when System Dock is unallocated or invalid', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  env.panelBox.visible = true;
  env.panelBox.translation_y = 0;

  const extensionMock = {
    system_dock_hide_topbar: true,
  };

  const dock = new SystemDock({ extension: extensionMock });
  // Intentionally do not add to Chrome / stage (dock has width 0, no parent)
  dock.width = 0;
  dock.height = 0;

  dock._manageTopBar(true);

  // Top Bar must NOT be hidden because dock is not valid
  assert.equal(env.panelBox.visible, true, 'Top Bar must remain visible when dock is invalid');
  assert.equal(env.panelBox.translation_y, 0);

  dock.destroy();
});

test('Content Measurement: True measured height encloses all items including Power button strictly inside straight body', async () => {
  const { computeSystemDockGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const measuredHeight = 280;

  const geom = computeSystemDockGeometry({
    monitor,
    dockWidth: 48,
    flareWidth: 14,
    footDepth: 4,
    cornerRadius: 10,
    iconSize: 18,
    iconSpacing: 6,
    clockHeight: 36,
    measuredContentHeight: measuredHeight,
    scaleFactor: 1.0,
  });

  // Verify dock dimensions
  assert.equal(geom.width, 48, 'Dock width must be 48px');
  assert.equal(geom.x + geom.width, monitor.width, 'Dock right edge must be flush with monitor edge');

  // Verify content placement strictly inside straight body (between flareWidth and height - flareWidth)
  assert.ok(geom.contentTop >= geom.flareWidth, 'Content top must start after upper flare');
  const contentBottom = geom.contentTop + measuredHeight;
  const bottomFlareStart = geom.height - geom.flareWidth;

  assert.ok(
    contentBottom <= bottomFlareStart,
    `Content bottom (${contentBottom}) must not exceed straight body before bottom flare starts (${bottomFlareStart})`
  );

  // Power button at contentBottom is strictly enclosed with at least 6px clearance
  const clearance = bottomFlareStart - contentBottom;
  assert.ok(clearance >= 6, `Clearance below bottom item (${clearance}px) must be at least 6px`);
});

test('Visual Hierarchy: Separators adapt dynamically to indicator visibility', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  const extensionMock = {
    system_dock_show_clock: true,
    system_dock_show_network: true,
    system_dock_show_bluetooth: false,
    system_dock_show_volume: false,
    system_dock_show_battery: false,
    system_dock_show_notifications: false,
    system_dock_show_power: true,
    system_dock_width: 48,
    system_dock_icon_size: 18,
    system_dock_icon_spacing: 6,
  };

  const dock = new SystemDock({ extension: extensionMock });
  dock.enable();

  const sepTop = dock._items.get('separator-top');
  const sepBottom = dock._items.get('separator-bottom');

  assert.ok(sepTop, 'Top separator must exist');
  assert.ok(sepBottom, 'Bottom separator must exist');
  assert.equal(sepTop.visible, true, 'Top separator must be visible between clock and network');
  assert.equal(sepBottom.visible, true, 'Bottom separator must be visible before power');

  // Hide network: only clock and power remain
  extensionMock.system_dock_show_network = false;
  dock.updateLayout();

  assert.equal(sepTop.visible, false, 'Top separator must be hidden when middle items are absent');
  assert.equal(sepBottom.visible, true, 'Bottom separator remains between clock and power');

  // Hide power: only clock remains
  extensionMock.system_dock_show_power = false;
  dock.updateLayout();

  assert.equal(sepTop.visible, false, 'Top separator hidden when only clock is visible');
  assert.equal(sepBottom.visible, false, 'Bottom separator hidden when power is hidden');

  dock.destroy();
});

/* =========================================================================
   6. DESKTOP 3: LEFT MODULAR LAYOUT, ATTACHED EDGE, ROUNDED FRAME & GAPS
   ========================================================================= */

test('Desktop 3: Left Modular geometry coordinates three separate capsules along left edge', async () => {
  const { computeLeftModularGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const geom = computeLeftModularGeometry({
    monitor,
    dockWidth: 48,
    flareWidth: 14,
    footDepth: 4,
    cornerRadius: 10,
    iconSpacing: 6,
    upperPodOffset: 12,
    lowerPodOffset: 12,
    minSpacing: 16,
    quickSettingsContentHeight: 120,
    clockContentHeight: 110,
    appDockContentHeight: 300,
  });

  // 1. Quick Settings Pod attached to top-left
  assert.equal(geom.quickSettings.x, 0, 'Quick Settings Pod must attach to left edge (x=0)');
  assert.equal(geom.quickSettings.y, 12, 'Quick Settings Pod y must match upperPodOffset (12px)');
  assert.equal(geom.quickSettings.position, 'left', 'Quick Settings Pod orientation must be left');
  assert.ok(geom.quickSettings.height > 120, 'Quick Settings Pod height must enclose content + flares');

  // 2. Clock Pod attached to bottom-left
  assert.equal(geom.clock.x, 0, 'Clock Pod must attach to left edge (x=0)');
  assert.equal(geom.clock.y, 1080 - 12 - geom.clock.height, 'Clock Pod must sit lowerPodOffset above bottom edge');
  assert.equal(geom.clock.position, 'left', 'Clock Pod orientation must be left');

  // 3. Spacing invariants: Three distinct capsules separated by visible gaps >= minSpacing
  const qsBottom = geom.quickSettings.y + geom.quickSettings.height;
  const clockTop = geom.clock.y;
  assert.ok(geom.appDock.topBoundary >= qsBottom + 16, 'Gap above Application Dock must be >= minSpacing (16px)');
  assert.ok(geom.appDock.bottomBoundary <= clockTop - 16, 'Gap below Application Dock must be >= minSpacing (16px)');

  // 4. Application dock centered in remaining vertical space
  const availableH = geom.appDock.bottomBoundary - geom.appDock.topBoundary;
  assert.equal(geom.appDock.availableHeight, availableH, 'Application Dock available height matches remaining region');
  assert.ok(geom.appDock.centerY >= geom.appDock.topBoundary, 'Application Dock center Y inside boundaries');
});

test('Desktop 3: Deterministic collision avoidance bounds tall Application Dock', async () => {
  const { computeLeftModularGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  // Many pinned apps: dock requests 900px height
  const geom = computeLeftModularGeometry({
    monitor,
    dockWidth: 48,
    upperPodOffset: 12,
    lowerPodOffset: 12,
    minSpacing: 16,
    quickSettingsContentHeight: 180,
    clockContentHeight: 150,
    appDockContentHeight: 900,
  });

  const qsBottom = geom.quickSettings.y + geom.quickSettings.height;
  const clockTop = geom.clock.y;
  const maxAvailableH = (clockTop - 16) - (qsBottom + 16);

  assert.ok(geom.appDock.height <= maxAvailableH, 'Application Dock height must be clamped to available height');
  assert.ok(geom.appDock.y >= qsBottom + 16, 'Application Dock top must never overlap Quick Settings Pod');
  assert.ok(geom.appDock.y + geom.appDock.height <= clockTop - 16, 'Application Dock bottom must never overlap Clock Pod');
});

test('Desktop 3: Attached Edge strict silhouette hit testing for left-attached capsules', async () => {
  const { isWithinSystemDockHoverArea } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const dockRect = { x: 0, y: 100, width: 48, height: 200 };
  const flareWidth = 14;
  const footDepth = 4;

  // Solid inner body
  assert.ok(isWithinSystemDockHoverArea([24, 200], dockRect, flareWidth, footDepth, 'left'), 'Inside solid body');

  // Solid foot depth near left edge in flare zone
  assert.ok(isWithinSystemDockHoverArea([2, 105], dockRect, flareWidth, footDepth, 'left'), 'Within 4px foot depth in top flare');
  assert.ok(isWithinSystemDockHoverArea([2, 295], dockRect, flareWidth, footDepth, 'left'), 'Within 4px foot depth in bottom flare');

  // Transparent outer corner cutouts beyond footDepth
  assert.equal(isWithinSystemDockHoverArea([10, 105], dockRect, flareWidth, footDepth, 'left'), false, 'Transparent top flare cutout');
  assert.equal(isWithinSystemDockHoverArea([10, 295], dockRect, flareWidth, footDepth, 'left'), false, 'Transparent bottom flare cutout');

  // Completely outside
  assert.equal(isWithinSystemDockHoverArea([60, 200], dockRect, flareWidth, footDepth, 'left'), false, 'Outside dock bounds');
});

test('Menu Placement: Native anchors restored without replacing BoxPointer allocation', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemMenus } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemMenus.js',
    { mocks: env.sharedMocks }
  );

  const button = new env.StMock.Button();
  button.x = 1872;
  button.y = 500;
  button.width = 48;
  button.height = 36;

  const mockMenu = {
    isOpen: false,
    sourceActor: null,
    actor: { style: '' },
    _boxPointer: {
      _arrowSide: 0,
      _arrowAlignment: 0,
      x: 0,
      y: 0,
      width: 400,
      height: 600,
      _reposition() {
        // Mock default placement trying to align with button
        this.y = button.y - 100;
      },
    },
    open() {
      this.isOpen = true;
      this._boxPointer._reposition();
      this.emit('open-state-changed', true);
    },
    close() {
      this.isOpen = false;
      this.emit('open-state-changed', false);
    },
    listeners: new Map(),
    connect(sig, cb) {
      const id = Symbol(sig);
      this.listeners.set(id, { sig, cb });
      return id;
    },
    disconnect(id) {
      this.listeners.delete(id);
    },
    emit(sig, data) {
      for (const { sig: s, cb } of this.listeners.values()) {
        if (s === sig) cb(this, data);
      }
    },
  };

  const menus = new SystemMenus({ systemDock: { onMenuStateChanged: () => {} } });
  const originalReposition = mockMenu._boxPointer._reposition;
  menus._openNativeMenu(mockMenu, button);

  // Assertions while open
  assert.equal(mockMenu.sourceActor, button, 'sourceActor must be set to clicked button');
  assert.equal(mockMenu._boxPointer._arrowSide, env.StMock.Side.RIGHT, 'arrowSide must be St.Side.RIGHT');
  assert.ok(mockMenu.actor.style.includes('max-height:'), 'max-height constraint must be applied');

  assert.equal(mockMenu._boxPointer._reposition, originalReposition, 'Native allocation method stays untouched');

  // Close menu and verify complete cleanup
  mockMenu.close();
  assert.equal(mockMenu.sourceActor, null, 'sourceActor must be restored');
  assert.equal(mockMenu._boxPointer._arrowSide, 0, 'arrowSide must be restored');
  assert.equal(mockMenu.actor.style, '', 'actor style must be restored');

  menus.destroy();
});

test('Overlap Avoidance: Intellihide slides out when window overlaps active workspace', async () => {
  const env = await setupSystemDockEnvironment();

  // Mock an overlapping window on active workspace
  const activeWs = { index: () => 0 };
  const winActor = {
    get_meta_window: () => ({
      can_close: () => true,
      get_monitor: () => 0,
      get_workspace: () => activeWs,
      is_hidden: () => false,
      showing_on_its_workspace: () => true,
      get_frame_rect: () => ({
        x: 1800, // Overlaps dock at x = 1872
        y: 400,
        width: 120,
        height: 400,
      }),
    }),
  };

  let pointerPos = [100, 100]; // Pointer away from dock
  const mockGlobal = {
    workspace_manager: {
      get_active_workspace: () => activeWs,
      get_active_workspace_index: () => 0,
    },
    get_pointer: () => pointerPos,
    get_window_actors: () => [winActor],
    window_manager: {
      connect: () => Symbol('switch-workspace'),
      disconnect: () => {},
    },
    display: {
      connect: () => Symbol('restacked'),
      disconnect: () => {},
    },
  };

  const { SystemDock } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDock.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
      globals: {
        global: mockGlobal,
      },
    }
  );

  const extensionMock = {
    system_dock_behavior: 1, // Intellihide
    system_dock_width: 48,
    system_dock_icon_size: 18,
    system_dock_icon_spacing: 6,
  };

  const dock = new SystemDock({ extension: extensionMock });
  dock.enable();

  // Evaluate overlap
  dock._checkOverlap();
  assert.ok(dock.translation_x > 0, `Dock must hide when overlapped (translation_x: ${dock.translation_x})`);
  assert.equal(dock.translation_x, dock.width - 2, 'Must leave 2px trigger edge');

  // Simulate pointer approaching right edge
  pointerPos = [1918, 500]; // Within 6px of right edge
  dock._checkOverlap();
  assert.equal(dock.translation_x, 0, 'Dock must reveal when pointer approaches right edge');

  dock.destroy();
});

/* =========================================================================
   6. DESKTOP 3: LEFT MODULAR LAYOUT, ATTACHED EDGE, ROUNDED FRAME & GAPS
   ========================================================================= */

test('Desktop 3: Left Modular geometry coordinates three separate capsules along left edge', async () => {
  const { computeLeftModularGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const geom = computeLeftModularGeometry({
    monitor,
    dockWidth: 48,
    flareWidth: 14,
    footDepth: 4,
    cornerRadius: 10,
    iconSpacing: 6,
    upperPodOffset: 12,
    lowerPodOffset: 12,
    minSpacing: 16,
    quickSettingsContentHeight: 120,
    clockContentHeight: 110,
    appDockContentHeight: 300,
  });

  // 1. Quick Settings Pod attached to top-left
  assert.equal(geom.quickSettings.x, 0, 'Quick Settings Pod must attach to left edge (x=0)');
  assert.equal(geom.quickSettings.y, 12, 'Quick Settings Pod y must match upperPodOffset (12px)');
  assert.equal(geom.quickSettings.position, 'left', 'Quick Settings Pod orientation must be left');
  assert.ok(geom.quickSettings.height > 120, 'Quick Settings Pod height must enclose content + flares');

  // 2. Clock Pod attached to bottom-left
  assert.equal(geom.clock.x, 0, 'Clock Pod must attach to left edge (x=0)');
  assert.equal(geom.clock.y, 1080 - 12 - geom.clock.height, 'Clock Pod must sit lowerPodOffset above bottom edge');
  assert.equal(geom.clock.position, 'left', 'Clock Pod orientation must be left');

  // 3. Spacing invariants: Three distinct capsules separated by visible gaps >= minSpacing
  const qsBottom = geom.quickSettings.y + geom.quickSettings.height;
  const clockTop = geom.clock.y;
  assert.ok(geom.appDock.topBoundary >= qsBottom + 16, 'Gap above Application Dock must be >= minSpacing (16px)');
  assert.ok(geom.appDock.bottomBoundary <= clockTop - 16, 'Gap below Application Dock must be >= minSpacing (16px)');

  // 4. Application dock centered in remaining vertical space
  const availableH = geom.appDock.bottomBoundary - geom.appDock.topBoundary;
  assert.equal(geom.appDock.availableHeight, availableH, 'Application Dock available height matches remaining region');
  assert.ok(geom.appDock.centerY >= geom.appDock.topBoundary, 'Application Dock center Y inside boundaries');
});

test('Desktop 3: Deterministic collision avoidance bounds tall Application Dock', async () => {
  const { computeLeftModularGeometry } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  // Many pinned apps: dock requests 900px height
  const geom = computeLeftModularGeometry({
    monitor,
    dockWidth: 48,
    upperPodOffset: 12,
    lowerPodOffset: 12,
    minSpacing: 16,
    quickSettingsContentHeight: 180,
    clockContentHeight: 150,
    appDockContentHeight: 900,
  });

  const qsBottom = geom.quickSettings.y + geom.quickSettings.height;
  const clockTop = geom.clock.y;
  const maxAvailableH = (clockTop - 16) - (qsBottom + 16);

  assert.ok(geom.appDock.height <= maxAvailableH, 'Application Dock height must be clamped to available height');
  assert.ok(geom.appDock.y >= qsBottom + 16, 'Application Dock top must never overlap Quick Settings Pod');
  assert.ok(geom.appDock.y + geom.appDock.height <= clockTop - 16, 'Application Dock bottom must never overlap Clock Pod');
});

test('Desktop 3: Attached Edge strict silhouette hit testing for left-attached capsules', async () => {
  const { isWithinSystemDockHoverArea } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemDockLayout.js'
  );

  const dockRect = { x: 0, y: 100, width: 48, height: 200 };
  const flareWidth = 14;
  const footDepth = 4;

  // Solid inner body
  assert.ok(isWithinSystemDockHoverArea([24, 200], dockRect, flareWidth, footDepth, 'left'), 'Inside solid body');

  // Solid foot depth near left edge in flare zone
  assert.ok(isWithinSystemDockHoverArea([2, 105], dockRect, flareWidth, footDepth, 'left'), 'Within 4px foot depth in top flare');
  assert.ok(isWithinSystemDockHoverArea([2, 295], dockRect, flareWidth, footDepth, 'left'), 'Within 4px foot depth in bottom flare');

  // Transparent outer corner cutouts beyond footDepth
  assert.equal(isWithinSystemDockHoverArea([10, 105], dockRect, flareWidth, footDepth, 'left'), false, 'Transparent top flare cutout');
  assert.equal(isWithinSystemDockHoverArea([10, 295], dockRect, flareWidth, footDepth, 'left'), false, 'Transparent bottom flare cutout');

  // Completely outside
  assert.equal(isWithinSystemDockHoverArea([60, 200], dockRect, flareWidth, footDepth, 'left'), false, 'Outside dock bounds');
});

test('Desktop 3: Screen Frame geometry with rounded corners forms seamless zero-pixel gap/overlap', async () => {
  const env = await setupSystemDockEnvironment();
  const { computeScreenFrameGeometries } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    { mocks: env.sharedMocks }
  );

  const monitor = { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const geoms = computeScreenFrameGeometries({
    monitor,
    thickness: 6,
    cornerRadius: 12,
    scaleFactor: 1.0,
  });

  const C = 12; // Outer corner radius, with a 6px inner radius
  assert.equal(geoms.thickness, 6);
  assert.equal(geoms.cornerRadius, 12);
  assert.equal(geoms.cornerSize, C);

  // 1. Four corner cutouts: size C x C
  assert.equal(geoms.topLeft.x, 0);
  assert.equal(geoms.topLeft.y, 0);
  assert.equal(geoms.topLeft.width, C);
  assert.equal(geoms.topLeft.height, C);

  assert.equal(geoms.topRight.x, 1920 - C);
  assert.equal(geoms.topRight.y, 0);
  assert.equal(geoms.topRight.width, C);
  assert.equal(geoms.topRight.height, C);

  assert.equal(geoms.bottomLeft.x, 0);
  assert.equal(geoms.bottomLeft.y, 1080 - C);
  assert.equal(geoms.bottomLeft.width, C);
  assert.equal(geoms.bottomLeft.height, C);

  assert.equal(geoms.bottomRight.x, 1920 - C);
  assert.equal(geoms.bottomRight.y, 1080 - C);
  assert.equal(geoms.bottomRight.width, C);
  assert.equal(geoms.bottomRight.height, C);

  // 2. Straight edges fit precisely between corners without gap or overlap
  assert.equal(geoms.top.x, C, 'Top edge starts flush with top-left corner');
  assert.equal(geoms.top.width, 1920 - 2 * C, 'Top edge width spans exactly between top corners');
  assert.equal(geoms.top.x + geoms.top.width, geoms.topRight.x, 'Top edge meets top-right corner with 0px gap');

  assert.equal(geoms.bottom.x, C, 'Bottom edge starts flush with bottom-left corner');
  assert.equal(geoms.bottom.width, 1920 - 2 * C, 'Bottom edge width spans exactly between bottom corners');
  assert.equal(geoms.bottom.x + geoms.bottom.width, geoms.bottomRight.x, 'Bottom edge meets bottom-right corner with 0px gap');

  assert.equal(geoms.left.y, C, 'Left edge starts flush with top-left corner');
  assert.equal(geoms.left.height, 1080 - 2 * C, 'Left edge height spans exactly between left corners');
  assert.equal(geoms.left.y + geoms.left.height, geoms.bottomLeft.y, 'Left edge meets bottom-left corner with 0px gap');

  assert.equal(geoms.right.y, C, 'Right edge starts flush with top-right corner');
  assert.equal(geoms.right.height, 1080 - 2 * C, 'Right edge height spans exactly between right corners');
  assert.equal(geoms.right.y + geoms.right.height, geoms.bottomRight.y, 'Right edge meets bottom-right corner with 0px gap');
});

test('Desktop 3: Screen Frame fractional scaling and multi-monitor offset handling', async () => {
  const env = await setupSystemDockEnvironment();
  const { computeScreenFrameGeometries } = await loadModule(
    'dash2dock-lite@custom/screenFrame.js',
    { mocks: env.sharedMocks }
  );

  const secondaryMonitor = { x: 1920, y: 100, width: 2560, height: 1440, geometry_scale: 1.5 };
  const geoms = computeScreenFrameGeometries({
    monitor: secondaryMonitor,
    thickness: 6,
    cornerRadius: 12,
    scaleFactor: 1.5,
  });

  const scaledT = 6; // Stage coordinates are already logical
  const scaledR = 12;
  const C = scaledR;

  assert.equal(geoms.thickness, scaledT);
  assert.equal(geoms.cornerRadius, scaledR);
  assert.equal(geoms.topLeft.x, secondaryMonitor.x);
  assert.equal(geoms.topLeft.y, secondaryMonitor.y);
  assert.equal(geoms.top.x, secondaryMonitor.x + C);
  assert.equal(geoms.top.width, secondaryMonitor.width - 2 * C);
  assert.equal(geoms.top.x + geoms.top.width, secondaryMonitor.x + secondaryMonitor.width - C);
});

test('Desktop 3: Window Outer Gap coordinator adds frame thickness and coordinates with Tiling Assistant', async () => {
  const env = await setupSystemDockEnvironment();
  const { WindowGapCoordinator } = await loadModule(
    'dash2dock-lite@custom/windowGaps.js',
    { mocks: env.sharedMocks }
  );

  const extensionMock = {
    enable_window_outer_gap: true, desktopLayoutManager: {mode: 1},
    window_outer_gap_size: 8,
    enable_screen_frame: true,
    screen_frame_thickness: 6,
  };

  const coordinator = new WindowGapCoordinator({ extension: extensionMock });
  coordinator.enable();

  const gaps = coordinator.getScreenGaps(0, env.MainMock.layoutManager.primaryMonitor);
  assert.deepEqual({...gaps}, {top: 14, left: 14, right: 14, bottom: 14});
  assert.equal(env.settingsStore.has('org.gnome.shell.extensions.tiling-assistant:single-screen-gap'), false,
    'The live provider must never overwrite Tiling Assistant saved gaps');
  assert.equal(env.settingsStore.has('org.gnome.shell.extensions.tiling-assistant:maximize-with-gap'), false);

  coordinator.destroy();
  assert.equal(coordinator.getScreenGaps(0), null);
  assert.equal(coordinator._enabled, false);
});

test('Desktop 3: DesktopLayoutManager dynamically switches between Dual Edge and Left Modular', async () => {
  const env = await setupSystemDockEnvironment();
  const { DesktopLayoutManager, LayoutMode } = await loadModule(
    'dash2dock-lite@custom/desktopLayoutManager.js',
    {
      mocks: {
        ...env.sharedMocks,
        '../attachedBackground.js': { AttachedDockCanvas: env.StMock.DrawingArea },
      },
    }
  );

  const extensionMock = {
    desktop_layout: LayoutMode.DUAL_EDGE,
    enable_system_dock: true,
    system_dock_width: 48,
    system_dock_icon_size: 18,
    system_dock_icon_spacing: 6,
    modular_upper_pod_offset: 12,
    modular_lower_pod_offset: 12,
    modular_min_spacing: 16,
    docks: [],
  };

  const manager = new DesktopLayoutManager({ extension: extensionMock });
  manager.enable();

  // 1. Initial mode: Dual Edge
  assert.equal(manager.mode, LayoutMode.DUAL_EDGE);
  assert.ok(manager.systemDock !== null, 'System Dock active in Dual Edge');
  assert.equal(manager.quickSettingsPod, null, 'Quick Settings Pod not active in Dual Edge');
  assert.equal(manager.clockPod, null, 'Clock Pod not active in Dual Edge');

  // 2. Switch to Left Modular
  extensionMock.desktop_layout = LayoutMode.LEFT_MODULAR;
  manager.onSettingsChanged('desktop-layout', LayoutMode.LEFT_MODULAR);

  assert.equal(manager.systemDock, null, 'System Dock cleanly destroyed on switch to Left Modular');
  assert.ok(manager.quickSettingsPod !== null, 'Quick Settings Pod initialized in Left Modular');
  assert.ok(manager.clockPod !== null, 'Clock Pod initialized in Left Modular');
  assert.equal(manager.quickSettingsPod.dockPosition, 'left', 'Quick Settings Pod attached to left edge');
  assert.equal(manager.clockPod.dockPosition, 'left', 'Clock Pod attached to left edge');

  // 3. Switch back to Dual Edge
  extensionMock.desktop_layout = LayoutMode.DUAL_EDGE;
  manager.onSettingsChanged('desktop-layout', LayoutMode.DUAL_EDGE);

  assert.ok(manager.systemDock !== null, 'System Dock re-enabled on switch back to Dual Edge');
  assert.equal(manager.quickSettingsPod, null, 'Quick Settings Pod cleaned up on return to Dual Edge');
  assert.equal(manager.clockPod, null, 'Clock Pod cleaned up on return to Dual Edge');

  manager.destroy();
});

test('Desktop 3: Quick Settings and Calendar popups open to the RIGHT of left-attached pods', async () => {
  const env = await setupSystemDockEnvironment();
  const { SystemMenus } = await loadModule(
    'dash2dock-lite@custom/systemDock/systemMenus.js',
    { mocks: env.sharedMocks }
  );

  const ST_SIDE_LEFT = 3;
  const sourceButton = new env.StMock.Button();
  sourceButton.x = 0;
  sourceButton.y = 100;
  sourceButton.width = 48;
  sourceButton.height = 32;

  const menus = new SystemMenus({ state: { time: {} } });

  // 1. Toggle DateMenu in Left Modular mode (side: St.Side.LEFT)
  menus.toggleDateMenu(sourceButton, { side: ST_SIDE_LEFT });
  assert.equal(env.nativeDateMenu.menu.isOpen, true, 'DateMenu opened');
  assert.equal(env.nativeDateMenu.menu.sourceActor, sourceButton, 'Source actor anchored to pod button');
  assert.equal(env.nativeDateMenu.menu._boxPointer._arrowSide, ST_SIDE_LEFT, 'Arrow points LEFT so popup body appears to the RIGHT inside monitor');

  menus.closeAll();
  assert.equal(env.nativeDateMenu.menu.isOpen, false, 'DateMenu closed on closeAll');

  // 2. Toggle QuickSettings in Left Modular mode (side: St.Side.LEFT)
  menus.toggleQuickSettings(sourceButton, null, { side: ST_SIDE_LEFT });
  assert.equal(env.nativeQuickSettings.menu.isOpen, true, 'QuickSettings opened');
  assert.equal(env.nativeQuickSettings.menu._boxPointer._arrowSide, ST_SIDE_LEFT, 'Arrow points LEFT so popup body appears to the RIGHT inside monitor');

  menus.destroy();
});






test('Desktop 3: pods own separate nonreactive actors and release shared listeners on destroy', async () => {
  const env = await setupSystemDockEnvironment();
  const {SystemState} = await loadModule('dash2dock-lite@custom/systemDock/systemState.js', {mocks: env.sharedMocks});
  const {QuickSettingsPod, InputMethodPod, ClockPod} = await loadModule('dash2dock-lite@custom/systemDock/modularPods.js', {
    mocks: {...env.sharedMocks, '../attachedBackground.js': {AttachedDockCanvas: env.StMock.DrawingArea}},
  });
  const state = new SystemState();
  const baseline = state._listeners.size;
  const extension = {modular_indicator_icon_size: 20, modular_indicator_spacing: 8,
    modular_show_bluetooth: false, modular_clock_show_weekday: false,
    modular_clock_show_date: true, modular_clock_format: 1};
  const menus = {toggleDateMenu() {}, toggleQuickSettings() {}};
  let changes = 0;
  const quick = new QuickSettingsPod({extension, systemState: state, systemMenus: menus, onLayoutChanged: () => changes++});
  const clock = new ClockPod({extension, systemState: state, systemMenus: menus, onLayoutChanged: () => changes++});
  quick.enable(); clock.enable();
  assert.equal(quick.reactive, false);
  assert.equal(clock.reactive, false);
  assert.notEqual(quick._contentBox, clock._contentBox);
  assert.deepEqual([...quick._items.keys()], ['network', 'bluetooth', 'volume', 'battery']);
  assert.equal(quick._items.get('bluetooth').visible, false);
  assert.equal(quick._items.get('network')._icon.icon_size, 20);
  assert.equal(quick._items.get('network').side, env.StMock.Side.LEFT);
  const input = new InputMethodPod({extension, systemState: state, systemMenus: menus});
  assert.equal(input.hasUsableControls, false, 'No input pod is shown when native provider is unavailable');
  input.destroy();
  assert.equal(clock._clockItem._dayLabel.visible, false);
  assert.equal(clock._clockItem._hourLabel.text, state.time.hours24);
  const geometry = {x: -1920, y: 35, width: 44, height: 220, contentTop: 18, contentHeight: 184,
    flareWidth: 14, footDepth: 4, cornerRadius: 10, scaleFactor: 1.5};
  quick.place(geometry);
  assert.equal(quick.x, -1920);
  assert.equal(quick._canvas.state.scaleFactor, 1, 'Stage geometry must not be scaled again by renderer');
  assert.ok(changes >= 2);
  quick.destroy(); clock.destroy();
  assert.equal(state._listeners.size, baseline);
  assert.equal(env.chromeActors.size, 0);
  state.destroy();
});

test('Left Modular grows for recording, sharing and extra native indicators, and shrinks when they disappear', async () => {
  const env = await setupSystemDockEnvironment();
  const qs = env.nativeQuickSettings;
  qs._indicators = new MockSignalActor();
  for (const source of [qs._network, qs._bluetooth, qs._volumeOutputIndicator, qs._system]) {
    source.add_child(source._indicator);
    qs._indicators.add_child(source);
  }
  const privacy = new MockSignalActor({visible: false});
  const privacyIcon = new MockSignalActor({icon_name: 'media-record-symbolic'});
  privacy.add_child(privacyIcon);
  qs._indicators.add_child(privacy);
  const recording = new MockSignalActor({visible: false, accessible_name: 'Stop Screencast'});
  recording.add_child(new MockSignalActor({text: '0:00'}));
  recording.add_child(new MockSignalActor({icon_name: 'screencast-stop-symbolic'}));
  const sharing = new MockSignalActor({visible: false, accessible_name: 'Stop Screen Sharing'});
  sharing.add_child(new MockSignalActor({icon_name: 'screen-shared-symbolic'}));
  sharing.add_child(new MockSignalActor({icon_name: 'screencast-stop-symbolic'}));
  env.MainMock.panel.statusArea.screenRecording = recording;
  env.MainMock.panel.statusArea.screenSharing = sharing;
  let stops = 0, sharesStopped = 0, menusOpened = 0, layouts = 0;
  env.MainMock.screenshotUI = {stopScreencast() { stops++; }};
  sharing._stopSharing = () => sharesStopped++;
  const {SystemState} = await loadModule('dash2dock-lite@custom/systemDock/systemState.js', {mocks: env.sharedMocks});
  const {QuickSettingsPod} = await loadModule('dash2dock-lite@custom/systemDock/modularPods.js', {
    mocks: {...env.sharedMocks, '../attachedBackground.js': {AttachedDockCanvas: env.StMock.DrawingArea}},
  });
  const state = new SystemState();
  const pod = new QuickSettingsPod({extension: {}, systemState: state,
    systemMenus: {toggleQuickSettings() { menusOpened++; }}, onLayoutChanged: () => layouts++});
  pod.enable();
  const baseHeight = pod.getMeasuredContentHeight();
  assert.equal(state.dynamicIndicators.length, 0, 'fixed network/audio/battery icons are not duplicated');
  env.panelBox.visible = false;
  recording.visible = true;
  recording.emit('notify::visible');
  assert.equal(state.dynamicIndicators.length, 1, 'local native visibility works despite the hidden top bar');
  const record = state.dynamicIndicators[0];
  const recordButton = pod._items.get(`dynamic-${record.id}`);
  assert.ok(pod.getMeasuredContentHeight() > baseHeight, 'recording increases natural pod height');
  recordButton.emit('clicked');
  assert.equal(stops, 0, 'the unified pod opens Quick Settings from every status icon');
  assert.equal(menusOpened, 1);
  state.activateDynamicIndicator(record);
  assert.equal(stops, 1, 'native recording action remains owned by the existing provider');
  sharing.visible = true;
  sharing.emit('notify::visible');
  assert.equal(state.dynamicIndicators.filter(item => item.kind === 'sharing').length, 1,
    'two native sharing icons become one compact action');
  const share = state.dynamicIndicators.find(item => item.kind === 'sharing');
  pod._items.get(`dynamic-${share.id}`).emit('clicked');
  assert.equal(sharesStopped, 0);
  state.activateDynamicIndicator(share);
  assert.equal(sharesStopped, 1);
  privacy.visible = true;
  privacy.emit('notify::visible');
  const status = state.dynamicIndicators.find(item => item.source === privacy);
  pod._items.get(`dynamic-${status.id}`).emit('clicked');
  assert.equal(menusOpened, 3, 'every status opens the same native Quick Settings');
  const external = new MockSignalActor({visible: true});
  const externalIcon = new MockSignalActor({icon_name: 'camera-web-symbolic'});
  external.add_child(externalIcon);
  qs._indicators.add_child(external);
  const entry = state.dynamicIndicators.find(item => item.source === external);
  assert.ok(entry, 'an indicator added after enable is discovered');
  const button = pod._items.get(`dynamic-${entry.id}`);
  pod.getMeasuredContentWidth();
  const previousLayouts = layouts;
  externalIcon.icon_name = 'microphone-sensitivity-high-symbolic';
  externalIcon.emit('notify::icon-name');
  assert.equal(button._icon.icon_name, 'microphone-sensitivity-high-symbolic');
  assert.equal(pod._items.get(`dynamic-${entry.id}`), button, 'icon changes reuse the existing control');
  assert.equal(layouts, previousLayouts, 'a same-size icon update does not move the application dock');
  qs._indicators.remove_child(external);
  qs._indicators.emit('child-removed', external);
  assert.equal(pod._items.has(`dynamic-${entry.id}`), false);
  assert.equal(externalIcon.signals.size, 0, 'removed indicator subscriptions are released');
  for (const source of [recording, sharing, privacy]) {
    source.visible = false;
    source.emit('notify::visible');
  }
  assert.equal(pod.getMeasuredContentHeight(), baseHeight, 'pod returns to its original compact height');
  pod.destroy(); state.destroy();
  for (const actor of [qs._indicators, recording, sharing, privacy, privacyIcon])
    assert.equal(actor.signals.size, 0, 'dynamic provider subscriptions are released on disable');
});

test('Desktop 3: real Shell 51 providers track stream replacement, battery data and external input methods', async () => {
  const env = await setupSystemDockEnvironment();
  const qs = env.nativeQuickSettings;
  const firstStream = new MockSignalActor({volume: 32768, is_muted: false,
    set_volume(value) { this.volume = value; }, push_volume() {}, change_is_muted(value) { this.is_muted = value; }});
  const output = new MockSignalActor({stream: firstStream, _control: {get_vol_max_norm: () => 65536}});
  qs._volumeOutput = new MockSignalActor({_output: output, _indicator: new MockSignalActor({icon_name: 'audio-volume-medium-symbolic'})});
  const proxy = new MockSignalActor({IsPresent: true, Percentage: 42, State: 1});
  qs._system._systemItem = {powerToggle: new MockSignalActor({_proxy: proxy, visible: true, fallback_icon_name: 'battery-good-charging-symbolic'})};
  qs._bluetooth._client = new MockSignalActor({available: false, active: false});
  const kim = new MockSignalActor({visible: true, menu: {},
    labelIcon: new MockSignalActor({text: '中', visible: true}),
    mainIcon: new MockSignalActor({visible: false})});
  env.MainMock.panel.statusArea.kimpanel = kim;
  const {SystemState} = await loadModule('dash2dock-lite@custom/systemDock/systemState.js', {mocks: env.sharedMocks});
  const state = new SystemState();
  assert.equal(state.audio.volume, 0.5);
  state.adjustVolume(0.05);
  assert.equal(firstStream.volume, Math.round(65536 * 0.55));
  assert.equal(state.battery.percentage, 42);
  assert.equal(state.battery.charging, true);
  assert.equal(state.bluetooth.available, false, 'Indicator existence does not imply available hardware');
  assert.equal(state.inputSource.shortName, '中');
  assert.equal(state.inputSource.provider, 'kimpanel');
  kim.labelIcon.text = 'Vi'; kim.labelIcon.emit('notify::text');
  assert.equal(state.inputSource.shortName, 'Vi');
  const replacement = new MockSignalActor({volume: 16384, is_muted: true});
  output.stream = replacement; output.emit('stream-updated');
  assert.equal(state.audio.volume, 0.25);
  assert.equal(state.audio.muted, true);
  assert.equal(firstStream.signals.size, 0);
  state.destroy();
  for (const provider of [replacement, output, proxy, kim, kim.labelIcon, kim.mainIcon, qs._bluetooth._client])
    assert.equal(provider.signals.size, 0, 'Every provider subscription is disconnected');
});

test('native Wi-Fi names and Kimpanel property-only mode changes update SystemState and release their subscriptions', async () => {
  const env = await setupSystemDockEnvironment();
  const wireless = new MockSignalActor({checked: true, title: 'Wi-Fi', subtitle: 'Home Wi-Fi'});
  env.nativeQuickSettings._network._wirelessToggle = wireless;
  const modeLabel = new MockSignalActor({text: 'Vietnamese'});
  const methodLabel = new MockSignalActor({text: 'Telex'});
  const kim = new MockSignalActor({visible: true,
    menu: {box: new MockSignalActor()},
    labelIcon: new MockSignalActor({text: 'Vi', visible: true}),
    mainIcon: new MockSignalActor({visible: false}),
    _properties: {'/Fcitx/im': {label: 'Telex'}},
    _propertySwitch: {im: {label: methodLabel}, mode: {label: modeLabel}},
    kimpanel: {enabled: true}});
  env.MainMock.panel.statusArea.kimpanel = kim;
  const {SystemState} = await loadModule('dash2dock-lite@custom/systemDock/systemState.js', {mocks: env.sharedMocks});
  const state = new SystemState();
  assert.equal(state.network.name, 'Home Wi-Fi');
  wireless.subtitle = 'Office Wi-Fi'; wireless.emit('notify::subtitle');
  assert.equal(state.network.name, 'Office Wi-Fi');
  assert.equal(state.inputSource.displayName, 'Telex');
  assert.equal(state.inputSource.mode, 'Vietnamese');
  modeLabel.text = 'ASCII'; modeLabel.emit('notify::text');
  assert.equal(state.inputSource.shortName, 'Vi', 'the compact glyph may stay unchanged');
  assert.equal(state.inputSource.mode, 'ASCII');
  delete kim._propertySwitch.mode;
  kim.menu.box.emit('child-removed', modeLabel);
  assert.equal(modeLabel.signals.size, 0);
  assert.equal(state.inputSource.mode, '');
  kim.visible = false; kim.emit('notify::visible');
  assert.equal(state.inputSource.provider, 'keyboard');
  assert.equal(methodLabel.signals.size, 0);
  state.destroy();
  for (const actor of [wireless, kim, kim.labelIcon, kim.mainIcon, kim.menu.box, methodLabel, modeLabel])
    assert.equal(actor.signals.size, 0);
});

test('Desktop 3: native menu anchoring preserves BoxPointer ownership, restores on source destruction and failure', async () => {
  const env = await setupSystemDockEnvironment();
  const {SystemMenus} = await loadModule('dash2dock-lite@custom/systemDock/systemMenus.js', {mocks: env.sharedMocks});
  const menus = new SystemMenus();
  const native = env.nativeDateMenu.menu;
  const originalSource = new env.StMock.Button();
  const source = new env.StMock.Button({side: env.StMock.Side.LEFT});
  native.sourceActor = native.focusActor = originalSource;
  native._arrowAlignment = 0.25;
  const pointer = native._boxPointer;
  pointer._sourceActor = originalSource;
  pointer._arrowAlignment = 0.25;
  pointer._sourceAlignment = 0.3;
  pointer._userArrowSide = pointer._arrowSide = 0;
  pointer.setPosition = function(actor, alignment) { this._sourceActor = actor; this._arrowAlignment = alignment; };
  pointer.setSourceAlignment = function(value) { this._sourceAlignment = value; };
  pointer.updateArrowSide = function(side) { this._arrowSide = this._userArrowSide = side; };
  assert.equal(menus.available, true);
  assert.equal(menus.toggleDateMenu(source), true);
  assert.equal(pointer._sourceActor, source);
  assert.equal(pointer._userArrowSide, 3);
  assert.equal(native.focusActor, source);
  assert.equal(menus.isAnyMenuOpen, true);
  source.destroy();
  assert.equal(native.isOpen, false);
  assert.equal(native.sourceActor, originalSource);
  assert.equal(native.focusActor, originalSource);
  assert.equal(pointer._sourceActor, originalSource);
  assert.equal(pointer._arrowAlignment, 0.25);
  assert.equal(pointer._sourceAlignment, 0.3);
  assert.equal(pointer._userArrowSide, 0);
  assert.equal(native.signals.size, 0);
  const missing = env.MainMock.panel.statusArea.dateMenu;
  env.MainMock.panel.statusArea.dateMenu = null;
  assert.equal(menus.toggleDateMenu(new env.StMock.Button()), false, 'No fake calendar is created for unavailable native menu');
  env.MainMock.panel.statusArea.dateMenu = missing;
  menus.destroy();
});

test('Desktop 3: clock/state layout updates cannot re-show pods or rail over fullscreen windows', async () => {
  const env = await setupSystemDockEnvironment();
  env.MainMock.overview = {visible: false};
  env.primaryMonitor.inFullscreen = true;
  const {SystemState} = await loadModule('dash2dock-lite@custom/systemDock/systemState.js', {mocks: env.sharedMocks});
  const mocks = {...env.sharedMocks, '../attachedBackground.js': {AttachedDockCanvas: env.StMock.DrawingArea}};
  const {ClockPod} = await loadModule('dash2dock-lite@custom/systemDock/modularPods.js', {mocks});
  const {SystemDock} = await loadModule('dash2dock-lite@custom/systemDock/systemDock.js', {mocks});
  const state = new SystemState();
  const menu = {closeAll() {}, toggleDateMenu() {}};
  const extension = {};
  const clock = new ClockPod({extension, systemState: state, systemMenus: menu});
  clock.enable();
  const geometry = {x: 0, y: 850, width: 44, height: 180, contentTop: 18,
    contentHeight: 144, flareWidth: 14, footDepth: 4, cornerRadius: 10};
  clock.place(geometry);
  assert.equal(clock.visible, false);
  state._updateClock();
  clock.place(geometry);
  assert.equal(clock.visible, false, 'A minute update keeps fullscreen unobstructed');
  const rail = new SystemDock({extension, state, menus: menu});
  rail.enable();
  assert.equal(rail.visible, false);
  state._updateBattery();
  assert.equal(rail.visible, false, 'A hardware update keeps fullscreen unobstructed');
  env.MainMock.overview.visible = true;
  clock.place(geometry);
  rail.updateLayout();
  assert.equal(clock.visible, true, 'Overview permits chrome above the fullscreen window');
  assert.equal(rail.visible, true);
  clock.destroy(); rail.destroy(); state.destroy();
});

test('Desktop 3: native menu anchor remains stable until its dismissal animation finishes', async () => {
  const env = await setupSystemDockEnvironment();
  const {SystemMenus} = await loadModule('dash2dock-lite@custom/systemDock/systemMenus.js', {mocks: env.sharedMocks});
  const menus = new SystemMenus();
  const menu = env.nativeDateMenu.menu;
  const nativeSource = new env.StMock.Button();
  const podButton = new env.StMock.Button({side: 3});
  menu.sourceActor = nativeSource;
  menu._boxPointer.visible = true;
  menus.toggleDateMenu(podButton);
  menu.close();
  assert.equal(menu.sourceActor, podButton, 'Do not move a fading popup back to the native panel');
  assert.equal(menus.isAnyMenuOpen, true, 'Keep its source available until the fade completes');
  menu._boxPointer.visible = false;
  menu.emit('menu-closed');
  assert.equal(menu.sourceActor, nativeSource);
  assert.equal(menu.signals.size, 0);
  assert.equal(podButton.signals.size, 0);
  assert.equal(menus.isAnyMenuOpen, false);
  menus.destroy();
});
