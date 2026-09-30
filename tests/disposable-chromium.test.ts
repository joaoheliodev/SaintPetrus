import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeProfile } from '../scripts/disposable-chromium.mjs';

test('the browser checks remove their profile with retries, so a late Chromium write cannot fail a check that passed', async () => {
  const calls: unknown[] = [];
  await removeProfile('/tmp/saintpetrus-chromium-example', async (path, options) => { calls.push([path, options]); });
  // Node retries a removal that meets ENOTEMPTY, which is what a file written during the shutdown causes.
  assert.deepEqual(calls, [['/tmp/saintpetrus-chromium-example', { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }]]);
  // The profile as Chromium left it in the failed run: one temporary file in Default/.
  const profile = await mkdtemp(join(tmpdir(), 'saintpetrus-chromium-test-'));
  await mkdir(join(profile, 'Default')); await writeFile(join(profile, 'Default', '.org.chromium.Chromium.test'), 'late');
  await removeProfile(profile);
  await assert.rejects(readdir(profile), { code: 'ENOENT' });
});
