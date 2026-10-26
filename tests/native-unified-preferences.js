// Optional native GTK smoke test; run with GSETTINGS_BACKEND=memory on a GTK display.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {SettingsKeys, schemaId} from '../dash2dock-lite@custom/preferences/keys.js';
import {migrateUnifiedSettings} from '../dash2dock-lite@custom/unifiedDock.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
assert(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'Run this test with GSETTINGS_BACKEND=memory');
Adw.init();
const builder = new Gtk.Builder();
builder.add_from_file('dash2dock-lite@custom/ui/unified.ui');
const window = new Adw.PreferencesWindow();
for (const id of ['layout', 'appearance', 'behavior']) window.add(builder.get_object(id));
for (const key of ['desktop-layout', 'unified-position', 'dock-location', 'background-style', 'system-dock-width',
    'icon-size', 'modular-indicator-icon-size', 'modular-quicksettings-width'])
    assert(builder.get_object(key) === null, `Obsolete ${key} control is still exposed`);
const edgeModel = builder.get_object('unified-edge').get_model();
assert(['Top', 'Bottom', 'Left', 'Right'].every((label, index) => edgeModel.get_string(index) === label),
    'Position must select screen edges');
for (const id of ['systemControls', 'desktopFrame', 'appAppearance', 'appBehavior']) {
    const dialog = new Adw.PreferencesDialog();
    const page = builder.get_object(id);
    dialog.add(page);
    dialog.remove(page);
    dialog.add(page);
    dialog.remove(page);
}
const source = Gio.SettingsSchemaSource.new_from_directory(
    `${GLib.get_current_dir()}/dash2dock-lite@custom/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup(schemaId, false)});
migrateUnifiedSettings(settings);
const keys = SettingsKeys({_toRGBA: rgba => new Gdk.RGBA(rgba)});
keys.connectBuilder(builder);
keys.connectSettings(settings);
let scaleWrites = 0;
const signal = settings.connect('changed::global-scale', () => scaleWrites++);
builder.get_object('global-scale').set_value(1.25);
assert(settings.get_double('global-scale') === 1.25, 'Global scale did not write through GTK');
assert(scaleWrites === 1, 'Scale change wrote more than once');
settings.set_double('global-scale', 1.5);
assert(builder.get_object('global-scale').get_value() === 1.5, 'External scale change did not update GTK');
assert(scaleWrites === 2, 'External change caused a feedback write');
builder.get_object('background-opacity').set_value(0.43);
assert(Math.abs(settings.get_double('background-opacity') - 0.43) < 1e-9, 'Opacity lost precision');
builder.get_object('unified-edge').set_selected(3);
assert(settings.get_int('unified-edge') === 3, 'Edge selection did not persist');
keys.disconnectBuilder();
keys.disconnectSettings();
settings.disconnect(signal);
builder.get_object('global-scale').set_value(2);
assert(settings.get_double('global-scale') === 1.5, 'Builder signal leaked after close');
window.destroy();
print('PASS: Unified Dock native GTK preferences, subpages, settings and signal cleanup');
