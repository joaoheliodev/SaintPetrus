import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { Credentials } from '../lib/security/credentials';
import { OSKeyring, KeyringMissing } from '../lib/security/os-keyring';
import { redact, registerSecret, safeJson, safeLog, safeStringify } from '../lib/security/redact';
import { GET as exportGraph } from '../app/api/graph/export/route';
import { GET as graphGet } from '../app/api/graph/route';
import { GET as status, POST as configure } from '../app/api/credentials/route';
import { runtime } from '../lib/server/runtime';
async function fixture() {
  await mkdir('.audit', { recursive: true });
  const dir = await mkdtemp('.audit/vault-'); const master = randomBytes(32);
  const vault = new EncryptedVault(dir, { loadOrCreate: async () => Buffer.from(master) });
  return { dir, vault, master, store: new Credentials(vault), cleanup: async () => { master.fill(0); await rm(dir, { recursive: true }); } };
}

test('RS-04 redacts logs, stacks, errors, nested fields, active secrets and summaries', async () => {
  const known = randomBytes(24); const unregister = registerSecret(known);
  const candidates = ['sk-' + randomBytes(24).toString('hex'), 'AIza' + randomBytes(25).toString('hex'), 'Bearer ' + randomBytes(24).toString('hex'), known.toString()];
  try {
    const payload = { summary: candidates.join(' '), api_key: 'sk-REPLACE_ME', nested: [new Error(candidates.join(' '))] };
    let logged = ''; safeLog(payload, text => { logged = text; });
    const serialized = safeStringify(payload), response = await safeJson(payload).text();
    for (const candidate of candidates) { assert.ok(!logged.includes(candidate)); assert.ok(!serialized.includes(candidate)); assert.ok(!response.includes(candidate)); }
    assert.ok(serialized.includes('[REDACTED]'));
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic; assert.ok(safeStringify(cyclic).includes('[Circular]'));
    assert.equal(typeof redact(payload), 'object');
  } finally { unregister(); known.fill(0); }
});

test('RS-04 graph response and context export redact before serialization', async () => {
  const candidate = 'sk-' + randomBytes(24).toString('hex'); runtime().mock.reset();
  runtime().graph.add({ name: 'Security export test', provider: 'Unconfigured', context: { objective: candidate, summary: candidate, artifacts: [candidate] } });
  for (const handler of [exportGraph, graphGet]) {
    const response = await handler(new Request('http://127.0.0.1:3000/api/graph'));
    const text = await response.text(); assert.ok(!text.includes(candidate)); assert.ok(text.includes('[REDACTED]'));
  }
  runtime().mock.reset();
});

test('RS-02 default is memory only; disconnect wipes registered storage', async () => {
  const f = await fixture(); const key = Buffer.from(randomBytes(32).toString('hex')); let active: Buffer | undefined;
  try {
    await f.store.configure('openai', key);
    assert.equal((await readdir(f.dir)).length, 0);
    assert.deepEqual(f.store.status('openai'), { provider: 'openai', connected: true, remembered: false });
    await f.store.use('openai', async buffer => { active = buffer; assert.ok(buffer.equals(key)); });
    assert.ok(active?.every(byte => byte === 0));
    f.store.disconnect('openai'); assert.equal(f.store.status('openai').connected, false);
    await assert.rejects(f.store.use('openai', async () => 'unexpected'), /not connected/);
  } finally { key.fill(0); f.store.disconnect('openai'); await f.cleanup(); }
});

test('RS-03 encrypted opt-in roundtrip, authenticated tamper rejection and forget', async () => {
  const f = await fixture(); const key = Buffer.from(randomBytes(32).toString('hex'));
  try {
    await f.store.configure('anthropic', key, true);
    const file = join(f.dir, 'anthropic.json'), disk = await readFile(file, 'utf8');
    assert.ok(!disk.includes(key.toString('base64'))); assert.ok(!disk.includes(key.toString('hex')));
    const restored = await f.vault.load('anthropic'); assert.ok(restored.equals(key)); restored.fill(0);
    f.store.disconnect('anthropic'); await f.store.restore('anthropic'); assert.equal(f.store.status('anthropic').remembered, true);
    const record = JSON.parse(disk); record.tag = randomBytes(16).toString('base64'); await writeFile(file, JSON.stringify(record));
    await assert.rejects(f.vault.load('anthropic'));
    await f.store.forget('anthropic'); assert.equal((await readdir(f.dir)).length, 0);
  } finally { key.fill(0); f.store.disconnect('anthropic'); await f.cleanup(); }
});

