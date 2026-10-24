// Runs against Gio.Settings and the compiled extension schema without a Shell.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { SettingsKeys, schemaId } from '../dash2dock-lite@custom/preferences/keys.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = Gio.SettingsSchemaSource.new_from_directory(
  `${GLib.get_current_dir()}/dash2dock-lite@custom/schemas`,
  Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup(schemaId, false);
const settings = new Gio.Settings({settings_schema: schema});
const keys = SettingsKeys();
assert(keys.getKey('modular-quicksettings-width').value_type === 'i',
  'Integer value_type metadata was discarded');
keys.connectSettings(settings);

// Every integer scale goes through the same real schema-backed write path.
for (const [name, key] of Object.entries(keys.keys())) {
  if (key.widget_type !== 'scale') continue;
  const type = schema.get_key(name).get_value_type().dup_string();
  if (type !== 'i') continue;
  const base = settings.get_int(name);
  keys.setValue(name, base + 0.49);
  assert(settings.get_value(name).get_type_string() === 'i', `${name}: wrong type`);
  assert(settings.get_int(name) === base, `${name}: fractional slider did not round`);
}
keys.setValue('screen-frame-opacity', 0.75);
assert(settings.get_double('screen-frame-opacity') === 0.75, 'Double lost precision');
keys.setValue('modular-clock-format', 2);
assert(settings.get_int('modular-clock-format') === 2, 'Clock format did not persist');
keys.setValue('modular-show-battery', false);
assert(!settings.get_boolean('modular-show-battery'), 'Pod setting did not persist');
assert(settings.get_boolean('modular-group-elevation'), 'Group elevation default disabled');
assert(settings.get_int('modular-elevation-distance') === 8, 'Wrong elevation default');
assert(settings.get_int('modular-animation-duration') === 210, 'Wrong animation default');
keys.setValue('modular-group-elevation', false);
keys.setValue('modular-elevation-distance', 10);
keys.setValue('modular-animation-duration', 230);

// A second settings connection sees stored values, including untouched Dual Edge
// settings. Switching modes does not require rewriting those preferences.
settings.set_int('system-dock-width', 60);
settings.set_int('desktop-layout', 1);
settings.set_int('desktop-layout', 0);
const reopened = new Gio.Settings({settings_schema: schema});
assert(reopened.get_int('system-dock-width') === 60, 'Mode switch lost Dual Edge width');
assert(reopened.get_int('modular-clock-format') === 2, 'Reopen lost Clock Pod format');
assert(!reopened.get_boolean('modular-show-battery'), 'Reopen lost pod indicator state');
assert(!reopened.get_boolean('modular-group-elevation'), 'Reopen lost elevation preference');
assert(reopened.get_int('modular-elevation-distance') === 10, 'Reopen lost elevation distance');
assert(reopened.get_int('modular-animation-duration') === 230, 'Reopen lost animation duration');

// External changes update the preference widget once, without feedback writes.
const callbacks = new Map();
let displayed;
const widget = {
  set_value(value) {
    displayed = value;
    callbacks.get('value-changed')?.(this);
  },
  get_value() { return displayed; },
  connect(signal, callback) { callbacks.set(signal, callback); return signal; },
  disconnect(signal) { callbacks.delete(signal); },
};
keys.connectBuilder({get_object(name) { return name === 'modular-quicksettings-width' ? widget : null; }});
keys.connectSettings(settings);
settings.set_int('modular-quicksettings-width', 52);
assert(displayed === 52, 'Live external setting did not update widget');
widget.set_value(54.4);
assert(settings.get_int('modular-quicksettings-width') === 54, 'Widget did not write rounded integer');
keys.disconnectBuilder();
keys.disconnectSettings();
assert(callbacks.size === 0, 'Widget signal leaked after close');
print('Native Desktop 3 settings: types, persistence, live updates and cleanup passed');
