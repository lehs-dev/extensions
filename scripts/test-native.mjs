import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'gnome-extension-tests-'));
try {
    const result = spawnSync('gjs', ['-m', 'tests/native-store.js'], {
        stdio: 'inherit', timeout: 10000,
        env: {...process.env, XDG_CACHE_HOME: join(directory, 'cache'),
            XDG_DATA_HOME: join(directory, 'data'), GSETTINGS_BACKEND: 'memory'},
    });
    if (result.error)
        console.error(result.error.message);
    process.exitCode = result.status ?? 1;
} finally {
    rmSync(directory, {recursive: true, force: true});
}
