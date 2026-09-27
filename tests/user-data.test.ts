import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyVaultDirectory, userDataDirectory, vaultDirectory } from '../lib/server/user-data';
import { migrateLegacyVault } from '../lib/security/vault-migration';

test('A-08 keys and the graph live in the OS user data directory, never in the checkout', () => {
  assert.equal(userDataDirectory({}, 'linux', '/home/op'), '/home/op/.local/share/saintpetrus');
  assert.equal(userDataDirectory({ XDG_DATA_HOME: '/data/op' }, 'linux', '/home/op'), '/data/op/saintpetrus');
  assert.equal(userDataDirectory({ XDG_DATA_HOME: 'relative' }, 'linux', '/home/op'), '/home/op/.local/share/saintpetrus', 'a relative XDG path is ignored');
  assert.equal(userDataDirectory({}, 'darwin', '/Users/op'), '/Users/op/Library/Application Support/SaintPetrus');
  assert.match(userDataDirectory({ APPDATA: 'C:\\Users\\op\\AppData\\Roaming' }, 'win32', 'C:\\Users\\op'), /SaintPetrus$/);
  assert.equal(userDataDirectory({ SAINTPETRUS_DATA_DIR: '/srv/saintpetrus' }, 'linux', '/home/op'), '/srv/saintpetrus');
  assert.throws(() => userDataDirectory({ SAINTPETRUS_DATA_DIR: 'data' }, 'linux', '/home/op'), /absolute/);
  const previous = process.env.SAINTPETRUS_DATA_DIR; process.env.SAINTPETRUS_DATA_DIR = '/srv/saintpetrus';
  try { assert.equal(vaultDirectory(), '/srv/saintpetrus/vault'); } finally { if (previous === undefined) delete process.env.SAINTPETRUS_DATA_DIR; else process.env.SAINTPETRUS_DATA_DIR = previous; }
  assert.equal(legacyVaultDirectory('/checkout'), '/checkout/data/vault');
});

test('A-08 a legacy vault is copied, verified and only then deleted, with private permissions and no overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saintpetrus-vault-'));
  try {
    const legacy = join(root, 'checkout', 'data', 'vault'), target = join(root, 'home', 'vault');
    await mkdir(legacy, { recursive: true });
    // Synthetic ciphertext stand-ins, generated at runtime.
    const gemini = randomBytes(64), master = randomBytes(48);
    await writeFile(join(legacy, 'gemini.json'), gemini); await writeFile(join(legacy, 'master.dpapi'), master); await writeFile(join(legacy, 'notes.txt'), 'not a vault file');
    assert.deepEqual(await migrateLegacyVault(legacy, target), { moved: ['gemini.json', 'master.dpapi'], kept: [] });
    assert.deepEqual(await readFile(join(target, 'gemini.json')), gemini); assert.deepEqual(await readFile(join(target, 'master.dpapi')), master);
    if (process.platform !== 'win32') {
      assert.equal((await stat(target)).mode & 0o777, 0o700);
      for (const name of ['gemini.json', 'master.dpapi']) assert.equal((await stat(join(target, name))).mode & 0o777, 0o600, name);
    }
    assert.deepEqual(await readdir(legacy), ['notes.txt'], 'only vault files move; the directory stays while something else is in it');
    assert.deepEqual(await migrateLegacyVault(legacy, target), { moved: [], kept: [] }, 'running again changes nothing');
    // A name already present in the new place is never overwritten, and the old copy stays.
    const older = randomBytes(64);
    await writeFile(join(legacy, 'gemini.json'), older);
    assert.deepEqual(await migrateLegacyVault(legacy, target), { moved: [], kept: ['gemini.json'] });
    assert.deepEqual(await readFile(join(target, 'gemini.json')), gemini); assert.deepEqual(await readFile(join(legacy, 'gemini.json')), older);
    assert.deepEqual(await migrateLegacyVault(join(root, 'absent'), target), { moved: [], kept: [] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('A-08 the server moves the vault before it listens, and credentials use the new place', async () => {
  const server = await readFile('scripts/server.ts', 'utf8');
  assert.ok(server.indexOf('migrateLegacyVault(legacyVaultDirectory(), vaultDirectory())') > 0);
  assert.ok(server.indexOf('migrateLegacyVault(') < server.indexOf('server.listen('), 'before the first request');
  const runtime = await readFile('lib/security/runtime.ts', 'utf8');
  assert.match(runtime, /vaultDirectory\(\)/); assert.doesNotMatch(runtime, /'data'/);
});
