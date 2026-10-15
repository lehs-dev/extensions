import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Store from '../clipboard-history@alexsaveau.dev/store.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const uuid = 'clipboard-native-test';
const cache = GLib.get_user_cache_dir();
const legacyPath = GLib.build_filenamev([cache, 'clipboard-indicator@tudmotu.com']);
GLib.mkdir_with_parents(legacyPath, 0o700);
const legacy = Gio.File.new_for_path(`${legacyPath}/registry.txt`);
legacy.replace_contents(JSON.stringify(['Xin chào 👋', {contents: '保存したテキスト', favorite: true}]),
    null, false, Gio.FileCreateFlags.PRIVATE, null);

Store.init(uuid);
const read = () => new Promise(resolve => Store.buildClipboardStateFromLog(
    (entries, favorites, nextId) => resolve({entries: entries.toArray(), favorites: favorites.toArray(), nextId})));
const state = await read();
assert(state.entries.length === 1 && state.entries[0].text === 'Xin chào 👋',
    'Legacy UTF-8 clipboard history was lost during migration');
assert(state.favorites.length === 1 && state.favorites[0].text === '保存したテキスト',
    'Legacy favorites were lost during migration');
assert(state.nextId === 3, 'Migrated IDs must remain unique');

const database = Gio.File.new_for_path(`${cache}/${uuid}/database.log`);
const deadline = GLib.get_monotonic_time() + 5_000_000;
while (!database.query_exists(null) || legacy.query_exists(null)) {
    assert(GLib.get_monotonic_time() < deadline, 'Migration did not finish');
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}
const persisted = await read();
assert(persisted.entries[0]?.text === 'Xin chào 👋' &&
    persisted.favorites[0]?.text === '保存したテキスト', 'Migrated log did not round-trip');

// Simulate power loss halfway through an operation ID. Previously committed
// entries must remain available when the trailing incomplete record is read.
const output = Gio.DataOutputStream.new(database.append_to(Gio.FileCreateFlags.NONE, null));
output.put_byte(2, null);
output.put_byte(1, null);
output.close(null);
const recovered = await read();
assert(recovered.entries.length === 1 && recovered.favorites.length === 1,
    'A truncated trailing operation discarded committed clipboard history');
Store.destroy();
print('PASS: native GJS/Gio UTF-8 migration, persistence and truncated-log recovery');
