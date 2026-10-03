import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const folders = readdirSync(root, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name.includes('@'))
    .map(entry => join(root, entry.name));
function walk(folder) {
    return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
        const path = join(folder, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

let failures = 0;
let sources = 0;
for (const folder of folders) {
    const metadata = JSON.parse(readFileSync(join(folder, 'metadata.json'), 'utf8'));
    if (metadata.uuid !== relative(root, folder) || !metadata['shell-version'].includes('50')) {
        console.error(`Invalid GNOME 50 metadata: ${relative(root, folder)}`);
        failures++;
    }
    for (const path of walk(folder).filter(path => path.endsWith('.js'))) {
        const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
            input: readFileSync(path, 'utf8'), encoding: 'utf8',
        });
        sources++;
        if (result.status !== 0) {
            console.error(`${relative(root, path)}: ${result.stderr}`);
            failures++;
        }
    }

    // Preferences run in a separate process. Follow only extension.js imports
    // to catch GTK libraries accidentally loaded inside the compositor.
    const visited = new Set();
    function follow(path) {
        if (visited.has(path))
            return;
        visited.add(path);
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/^import\s+(?:[^'";]*?from\s+)?['"]([^'"]+)['"];?[\t ]*$/gm)) {
            const specifier = match[1];
            if (/^gi:\/\/(Gtk|Gdk|Adw)(?:\?|$)/.test(specifier)) {
                console.error(`Shell imports forbidden GUI library ${specifier}: ${relative(root, path)}`);
                failures++;
            }
            if (specifier.startsWith('.'))
                follow(join(dirname(path), specifier));
        }
    }
    follow(join(folder, 'extension.js'));
}
console.log(`Checked ${sources} JavaScript files and ${folders.length} extension import graphs.`);

const tests = readdirSync(new URL('.', import.meta.url))
    .filter(name => name.endsWith('.test.mjs')).map(name => join(root, 'tests', name));
const result = spawnSync(process.execPath, ['--test', ...tests], {cwd: root, stdio: 'inherit'});
process.exitCode = failures || result.status !== 0 ? 1 : 0;
