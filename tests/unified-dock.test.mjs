import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule} from './helpers/shell.mjs';

const {unifiedAppearance} = await loadModule('dash2dock-lite@custom/unifiedDock.js');
const {computeUnifiedDockGeometry} = await loadModule('dash2dock-lite@custom/systemDock/systemDockLayout.js');
const {getAttachedPodPickBoxes, getAttachedEdgeGeometry} = await loadModule('dash2dock-lite@custom/attachedGeometry.js');

test('all four edges scale once and keep Quick Settings and Clock flush to opposite screen corners', () => {
    for (const scale of [0.5, 1, 1.25, 1.5, 2]) {
        const a = unifiedAppearance({global_scale: scale, border_thickness: 2});
        for (const monitorScale of [1, 1.25, 1.5, 2]) {
            for (const edge of ['top', 'bottom', 'left', 'right']) {
                const vertical = edge === 'left' || edge === 'right';
                const axis = vertical ? 'y' : 'x', length = vertical ? 'height' : 'width';
                const normal = vertical ? 'x' : 'y', depth = vertical ? 'width' : 'height';
                const monitor = {index: 1, x: -2560, y: -180, width: 2560, height: 1800, geometry_scale: monitorScale};
                const g = computeUnifiedDockGeometry({monitor, ...a, edge,
                    quickSettingsContentHeight: 80 * scale, quickSettingsContentWidth: 80 * scale,
                    inputMethodContentHeight: 20 * scale, inputMethodContentWidth: 20 * scale,
                    clockContentHeight: 70 * scale, clockContentWidth: 70 * scale, appDockContentHeight: 210 * scale,
                    showInputMethod: true, magnify: 0.5});
                assert.equal(g.fits, true);
                for (const item of [g.quickSettings, g.inputMethod, g.appDock, g.clock]) {
                    assert.equal(item[depth], a.width);
                    assert.equal(item[normal], edge === 'right' || edge === 'bottom' ? monitor[normal] + monitor[depth] - a.width : monitor[normal]);
                    assert.ok(item[axis] >= monitor[axis]);
                    assert.ok(item[axis] + item[length] <= monitor[axis] + monitor[length]);
                }
                assert.equal(g.quickSettings[axis], monitor[axis]);
                assert.equal(g.clock[axis] + g.clock[length], monitor[axis] + monitor[length]);
                assert.equal(g.quickSettings.startFlush, true);
                assert.equal(g.clock.endFlush, true);
                assert.equal(g.inputMethod[axis] - g.quickSettings[axis] - g.quickSettings[length], 3 * scale);
                assert.ok(g.appDock[axis] >= g.inputMethod[axis] + g.inputMethod[length] + a.spacing);
                assert.ok(g.appDock[axis] + g.appDock[length] + a.spacing <= g.clock[axis]);
                assert.equal(g.quickSettings.flareWidth, 14 * scale);
                assert.equal(g.quickSettings.footDepth, 4 * scale);
                assert.equal(g.quickSettings.cornerRadius, 10 * scale);
                assert.equal(a.fontSize, 11 * scale);
                assert.equal(a.detailFontSize, 12 * scale);
                assert.equal(a.padding, 3 * scale);
                assert.equal(a.borderThickness, 2 * scale);
            }
        }
    }
});

test('all edges bound large app collections and reclaim unavailable input-method space', () => {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
        const monitor = {x: 0, y: 0, width: 1366, height: 768};
        const g = computeUnifiedDockGeometry({monitor, edge, ...unifiedAppearance(),
            showInputMethod: false, appDockContentHeight: 5000, magnify: 1});
        const vertical = edge === 'left' || edge === 'right';
        const axis = vertical ? 'y' : 'x', length = vertical ? 'height' : 'width';
        assert.equal(g.fits, true);
        assert.equal(g.inputMethod.visible, false);
        assert.ok(g.appDock[axis] - g.quickSettings[axis] - g.quickSettings[length] >= 16);
        assert.ok(g.clock[axis] - g.appDock[axis] - g.appDock[length] >= 16);
        assert.ok(g.appDock[length] < 5000);
    }
});

test('right contour and input region mirror the left at every hover offset', () => {
    for (const scale of [0.5, 1, 1.25, 1.5, 2]) {
        const a = unifiedAppearance({global_scale: scale});
        for (const progress of [0, 0.2, 0.5, 1]) {
            const params = {...a, height: 180 * scale, width: a.width + 140 * scale * progress,
                bodyOffset: 8 * scale * progress};
            const left = getAttachedEdgeGeometry({...params, position: 'left'});
            const right = getAttachedEdgeGeometry({...params, position: 'right'});
            for (const key of ['leftFootTip', 'rightFootTip', 'topLeft', 'topRight', 'leftBodyBottom', 'rightBodyBottom']) {
                assert.ok(Math.abs(left[key].x + right[key].x - left.width) < 1e-9);
                assert.equal(left[key].y, right[key].y);
            }
            const boxes = getAttachedPodPickBoxes({...params, position: 'left'});
            const mirrored = getAttachedPodPickBoxes({...params, position: 'right'});
            assert.equal(boxes.length, mirrored.length);
            boxes.forEach((b, i) => {
                assert.equal(mirrored[i].x1, left.width - b.x2);
                assert.equal(mirrored[i].x2, left.width - b.x1);
                assert.ok(mirrored[i].x1 >= 0 && mirrored[i].x2 <= right.width);
            });
        }
    }
});


test('horizontal pick regions transpose the contour and keep flush corner caps clickable', () => {
    for (const edge of ['top', 'bottom']) for (const startFlush of [false, true]) for (const endFlush of [false, true]) {
        const params = {width: 180, height: 34, flareWidth: 14, footDepth: 4, cornerRadius: 10, bodyOffset: 8, startFlush, endFlush};
        const canonical = getAttachedPodPickBoxes({...params, width: 34, height: 180, position: 'left'});
        const boxes = getAttachedPodPickBoxes({...params, position: edge});
        assert.equal(boxes.length, canonical.length);
        boxes.forEach((box, i) => {
            assert.equal(box.x1, canonical[i].y1);
            assert.equal(box.x2, canonical[i].y2);
            assert.equal(box.y1, edge === 'top' ? canonical[i].x1 : 42 - canonical[i].x2);
            assert.equal(box.y2, edge === 'top' ? canonical[i].x2 : 42 - canonical[i].x1);
        });
    }
});
