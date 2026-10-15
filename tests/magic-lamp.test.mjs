import assert from 'node:assert/strict';
import test from 'node:test';
import {loadModule, Actor} from './helpers/shell.mjs';

test('minimize and restore complete without deformation during reduced motion or workspace gestures', async () => {
    const settings = {enable_animations: true, reducedMotion: 0};
    const windowManager = new Actor();
    let minimized = 0;
    let restored = 0;
    const Main = {overview: {visible: false}, wm: {
        _shouldAnimateActor() {}, _workspaceAnimation: {gestureActive: false},
        _shellwm: {completed_minimize: () => minimized++, completed_unminimize: () => restored++},
    }};
    const {default: Extension} = await loadModule(
        'compiz-alike-magic-lamp-effect@hermes83.github.com/extension.js', {
            globals: {global: {window_manager: windowManager, get_window_actors: () => []}},
            mocks: {
                'gi://GObject': {default: {registerClass() {}}},
                'gi://Clutter': {default: {DeformEffect: class {}}},
                'gi://St': {default: {Settings: {get: () => settings}, ReducedMotion: {REDUCE: 1}}},
                'gi://GLib': {default: {}},
                'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
                'resource:///org/gnome/shell/ui/main.js': Main,
                './settings_data.js': {SettingsData: class {}},
            },
        });
    const extension = new Extension();
    extension.getSettings = () => ({});
    extension.enable();
    let animated = 0;
    extension.animate = () => animated++;
    for (const reason of ['reducedMotion', 'animationsDisabled', 'gesture', 'overview']) {
        settings.reducedMotion = reason === 'reducedMotion' ? 1 : 0;
        settings.enable_animations = reason !== 'animationsDisabled';
        Main.wm._workspaceAnimation.gestureActive = reason === 'gesture';
        Main.overview.visible = reason === 'overview';
        windowManager.emit('minimize', new Actor());
        windowManager.emit('unminimize', new Actor());
    }
    assert.equal(animated, 0);
    assert.equal(minimized, 4);
    assert.equal(restored, 4);
    Main.overview.visible = false;
    windowManager.emit('minimize', new Actor());
    assert.equal(animated, 1);
    extension.disable();
});