test('RS-03 keyring failure refuses persistence without plaintext fallback', async () => {
  const f = await fixture(); const key = Buffer.from(randomBytes(32).toString('hex'));
  const store = new Credentials(new EncryptedVault(f.dir, { loadOrCreate: async () => { throw new Error('Locked keyring'); } }));
  try {
    await assert.rejects(store.configure('openai', key, true));
    assert.equal(store.status('openai').connected, false); assert.equal((await readdir(f.dir)).length, 0);
    await store.configure('openai', key, false); assert.equal(store.status('openai').connected, true);
  } finally { store.disconnect('openai'); key.fill(0); await f.cleanup(); }
});

test('RS-03 Linux helper sends generated master on stdin, never argv', async () => {
  let captured = ''; const calls: string[][] = [];
  const keyring = new OSKeyring('.audit', 'linux', async (program, args, input) => {
    calls.push([program, ...args]); if (args[0] === 'lookup') throw new KeyringMissing(); captured = input!; return '';
  });
  const key = await keyring.loadOrCreate();
  assert.equal(key.length, 32); assert.ok(calls.every(args => !args.join(' ').includes(captured))); key.fill(0); captured = '';
  let stores = 0;
  const locked = new OSKeyring('.audit', 'linux', async () => { stores++; throw new Error('Locked'); });
  await assert.rejects(locked.loadOrCreate()); assert.equal(stores, 1);
});

test('RS-02 credential endpoint denies browser writes and only returns connection status', async () => {
  const url = 'http://127.0.0.1:3000/api/credentials';
  assert.equal((await configure(new Request(url, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-SaintPetrus-Client': 'terminal' }, body: '{}' }))).status, 403);
  const values = await (await status(new Request(url))).json();
  assert.ok(values.every((value: object) => Object.keys(value).sort().join(',') === 'connected,provider,remembered'));
});

test('RS-03 macOS master travels via stdin and Windows persists only wrapped material', async () => {
  const f = await fixture();
  try {
    let input = ''; let args: string[] = [];
    const mac = new OSKeyring(f.dir, 'darwin', async (_program, values, body) => {
      if (values[0] === 'find-generic-password') throw new KeyringMissing();
      args = values; input = body!; return '';
    });
    const master = await mac.loadOrCreate();
    assert.deepEqual(args, ['-i']); assert.ok(input.includes(master.toString('base64'))); master.fill(0); input = '';
    const win = new OSKeyring(f.dir, 'win32', async (_program, values) => {
      assert.ok(values.join(' ').includes('CurrentUser')); return 'DPAPI-WRAPPED-TEST-ENVELOPE';
    });
    const generated = await win.loadOrCreate(); const disk = await readFile(join(f.dir, 'master.dpapi'), 'utf8');
    assert.ok(!disk.includes(generated.toString('base64'))); generated.fill(0);
  } finally { await f.cleanup(); }
});

test('RS-02 configured secret never appears in status or API errors', async () => {
  const f = await fixture(); const candidate = randomBytes(32).toString('hex');
  const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials };
  const previous = host.saintpetrusCredentials; host.saintpetrusCredentials = f.store;
  const url = 'http://127.0.0.1:3000/api/credentials';
  const request = (body: unknown) => new Request(url, { method: 'POST', headers: {
    Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'terminal',
  }, body: JSON.stringify(body) });
  try {
    const response = await configure(request({ action: 'set', provider: 'openai', key: candidate }));
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(candidate));
    const output = await (await status(new Request(url))).text(); assert.ok(!output.includes(candidate));
    const error = await configure(request({ action: 'set', provider: candidate, key: candidate }));
    assert.equal(error.status, 400); assert.ok(!(await error.text()).includes(candidate));
    assert.equal((await readdir(f.dir)).length, 0);
  } finally { f.store.disconnect('openai'); host.saintpetrusCredentials = previous; await f.cleanup(); }
});
