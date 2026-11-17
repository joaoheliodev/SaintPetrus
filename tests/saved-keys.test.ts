// F-02 (Round 10): the panel can forget any provider's saved key. The server reports which providers have an encrypted
// copy by name only, also after Disconnect or a restart, and the Connection view offers Forget for each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { Credentials } from '../lib/security/credentials';
import { GET as providerGet } from '../app/api/provider/route';
import { POST as configure } from '../app/api/credentials/route';
import { ConnectionView, forgetQuestion, savedKeyProviders } from '../components/provider-status';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';
import { withRunMode } from './run-mode';

async function fixture(keyring = async () => Buffer.from(randomBytes(32))) {
  await mkdir('.audit', { recursive: true });
  const dir = await mkdtemp('.audit/saved-keys-');
  const vault = new EncryptedVault(dir, { loadOrCreate: keyring });
  return { dir, vault, store: new Credentials(vault), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
const origin = 'http://127.0.0.1:3000';
const post = (body: unknown, client: 'terminal' | 'browser') => configure(new Request(`${origin}/api/credentials`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-SaintPetrus-Client': client, ...(client === 'browser' ? { 'Sec-Fetch-Site': 'same-origin' } : {}) }, body: JSON.stringify(body) }));
const report = async () => { const response = await providerGet(new Request(`${origin}/api/provider`)); return { status: response.status, text: await response.text() }; };
// The process credentials, selection and proxy, swapped for the test and put back.
async function withProcess(store: Credentials, selection: { provider: string; model: string }, run: () => Promise<void>) {
  const names = ['saintpetrusCredentials', 'saintpetrusSelection', 'saintpetrusProxy', 'saintpetrusVerification'];
  const old = new Map(names.map(name => [name, Reflect.get(globalThis, name)]));
  Reflect.set(globalThis, 'saintpetrusCredentials', store); Reflect.set(globalThis, 'saintpetrusSelection', selection);
  try { await run(); } finally { for (const [name, value] of old) Reflect.set(globalThis, name, value); }
}

test('F-02 the vault lists saved copies by file name alone: no file is opened and the keyring is not asked', async () => {
  let asked = 0;
  const f = await fixture(async () => { asked++; throw new Error('The keyring must not be asked.'); });
  try {
    await rm(f.dir, { recursive: true });
    assert.deepEqual(await f.vault.saved(), [], 'no vault directory yet means nothing is saved');
    await mkdir(f.dir, { recursive: true });
    // Not ciphertext at all: a listing that read or decrypted a file would fail on these.
    for (const name of ['openrouter.json', 'gemini.json', 'gemini.json.tmp', 'unknown.json', 'openai.txt', 'deepseek']) await writeFile(join(f.dir, name), 'not a vault record');
    assert.deepEqual(await f.vault.saved(), ['gemini', 'openrouter'], 'known providers only, in the fixed order, never a leftover or a stranger');
    assert.deepEqual(await f.store.saved(), ['gemini', 'openrouter']);
    await f.vault.forget('gemini');
    assert.deepEqual(await f.vault.saved(), ['openrouter']);
    assert.equal(asked, 0);
  } finally { await f.cleanup(); }
});

test('F-02 the status names a saved copy after Disconnect, and the browser can forget one that is not the selected provider', () => withRunMode('real', async () => {
  const f = await fixture(); const key = randomBytes(32).toString('hex');
  try {
    await withProcess(f.store, { provider: 'gemini', model: 'fictitious-model' }, async () => {
      assert.deepEqual(JSON.parse((await report()).text).savedKeys, []);
      assert.equal((await post({ action: 'set', provider: 'openai', key, remember: true }, 'terminal')).status, 200);
      assert.equal((await post({ action: 'set', provider: 'deepseek', key, remember: true }, 'terminal')).status, 200);
      let now = await report();
      assert.equal(now.status, 200); assert.deepEqual(JSON.parse(now.text).savedKeys, ['openai', 'deepseek']);
      assert.ok(!now.text.includes(key), 'names only: the status never carries a key');
      // The gap R1-06 recorded: once the key left memory nothing said a copy was still on disk.
      assert.equal((await post({ action: 'disconnect', provider: 'openai' }, 'browser')).status, 200);
      assert.deepEqual(f.store.status('openai'), { provider: 'openai', connected: false, remembered: false });
      assert.deepEqual(JSON.parse((await report()).text).savedKeys, ['openai', 'deepseek'], 'a saved copy outlives Disconnect');
      // Forgetting one provider's copy from the browser leaves the other's alone, on disk and in memory.
      const forgotten = await post({ action: 'forget', provider: 'openai' }, 'browser');
      assert.equal(forgotten.status, 200); assert.ok(!(await forgotten.text()).includes(key));
      assert.deepEqual(await readdir(f.dir), ['deepseek.json']);
      now = await report();
      assert.deepEqual(JSON.parse(now.text).savedKeys, ['deepseek']);
      assert.equal(f.store.status('deepseek').connected, true);
    });
  } finally { f.store.disconnect('openai'); f.store.disconnect('deepseek'); await f.cleanup(); }
}));

test('F-02 MOCK mode still names saved copies and lets the browser forget them, and an unlistable vault names none', () => withRunMode('mock', async () => {
  const f = await fixture(); const key = Buffer.from(randomBytes(32).toString('hex'));
  try {
    // Saved by an earlier REAL run: MOCK mode stores and loads no key, but a copy on disk is still the operator's to delete.
    await f.vault.save('gemini', key);
    await withProcess(f.store, { provider: 'mock', model: 'mock-v1' }, async () => {
      assert.equal((await post({ action: 'restore', provider: 'gemini' }, 'terminal')).status, 400, 'MOCK mode loads no key');
      const body = JSON.parse((await report()).text);
      assert.deepEqual([body.mode, body.provider, body.savedKeys], ['mock', 'mock', ['gemini']]);
      assert.equal((await post({ action: 'forget', provider: 'gemini' }, 'browser')).status, 200);
      assert.deepEqual(await readdir(f.dir), []);
      assert.deepEqual(JSON.parse((await report()).text).savedKeys, []);
    });
    // A vault path that cannot be listed is not an outage of the status: it answers, naming no saved copy.
    await rm(f.dir, { recursive: true }); await writeFile(f.dir, 'a file where the vault directory should be');
    await withProcess(f.store, { provider: 'mock', model: 'mock-v1' }, async () => {
      await assert.rejects(f.vault.saved(), 'the vault itself does not hide the error');
      const answer = await report();
      assert.equal(answer.status, 200); assert.deepEqual(JSON.parse(answer.text).savedKeys, []);
    });
  } finally { key.fill(0); await f.cleanup(); }
}));

const status: ProviderStatusSnapshot = { provider: 'gemini', model: 'fictitious-model', connected: true, mocked: false, mockAvailable: false, verified: false, state: 'configured', mode: 'real' };
const view = (next: Partial<ProviderStatusSnapshot>) => renderToStaticMarkup(React.createElement(ConnectionView, { source: { status: { ...status, ...next }, unavailable: false, refresh: async () => {} } }));

test('F-02 the Connection view lists every saved key with its own Forget button, whatever is connected', () => {
  assert.deepEqual(savedKeyProviders({ savedKeys: ['deepseek', 'openai', 'stranger', 'gemini'] }), ['openai', 'gemini', 'deepseek'], 'the panel\'s order, and only names it knows');
  for (const nothing of [undefined, {}, { savedKeys: [] }]) assert.deepEqual(savedKeyProviders(nothing), []);
  assert.deepEqual(savedKeyProviders(JSON.parse('{"savedKeys":"openai"}')), [], 'a malformed answer lists nothing');

  const none = view({ savedKeys: [] });
  assert.doesNotMatch(none, /Saved keys/); assert.doesNotMatch(none, /Forget \w+ key<\/button>/);
  assert.match(none, />Forget key<\/button>/, 'the selected provider keeps its own Forget key, for a key held in memory only');

  const saved = view({ savedKeys: ['deepseek', 'anthropic'] });
  assert.match(saved, /<section class="saved-keys" aria-labelledby="saved-keys-title"><h2 id="saved-keys-title">Saved keys<\/h2>/);
  assert.deepEqual([...saved.matchAll(/<li><span>([^<]+)<\/span><button[^>]*>([^<]+)<\/button><\/li>/g)].map(match => [match[1], match[2]]), [['DeepSeek', 'Forget DeepSeek key'], ['Anthropic', 'Forget Anthropic key']]);
  assert.match(saved, /also while the key is not connected/);

  // After Disconnect or a restart nothing is connected and the selected provider's Forget key is disabled: the list is the way.
  const disconnected = view({ provider: 'none', model: '', connected: false, state: 'disconnected', savedKeys: ['gemini'] });
  assert.match(disconnected, /Forget Google Gemini key<\/button>/);
  assert.match(disconnected, /<button[^>]*disabled=""[^>]*>Forget key<\/button>/);
  // MOCK mode stores no key, but a copy saved by an earlier REAL run can still be forgotten from here.
  assert.match(view({ provider: 'mock', model: 'mock-v1', mocked: true, mockAvailable: true, mode: 'mock', savedKeys: ['openai'] }), /Forget OpenAI key<\/button>/);
});

test('F-02 a saved key\'s button forgets that provider, not the selected one', async () => {
  // A static render cannot click, so the wiring is held in the source, as tests/navigation.test.ts does for the chip.
  const source = await readFile('components/provider-status.tsx', 'utf8');
  assert.ok(source.includes("onClick={() => run('forget', name)}>Forget {providerNames[name]} key</Button>"), 'each row names its own provider');
  assert.ok(source.includes("if (action === 'forget' && !await confirm({ message: forgetQuestion(target, status?.provider), confirmLabel: 'Forget key', destructive: true })) return;"), 'it asks first, about that provider');
  assert.ok(source.includes("if (action === 'forget') { await configure('forget', target);"), 'and sends that provider');
  assert.ok(source.includes("const selected = action === 'set' ? provider : target ?? status?.provider ?? 'none';"), 'which the request then carries');
  assert.ok(source.includes("onClick={() => run('forget')}>Forget key</Button>"), 'while Forget key itself still acts on the selected provider');
});

test('F-02 the Forget question names the provider and says what else it ends when that is another provider', () => {
  const own = forgetQuestion('gemini', 'gemini');
  assert.match(own, /^Forget the gemini key\? This clears it from backend memory and deletes any encrypted copy saved on this machine\. It cannot be undone\.$/);
  assert.match(forgetQuestion('deepseek', 'gemini'), /^Forget the deepseek key\? .*It cannot be undone\. A call in flight is cancelled and the current connection must be tested again\.$/);
  for (const selected of [undefined, 'none']) assert.equal(forgetQuestion('deepseek', selected), own.replace('gemini', 'deepseek'), 'nothing connected: nothing else ends');
});
