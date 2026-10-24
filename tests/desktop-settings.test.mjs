import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('Desktop settings use native GSettings types, persist, and update widgets without feedback', () => {
  const result = spawnSync('gjs', ['-m', 'tests/native-desktop-settings.js'], {
    encoding: 'utf8', timeout: 10000,
    env: {...process.env, GSETTINGS_BACKEND: 'memory'},
  });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Native Desktop 3 settings:.*passed/);
});
