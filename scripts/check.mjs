import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

let failures = 0;
let sources = 0;
let schemas = 0;
function walk(dir) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'schemas') {
                const result = spawnSync('glib-compile-schemas', ['--strict', '--dry-run', path], {encoding: 'utf8'});
                schemas++;
                if (result.status !== 0) {
                    console.error(path, result.error ?? result.stderr);
                    failures++;
                }
            }
            walk(path);
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
            const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
                input: readFileSync(path), encoding: 'utf8',
            });
            sources++;
            if (result.status !== 0) {
                console.error(path, result.stderr);
                failures++;
            }
        } else if (entry.name === 'metadata.json') {
            const metadata = JSON.parse(readFileSync(path, 'utf8'));
            if (!metadata['shell-version']?.includes('51')) {
                console.error(`${path}: GNOME 51 is not declared`);
                failures++;
            }
        }
    }
}
walk('.');
console.log(`${sources} JavaScript files, ${schemas} schema directories: ${failures} failures`);
process.exitCode = failures ? 1 : 0;
