import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'gnome-extension-tests-'));
try {
    const runGjs = (script) => {
        const result = spawnSync('gjs', ['-m', script], {
            stdio: 'inherit', timeout: 10000,
            env: {...process.env, XDG_CACHE_HOME: join(directory, 'cache'),
                XDG_DATA_HOME: join(directory, 'data'), GSETTINGS_BACKEND: 'memory'},
        });
        if (result.error) console.error(result.error.message);
        return result.status ?? 1;
    };
    const code1 = runGjs('tests/native-store.js');
    const code2 = runGjs('tests/native-gobject-check.js');
    process.exitCode = (code1 === 0 && code2 === 0) ? 0 : 1;
} finally {
    rmSync(directory, {recursive: true, force: true});
}
