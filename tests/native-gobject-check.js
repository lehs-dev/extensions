import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {computeDockViewport} from '../dash2dock-lite@custom/dockOverflow.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

// 1. Regression test: in GJS, assigning a string to a boxed GObject property
// throws the exact "Wrong type string; boxed type <BoxedType> expected" error.
let caughtBoxedError = false;
try {
    new Gio.SimpleAction({name: 'test', parameter_type: 'left'});
} catch (e) {
    caughtBoxedError = true;
    assert(e.message.includes('Wrong type string') && e.message.includes('boxed type'),
        `Unexpected error message: ${e.message}`);
}
assert(caughtBoxedError, 'Assigning a string to a boxed GObject property must throw in GJS');

// 2. Passing a non-existent property to a GObject constructor throws in GJS
let caughtUnknownProp = false;
try {
    new Gio.SimpleAction({name: 'test', actor: 'invalid'});
} catch (e) {
    caughtUnknownProp = true;
    assert(e.message.includes('No property actor'), `Unexpected error message: ${e.message}`);
}
assert(caughtUnknownProp, 'Passing non-existent property to GObject constructor must throw in GJS');

// 3. Pod properties (dockPosition, edge) on a GObject subclass do not collide with GObject properties
const PodGObjectClass = GObject.registerClass({
    GTypeName: 'PodGObjectClass',
}, class PodGObjectClass extends GObject.Object {
    _init() {
        super._init();
        this._dockPosition = 'left';
        this._edge = 'left';
    }
    get dockPosition() { return this._dockPosition ?? 'left'; }
    set dockPosition(val) { this._dockPosition = val; }
    get edge() { return this._edge ?? 'left'; }
    set edge(val) { this._edge = val; }
});

const podInstance = new PodGObjectClass();
assert(podInstance.dockPosition === 'left', 'dockPosition getter must return "left"');
assert(podInstance.edge === 'left', 'edge getter must return "left"');
podInstance.dockPosition = 'custom';
assert(podInstance.dockPosition === 'custom', 'dockPosition setter must work');

// 4. Regression test: computeDockViewport with NaN and uninitialized inputs
const viewportNaN = computeDockViewport({
    availableHeight: NaN,
    contentHeight: undefined,
    iconSize: NaN,
    flareWidth: undefined,
    magnify: undefined,
});
assert(Number.isFinite(viewportNaN.height) && !Number.isNaN(viewportNaN.height),
    'computeDockViewport must return finite height even with NaN inputs');
assert(Number.isFinite(viewportNaN.contentTop) && !Number.isNaN(viewportNaN.contentTop),
    'computeDockViewport must return finite contentTop even with NaN inputs');
assert(Number.isFinite(viewportNaN.bodyHeight) && !Number.isNaN(viewportNaN.bodyHeight),
    'computeDockViewport must return finite bodyHeight even with NaN inputs');

const viewportValid = computeDockViewport({
    availableHeight: 600,
    contentHeight: 250,
    iconSize: 48,
    flareWidth: 14,
    magnify: 0.5,
});
assert(viewportValid.height > 0 && !viewportValid.overflow, 'Normal viewport calculation');

// 5. GNOME Shell 51 StBoxLayout compatibility: rejects 'vertical' property
const MockStBoxLayout = GObject.registerClass({
    GTypeName: 'MockStBoxLayout',
    Properties: {
        orientation: GObject.ParamSpec.int(
            'orientation', 'orientation', 'ClutterOrientation',
            GObject.ParamFlags.READWRITE,
            0, 1, 0
        ),
    },
}, class MockStBoxLayout extends GObject.Object {});

let caughtVerticalError = false;
try {
    new MockStBoxLayout({vertical: true});
} catch (e) {
    caughtVerticalError = true;
    assert(e.message.includes('No property vertical'), `Expected "No property vertical", got: ${e.message}`);
}
assert(caughtVerticalError, 'GNOME Shell 51 StBoxLayout must reject legacy "vertical" property');

const validBox = new MockStBoxLayout({orientation: 1});
assert(validBox.orientation === 1, 'orientation: Clutter.Orientation.VERTICAL is valid in GNOME Shell 51');

console.log('PASS: native GJS GObject property validation and NaN robustness');
