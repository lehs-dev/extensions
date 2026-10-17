import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule} from './helpers/shell.mjs';

const {computeOverviewLayout} = await loadModule(
    'static-workspace-background@CleoMenezesJr.github.io/overviewLayout.js');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7,
    `expected ${actual} to be close to ${expected}`);
const right = rect => rect.x + rect.width;
const bottom = rect => rect.y + rect.height;

function assertContained(inner, outer) {
    assert.ok(inner.x >= outer.x - 1e-7, 'left edge is contained');
    assert.ok(inner.y >= outer.y - 1e-7, 'top edge is contained');
    assert.ok(right(inner) <= right(outer) + 1e-7, 'right edge is contained');
    assert.ok(bottom(inner) <= bottom(outer) + 1e-7, 'bottom edge is contained');
}

function assertLayout(area, layout) {
    for (const [name, rect] of Object.entries(layout)) {
        for (const value of Object.values(rect))
            assert.ok(Number.isFinite(value), `${name} has finite coordinates`);
        assert.ok(rect.width > 0, `${name} has positive width`);
        assert.ok(rect.height > 0, `${name} has positive height`);
    }
    assertContained(layout.card, area);
    assertContained(layout.workspaceStrip, area);
    assertContained(layout.workspaces, layout.workspaceStrip);
    assertContained(layout.workspaces, area);
    assertContained(layout.picker, area);
    assertContained(layout.apps, layout.card);
    assert.ok(bottom(layout.workspaceStrip) < layout.picker.y,
        'the workspace strip stays above the window previews');
    near(layout.workspaceStrip.x - area.x, right(area) - right(layout.workspaceStrip));
    near(layout.workspaces.x - area.x, right(area) - right(layout.workspaces));
    near(layout.picker.x - area.x, right(area) - right(layout.picker));
    near(layout.apps.y - layout.card.y, bottom(layout.card) - bottom(layout.apps));
    near(layout.card.x - area.x, right(area) - right(layout.card));
}

test('1920x1200 separates picker thumbnails from an app-only card above the Dock', () => {
    const area = {x: 0, y: 32, width: 1920, height: 1168};
    const layout = computeOverviewLayout(area);
    assertLayout(area, layout);
    assert.equal(layout.card.width, 1400);
    assert.equal(layout.card.height, 960);
    assert.equal(layout.workspaces.height, 136);
    assert.equal(layout.workspaceStrip.width, 960);
    assert.equal(layout.workspaceStrip.x, 480);
    assert.equal(layout.workspaces.y - area.y, 8);
    near(layout.card.y - area.y, bottom(area) - 72 - bottom(layout.card));
    assert.ok(bottom(layout.card) <= bottom(area) - 72 - 24);
    assert.equal(layout.apps.height, 904,
        'the app grid uses all padded card space after removing the strip');
    assert.ok(layout.workspaces.y < layout.card.y,
        'picker thumbnails start at the top of Overview independently of the card');
    assert.ok(bottom(layout.picker) <= bottom(area) - 72 - 24);
});

test('the half-width workspace strip expands equally at both edges and stops at the work area', () => {
    const area = {x: -1600, y: 32, width: 1600, height: 1168};
    const compact = computeOverviewLayout(area);
    let previous = compact;
    for (const workspaceNaturalWidth of [200, 900, 1200, 1600, 4000]) {
        const layout = computeOverviewLayout(area, {workspaceNaturalWidth});
        assertLayout(area, layout);
        near(layout.workspaceStrip.width, Math.min(1600, Math.max(800, workspaceNaturalWidth + 48)));
        near(previous.workspaceStrip.x - layout.workspaceStrip.x,
            right(layout.workspaceStrip) - right(previous.workspaceStrip));
        assert.deepEqual(layout.picker, compact.picker,
            'strip growth does not move or resize the window previews');
        assert.equal(layout.workspaces.height, compact.workspaces.height,
            'the preferred thumbnail height is unchanged');
        previous = layout;
    }
});

test('1366x768 preserves margins and usable grid space with a taller Dock', () => {
    const area = {x: 0, y: 32, width: 1366, height: 736};
    const layout = computeOverviewLayout(area, {dashHeight: 96});
    assertLayout(area, layout);
    assert.ok(layout.card.x >= area.x + 24);
    assert.ok(right(layout.card) <= right(area) - 24);
    assert.ok(layout.card.y >= area.y + 24);
    assert.ok(bottom(layout.card) <= bottom(area) - 96 - 24);
    near(layout.card.y - area.y, bottom(area) - 96 - bottom(layout.card));
    assert.ok(layout.apps.height > 350);
});

test('negative monitor origins translate every section without changing its size', () => {
    const area = {x: 0, y: 32, width: 1600, height: 868};
    const movedArea = {...area, x: -1600, y: -168};
    const original = computeOverviewLayout(area);
    const moved = computeOverviewLayout(movedArea);
    assertLayout(movedArea, moved);
    for (const name of Object.keys(original)) {
        near(moved[name].x, original[name].x - 1600);
        near(moved[name].y, original[name].y - 200);
        near(moved[name].width, original[name].width);
        near(moved[name].height, original[name].height);
    }
});

test('fractional and HiDPI scales retain the same logical layout without rounding', () => {
    const baseArea = {x: 0, y: 32, width: 1920, height: 1168};
    const base = computeOverviewLayout(baseArea, {dashHeight: 83.5});
    for (const scale of [1.25, 2]) {
        const area = Object.fromEntries(Object.entries(baseArea)
            .map(([key, value]) => [key, value * scale]));
        const layout = computeOverviewLayout(area, {scale, dashHeight: 83.5 * scale});
        assertLayout(area, layout);
        for (const name of Object.keys(base)) {
            for (const key of ['x', 'y', 'width', 'height'])
                near(layout[name][key], base[name][key] * scale);
        }
    }
});

test('tiny allocations compress spacing and reserve without overlap or overflow', () => {
    for (const width of [0.5, 1, 16, 80, 180]) {
        for (const height of [0.5, 1, 24, 120, 240]) {
            const area = {x: -19.25, y: 7.75, width, height};
            for (const scale of [1, 1.25, 2])
                assertLayout(area, computeOverviewLayout(area, {scale, dashHeight: 100000}));
        }
    }
});

test('transient empty allocations and invalid optional values remain finite', () => {
    const area = {x: -200, y: 32, width: 0, height: 0};
    const layout = computeOverviewLayout(area, {scale: NaN, dashHeight: Infinity});
    for (const rect of Object.values(layout)) {
        assert.equal(rect.width, 0);
        assert.equal(rect.height, 0);
        assert.equal(rect.x, area.x);
        assert.equal(rect.y, area.y);
    }
});
