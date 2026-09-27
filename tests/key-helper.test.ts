import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { keyProviders, keyUsage, parseKeyArguments } from '../scripts/key-arguments.mjs';
import { providers } from '../lib/security/encrypted-vault';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';

test('The terminal key helper accepts DeepSeek under the same rules as every provider and never an argv secret', async () => {
  assert.deepEqual([...keyProviders].sort(), [...providers].sort(), 'the terminal and the backend credential store must accept the same providers');
  assert.deepEqual(parseKeyArguments(['set', 'deepseek']), { action: 'set', provider: 'deepseek', remember: false });
  assert.deepEqual(parseKeyArguments(['set', 'deepseek', '--remember']), { action: 'set', provider: 'deepseek', remember: true });
  for (const action of ['disconnect', 'forget', 'restore']) assert.deepEqual(parseKeyArguments([action, 'deepseek']), { action, provider: 'deepseek', remember: false });
  for (const argv of [['set', 'deepseek', 'sk-typed-by-mistake'], ['set', 'deepseek', '--remember', 'sk-typed-by-mistake'], ['restore', 'deepseek', '--remember'], ['set', 'DeepSeek'], ['set'], [], ['delete', 'deepseek']]) {
    assert.equal(parseKeyArguments(argv), undefined, JSON.stringify(argv));
  }
  assert.match(keyUsage, /\|deepseek\|/);
  const script = await readFile('scripts/key.mjs', 'utf8');
  assert.match(script, /parseKeyArguments\(process\.argv\.slice\(2\)\)/);
  assert.match(script, /body\.key = await readSecret\(\)/, 'the key is only ever read hidden from the terminal');
  assert.match(script, /'X-SaintPetrus-Client': 'terminal'/);
});

test('A terminal DeepSeek credential reaches memory only, through the local configuration route', async () => {
  const { POST: configure, GET: status } = await import('../app/api/credentials/route');
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/key-helper-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const previous = Reflect.get(globalThis, 'saintpetrusCredentials');
  const key = randomBytes(32).toString('hex');
  const url = 'http://127.0.0.1:3000/api/credentials';
  const terminal = (body: unknown) => new Request(url, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'terminal' }, body: JSON.stringify(body) });
  try {
    Reflect.set(globalThis, 'saintpetrusCredentials', store);
    const saved = await configure(terminal({ action: 'set', provider: 'deepseek', remember: false, key }));
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { provider: 'deepseek', connected: true, remembered: false });
    assert.equal((await readdir(dir)).length, 0, 'memory only unless --remember');
    assert.ok(!(await (await status(new Request(url))).text()).includes(key));
    assert.equal((await configure(terminal({ action: 'disconnect', provider: 'deepseek', remember: false }))).status, 200);
    assert.equal(store.status('deepseek').connected, false);
  } finally { store.disconnect('deepseek'); Reflect.set(globalThis, 'saintpetrusCredentials', previous); await rm(dir, { recursive: true }); }
});
