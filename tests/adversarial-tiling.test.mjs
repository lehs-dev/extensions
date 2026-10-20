import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

function geometry(rect) {
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

async function setupTwm(preferences = {}, workArea = {x: 0, y: 32, width: 1920, height: 1040}) {
    class Rectangle {
        constructor(params = {}) {
            Object.assign(this, {x: 0, y: 0, width: 0, height: 0}, params);
        }
        copy() { return new Rectangle(this); }
        equal(other) {
            return ['x', 'y', 'width', 'height'].every(key => this[key] === other[key]);
        }
        horiz_overlap(other) {
            return this.x < other.x + other.width && this.x + this.width > other.x;
        }
        vert_overlap(other) {
            return this.y < other.y + other.height && this.y + this.height > other.y;
        }
        overlap(other) {
            return this.horiz_overlap(other) && this.vert_overlap(other);
        }
        contains_rect(other) {
            return other.x >= this.x && other.x + other.width <= this.x + this.width &&
                other.y >= this.y && other.y + other.height <= this.y + this.height;
        }
        could_fit_rect(other) {
            return this.width >= other.width && this.height >= other.height;
        }
        area() {
            return this.width * this.height;
        }
        union(other) {
            const x = Math.min(this.x, other.x);
            const y = Math.min(this.y, other.y);
            const width = Math.max(this.x + this.width, other.x + other.width) - x;
            const height = Math.max(this.y + this.height, other.y + other.height) - y;
            return new Rectangle({x, y, width, height});
        }
        intersect(other) {
            const x = Math.max(this.x, other.x);
            const y = Math.max(this.y, other.y);
            const width = Math.min(this.x + this.width, other.x + other.width) - x;
            const height = Math.min(this.y + this.height, other.y + other.height) - y;
            return [width > 0 && height > 0, new Rectangle({x, y, width, height})];
        }
    }

    const settings = {
        'window-gap': 8,
        'single-screen-gap': 0,
        ...preferences,
    };
    const windows = [];
    const workspace = {};
    const nativeWorkArea = new Rectangle(workArea);
    const global = {
        display: {
            list_all_windows: () => windows,
            get_tab_list: () => windows,
            sort_windows_by_stacking: list => [...list],
            get_monitor_scale: () => 1,
            connectObject() {}, disconnectObject() {},
        },
        workspace_manager: {
            get_active_workspace: () => workspace,
            connectObject() {}, disconnectObject() {},
        },
    };
    const mocks = {
        '../dependencies/gi.js': {
            Gio: {_promisify() {}, File: class {}}, GLib: {}, Clutter: {}, St: {}, Shell: {},
            Mtk: {Rectangle},
            Meta: {
                MaximizeFlags: {HORIZONTAL: 1, VERTICAL: 2, BOTH: 3},
                WindowConstraint: {NONE: 0, WINDOW: 1, MONITOR: 2},
                TabList: {NORMAL_ALL: 0}, SizeChange: {MAXIMIZE: 0, UNMAXIMIZE: 1},
            },
        },
        '../dependencies/shell.js': {
            Config: {PACKAGE_VERSION: '51.0'},
            Main: {overview: {visible: false}, wm: {_prepareAnimationInfo() {}}},
        },
        '../dependencies/unexported/altTab.js': {getWindows: () => [...windows]},
        '../common.js': {
            Orientation: {}, Direction: {},
            Settings: {
                getBoolean: key => Boolean(settings[key]),
                getInt: key => settings[key] ?? 0,
                getString: key => settings[key] ?? '',
                getStrv: key => settings[key] ?? [],
            },
        },
    };
    const utility = await loadModule(
        'tiling-assistant@custom/src/extension/utility.js',
        {mocks, globals: {global}}
    );
    const {TilingWindowManager: twm} = await loadModule(
        'tiling-assistant@custom/src/extension/tilingWindowManager.js',
        {mocks: {...mocks, './utility.js': utility}, globals: {global}}
    );
    twm.initialize();

    function createWindow(initialFrame = {x: 100, y: 100, width: 500, height: 400}) {
        const window = new Actor();
        let frame = {...initialFrame};
        Object.assign(window, {
            constraints: [0, 0, 0, 0],
            get_id: () => windows.indexOf(window),
            get_monitor: () => 0,
            get_frame_rect: () => ({...frame}),
            get_work_area_for_monitor: () => nativeWorkArea,
            get_work_area_current_monitor: () => nativeWorkArea,
            get_compositor_private: () => null,
            is_skip_taskbar: () => false,
            is_above: () => false,
            allows_resize: () => true,
            allows_move: () => true,
            connectObject() {}, disconnectObject() {},
            unmake_fullscreen() {}, unmake_above() {}, unminimize() {},
            raise_and_make_recent_on_workspace() {}, move_to_monitor() {},
            override_constraints: (...edges) => { window.constraints = edges; },
            move_frame(userOp, x, y) { Object.assign(frame, {x, y}); },
            move_resize_frame(userOp, x, y, width, height) { frame = {x, y, width, height}; },
            unmaximize() {
                window.maximizedHorizontally = window.maximizedVertically = false;
            },
            maximize() {
                window.maximizedHorizontally = window.maximizedVertically = true;
            },
            set_maximize_flags(directions) {
                window.maximizedHorizontally ||= Boolean(directions & 1);
                window.maximizedVertically ||= Boolean(directions & 2);
            },
        });
        window.maximizedHorizontally = window.maximizedVertically = false;
        windows.push(window);
        return window;
    }

    return {twm, Rect: utility.Rect, createWindow, settings, nativeWorkArea};
}

test('ADVERSARIAL: Exhaustive resolution sweep from W=3 to W=10,000 confirms zero-pixel gap & zero-pixel overlap invariants', async () => {
    const {twm, Rect} = await setupTwm();

    const samplePositions = [
        {x: 0, y: 0},
        {x: 0, y: 32},
        {x: -1920, y: 0},
        {x: -3840, y: -1080},
        {x: -1366, y: -768},
        {x: 1920, y: 100},
    ];

    let verifiedCombinations = 0;

    for (let w = 3; w <= 10000; w++) {
        const pos = samplePositions[w % samplePositions.length];
        const h = 1000 + (w % 600);
        const area = new Rect({x: pos.x, y: pos.y, width: w, height: h});

        const leftThird = twm.getDefaultTileFor('tile-left-third', area);
        const rightThird = twm.getDefaultTileFor('tile-right-third', area);
        const centerThird = twm.getDefaultTileFor('tile-center-third', area);
        const leftTwoThirds = twm.getDefaultTileFor('tile-left-two-thirds', area);
        const rightTwoThirds = twm.getDefaultTileFor('tile-right-two-thirds', area);

        // 1. Integer geometry invariants
        for (const r of [leftThird, rightThird, centerThird, leftTwoThirds, rightTwoThirds]) {
            assert.ok(Number.isInteger(r.x), `r.x must be integer at w=${w}`);
            assert.ok(Number.isInteger(r.y), `r.y must be integer at w=${w}`);
            assert.ok(Number.isInteger(r.width), `r.width must be integer at w=${w}`);
            assert.ok(Number.isInteger(r.height), `r.height must be integer at w=${w}`);
            assert.ok(r.width > 0, `r.width must be positive at w=${w}`);
            assert.equal(r.height, h, `r.height must match work area height at w=${w}`);
            assert.equal(r.y, pos.y, `r.y must match work area y at w=${w}`);
        }

        // 2. Pairwise Invariant: Left 1/3 + Right 2/3 == WorkArea
        assert.equal(leftThird.x, area.x, `leftThird.x must anchor at workArea.x (w=${w})`);
        assert.equal(leftThird.x + leftThird.width, rightTwoThirds.x, `leftThird right must match rightTwoThirds left (w=${w})`);
        assert.equal(rightTwoThirds.x + rightTwoThirds.width, area.x + area.width, `rightTwoThirds must reach right border (w=${w})`);
        assert.equal(leftThird.width + rightTwoThirds.width, area.width, `widths must sum to workArea.width (w=${w})`);
        assert.equal(leftThird.overlap(rightTwoThirds), false, `leftThird and rightTwoThirds must have zero overlap (w=${w})`);

        // 3. Pairwise Invariant: Left 2/3 + Right 1/3 == WorkArea
        assert.equal(leftTwoThirds.x, area.x, `leftTwoThirds.x must anchor at workArea.x (w=${w})`);
        assert.equal(leftTwoThirds.x + leftTwoThirds.width, rightThird.x, `leftTwoThirds right must match rightThird left (w=${w})`);
        assert.equal(rightThird.x + rightThird.width, area.x + area.width, `rightThird must reach right border (w=${w})`);
        assert.equal(leftTwoThirds.width + rightThird.width, area.width, `widths must sum to workArea.width (w=${w})`);
        assert.equal(leftTwoThirds.overlap(rightThird), false, `leftTwoThirds and rightThird must have zero overlap (w=${w})`);

        // 4. Triplet Invariant: Left 1/3 + Center 1/3 + Right 1/3 == WorkArea
        assert.equal(leftThird.x, area.x, `leftThird.x must anchor at workArea.x (w=${w})`);
        assert.equal(leftThird.x + leftThird.width, centerThird.x, `leftThird right must match centerThird left (w=${w})`);
        assert.equal(centerThird.x + centerThird.width, rightThird.x, `centerThird right must match rightThird left (w=${w})`);
        assert.equal(rightThird.x + rightThird.width, area.x + area.width, `rightThird must reach right border (w=${w})`);
        assert.equal(leftThird.width + centerThird.width + rightThird.width, area.width, `thirds widths sum to area.width (w=${w})`);

        assert.equal(leftThird.overlap(centerThird), false, `left and center third zero overlap (w=${w})`);
        assert.equal(centerThird.overlap(rightThird), false, `center and right third zero overlap (w=${w})`);
        assert.equal(leftThird.overlap(rightThird), false, `left and right third zero overlap (w=${w})`);

        verifiedCombinations++;
    }

    assert.equal(verifiedCombinations, 9998);
    twm.destroy();
});

test('ADVERSARIAL: Extreme real-world ultrawide, odd, and negative-origin display profiles', async () => {
    const extremeProfiles = [
        // Ultra-wide displays
        {name: 'UW 3840x1600 (24:10)', x: 0, y: 32, width: 3840, height: 1568},
        {name: 'Super UW 5120x1440 (32:9)', x: 0, y: 32, width: 5120, height: 1408},
        {name: 'UW 3440x1440 (21:9)', x: 0, y: 32, width: 3440, height: 1408},
        {name: '5K2K 5120x2160 (21:9)', x: 0, y: 32, width: 5120, height: 2128},

        // Odd / Prime resolutions
        {name: 'Laptop 1366x768', x: 0, y: 32, width: 1366, height: 736},
        {name: 'Odd 1921x1080', x: 0, y: 32, width: 1921, height: 1048},
        {name: 'Odd 1025x768', x: 0, y: 32, width: 1025, height: 736},
        {name: 'Divisible odd 777x555', x: 0, y: 0, width: 777, height: 555},
        {name: 'Dual prime 997x701', x: 0, y: 0, width: 997, height: 701},
        {name: 'Dual prime 1999x1117', x: 0, y: 0, width: 1999, height: 1117},

        // Negative origin multi-monitor work areas
        {name: 'Negative secondary left (1080p)', x: -1920, y: -200, width: 1920, height: 1080},
        {name: 'Negative secondary left ultrawide', x: -3840, y: -1080, width: 3840, height: 1600},
        {name: 'Negative super ultrawide', x: -5120, y: 0, width: 5120, height: 1440},
        {name: 'Negative odd laptop', x: -1366, y: -768, width: 1366, height: 768},
        {name: 'Negative prime offset', x: -2560, y: -1440, width: 2560, height: 1440},
    ];

    for (const profile of extremeProfiles) {
        const {twm, Rect} = await setupTwm({}, profile);
        const area = new Rect(profile);

        const l3 = twm.getDefaultTileFor('tile-left-third', area);
        const c3 = twm.getDefaultTileFor('tile-center-third', area);
        const r3 = twm.getDefaultTileFor('tile-right-third', area);
        const l23 = twm.getDefaultTileFor('tile-left-two-thirds', area);
        const r23 = twm.getDefaultTileFor('tile-right-two-thirds', area);

        // Verification of spans
        assert.equal(l3.x, profile.x, `${profile.name}: l3 starts at profile.x`);
        assert.equal(l3.x + l3.width, r23.x, `${profile.name}: l3 meets r23`);
        assert.equal(r23.x + r23.width, profile.x + profile.width, `${profile.name}: r23 reaches right edge`);
        assert.equal(l3.width + r23.width, profile.width, `${profile.name}: l3 + r23 equals width`);

        assert.equal(l23.x, profile.x, `${profile.name}: l23 starts at profile.x`);
        assert.equal(l23.x + l23.width, r3.x, `${profile.name}: l23 meets r3`);
        assert.equal(r3.x + r3.width, profile.x + profile.width, `${profile.name}: r3 reaches right edge`);
        assert.equal(l23.width + r3.width, profile.width, `${profile.name}: l23 + r3 equals width`);

        assert.equal(l3.x, profile.x, `${profile.name}: l3 starts at profile.x`);
        assert.equal(l3.x + l3.width, c3.x, `${profile.name}: l3 meets c3`);
        assert.equal(c3.x + c3.width, r3.x, `${profile.name}: c3 meets r3`);
        assert.equal(r3.x + r3.width, profile.x + profile.width, `${profile.name}: r3 reaches right edge`);
        assert.equal(l3.width + c3.width + r3.width, profile.width, `${profile.name}: l3 + c3 + r3 equals width`);

        // Max difference between third widths is at most 1 pixel due to integer rounding
        const widths = [l3.width, c3.width, r3.width];
        const maxWidthDiff = Math.max(...widths) - Math.min(...widths);
        assert.ok(maxWidthDiff <= 1, `${profile.name}: thirds widths differ by at most 1px (actual: ${maxWidthDiff}px)`);

        twm.destroy();
    }
});

test('ADVERSARIAL: Gaps coordination (8px uniform) across ultrawide and negative-origin monitors', async () => {
    const testCases = [
        {name: 'Ultrawide 5120x1440 with 8px gaps', x: 0, y: 32, width: 5120, height: 1408},
        {name: 'Negative origin -1920x-200 with 8px gaps', x: -1920, y: -200, width: 1920, height: 1080},
        {name: 'Odd 1366x768 with 8px gaps', x: 0, y: 32, width: 1366, height: 736},
    ];

    for (const tc of testCases) {
        // Mode 1: Tiling Assistant native gaps (singleScreenGap: 8, windowGap: 8)
        {
            const {twm, Rect, createWindow} = await setupTwm({'window-gap': 8, 'single-screen-gap': 8}, tc);
            const area = new Rect(tc);

            const w1 = createWindow();
            const w2 = createWindow();
            const w3 = createWindow();

            const l3 = twm.getDefaultTileFor('tile-left-third', area);
            const c3 = twm.getDefaultTileFor('tile-center-third', area);
            const r3 = twm.getDefaultTileFor('tile-right-third', area);

            await twm.tile(w1, l3, {openTilingPopup: false});
            await twm.tile(w2, c3, {openTilingPopup: false});
            await twm.tile(w3, r3, {openTilingPopup: false});

            const f1 = w1.get_frame_rect();
            const f2 = w2.get_frame_rect();
            const f3 = w3.get_frame_rect();

            // Outer margin invariants (exactly 8px from workArea boundary)
            assert.equal(f1.x - area.x, 8, `${tc.name}: left outer margin must be 8px`);
            assert.equal(f1.y - area.y, 8, `${tc.name}: top outer margin must be 8px`);
            assert.equal((area.y + area.height) - (f1.y + f1.height), 8, `${tc.name}: bottom outer margin must be 8px`);
            assert.equal((area.x + area.width) - (f3.x + f3.width), 8, `${tc.name}: right outer margin must be 8px`);

            // Inner gap invariants (exactly 8px between adjacent windows)
            assert.equal(f2.x - (f1.x + f1.width), 8, `${tc.name}: gap between w1 and w2 must be exactly 8px`);
            assert.equal(f3.x - (f2.x + f2.width), 8, `${tc.name}: gap between w2 and w3 must be exactly 8px`);

            twm.destroy();
        }

        // Mode 2: Pairwise Left 1/3 + Right 2/3 with 8px gaps
        {
            const {twm, Rect, createWindow} = await setupTwm({'window-gap': 8, 'single-screen-gap': 8}, tc);
            const area = new Rect(tc);

            const w1 = createWindow();
            const w2 = createWindow();

            const l3 = twm.getDefaultTileFor('tile-left-third', area);
            const r23 = twm.getDefaultTileFor('tile-right-two-thirds', area);

            await twm.tile(w1, l3, {openTilingPopup: false});
            await twm.tile(w2, r23, {openTilingPopup: false});

            const f1 = w1.get_frame_rect();
            const f2 = w2.get_frame_rect();

            assert.equal(f1.x - area.x, 8, `${tc.name}: 1/3 + 2/3 left outer margin`);
            assert.equal(f2.x - (f1.x + f1.width), 8, `${tc.name}: 1/3 + 2/3 inner gap must be 8px`);
            assert.equal((area.x + area.width) - (f2.x + f2.width), 8, `${tc.name}: 1/3 + 2/3 right outer margin`);

            twm.destroy();
        }

        // Mode 3: Pairwise Left 2/3 + Right 1/3 with 8px gaps
        {
            const {twm, Rect, createWindow} = await setupTwm({'window-gap': 8, 'single-screen-gap': 8}, tc);
            const area = new Rect(tc);

            const w1 = createWindow();
            const w2 = createWindow();

            const l23 = twm.getDefaultTileFor('tile-left-two-thirds', area);
            const r3 = twm.getDefaultTileFor('tile-right-third', area);

            await twm.tile(w1, l23, {openTilingPopup: false});
            await twm.tile(w2, r3, {openTilingPopup: false});

            const f1 = w1.get_frame_rect();
            const f2 = w2.get_frame_rect();

            assert.equal(f1.x - area.x, 8, `${tc.name}: 2/3 + 1/3 left outer margin`);
            assert.equal(f2.x - (f1.x + f1.width), 8, `${tc.name}: 2/3 + 1/3 inner gap must be 8px`);
            assert.equal((area.x + area.width) - (f2.x + f2.width), 8, `${tc.name}: 2/3 + 1/3 right outer margin`);

            twm.destroy();
        }
    }
});

test('ADVERSARIAL: retiling preserves native vertical maximization and restores full maximization', async () => {
    const {twm, Rect, createWindow} = await setupTwm();
    const area = new Rect({x: 0, y: 32, width: 1920, height: 1040});

    const window = createWindow({x: 50, y: 50, width: 400, height: 300});
    assert.deepEqual(window.get_frame_rect(), {x: 50, y: 50, width: 400, height: 300});

    const shortcuts = [
        'tile-left-third',
        'tile-right-two-thirds',
        'tile-center-third',
        'tile-left-two-thirds',
        'tile-right-third',
    ];

    // Cycle through all new presets repeatedly and verify window state invariants.
    for (const shortcut of shortcuts) {
        const tileRect = twm.getDefaultTileFor(shortcut, area);
        await twm.tile(window, tileRect, {openTilingPopup: false});

        assert.equal(window.isTiled, true, `window.isTiled must remain true for ${shortcut}`);
        assert.equal(window.maximizedHorizontally, false, `window must NOT be horizontally maximized for ${shortcut}`);
        assert.equal(window.maximizedVertically, true, `window must be vertically maximized for ${shortcut}`);
        assert.deepEqual(window.constraints, [0, 0, 0, 0], `full-height presets use native maximization for ${shortcut}`);

        // The original floating untiledRect must be preserved throughout retiling
        assert.deepEqual(geometry(window.untiledRect), {x: 50, y: 50, width: 400, height: 300});
    }

    // Stress: Window was maximized first, then snapped to a third
    window.maximize();
    assert.equal(window.maximizedHorizontally, true);
    assert.equal(window.maximizedVertically, true);

    const leftThirdTile = twm.getDefaultTileFor('tile-left-third', area);
    await twm.tile(window, leftThirdTile, {openTilingPopup: false});

    assert.equal(window.isTiled, true, 'tiling a maximized window must set isTiled: true');
    assert.equal(window.maximizedHorizontally, false, 'tiling a maximized window must unmaximize horizontally');
    assert.equal(window.maximizedVertically, true, 'full-height tiles retain native vertical maximization');
    assert.deepEqual(window.constraints, [0, 0, 0, 0]);

    twm.destroy();
});

test('ADVERSARIAL: Adaptive tiling getTileFor under complex multi-window configurations', async () => {
    const {twm, Rect, createWindow} = await setupTwm();
    const area = new Rect({x: -1920, y: -200, width: 1920, height: 1080});

    // Window 1 tiled to Left 1/3
    const win1 = createWindow();
    const leftThird = twm.getDefaultTileFor('tile-left-third', area);
    await twm.tile(win1, leftThird, {openTilingPopup: false});

    // Window 2 asks for Right 2/3: getTileFor should seamlessly complement Window 1
    const rightTwoThirds = twm.getTileFor('tile-right-two-thirds', area, 0);
    assert.equal(rightTwoThirds.x, leftThird.x + leftThird.width);
    assert.equal(rightTwoThirds.x + rightTwoThirds.width, area.x + area.width);
    assert.equal(rightTwoThirds.width, area.width - leftThird.width);
    assert.equal(rightTwoThirds.overlap(leftThird), false);

    // Window 2 asks for Center 1/3: should place between Left 1/3 and Right 1/3
    const centerThird = twm.getTileFor('tile-center-third', area, 0);
    assert.equal(centerThird.x, leftThird.x + leftThird.width);
    assert.equal(centerThird.overlap(leftThird), false);

    // Overlap prevention: Window 2 asks for Left 1/3 while Window 1 already occupies it
    const contestedTile = twm.getTileFor('tile-left-third', area, 0);
    // Should fall back cleanly without throwing or creating corrupt rect
    assert.equal(contestedTile.width, leftThird.width);
    assert.equal(contestedTile.height, leftThird.height);

    twm.destroy();
});
