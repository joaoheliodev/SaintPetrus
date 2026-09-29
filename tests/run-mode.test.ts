import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POST as credentialsPost } from '../app/api/credentials/route';
import { providerStatus, validateSelection } from '../lib/providers/runtime';
import { ProviderFailure } from '../lib/providers/adapter';
import { withRunMode } from './run-mode';

const origin = 'http://127.0.0.1:3000';
const configure = (body: object, client: 'browser' | 'terminal') => credentialsPost(new Request(`${origin}/api/credentials`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-SaintPetrus-Client': client, ...(client === 'browser' ? { 'Sec-Fetch-Site': 'same-origin' } : {}) }, body: JSON.stringify(body) }));
// Fictitious credential text, generated for this test only.
const fakeKey = () => `fictitious-${Math.random().toString(36).slice(2)}`;

test('A-01 MOCK mode never stores a key or selects a keyed provider, from the browser or the terminal', async () => {
  await withRunMode('mock', async () => {
    const clients: ('browser' | 'terminal')[] = ['browser', 'terminal'];
    for (const client of clients) {
      const response = await configure({ action: 'set', provider: 'gemini', model: 'gemini-2.5-flash-lite', key: fakeKey() }, client);
      assert.equal(response.status, 400, client); assert.deepEqual(await response.json(), { error: 'disabled' });
    }
    assert.equal((await configure({ action: 'restore', provider: 'gemini' }, 'terminal')).status, 400, 'nor loads a remembered one');
    assert.throws(() => validateSelection('gemini', 'gemini-2.5-flash-lite', { 'gemini-2.5-flash-lite': { provider: 'gemini' } }), (error: unknown) => ProviderFailure.is(error) && error.code === 'disabled');
    const previous = process.env.SAINTPETRUS_PROVIDER; process.env.SAINTPETRUS_PROVIDER = 'gemini';
    try { assert.deepEqual([providerStatus().provider, providerStatus().mode], ['mock', 'mock'], 'the environment cannot select a keyed provider either'); }
    finally { if (previous === undefined) delete process.env.SAINTPETRUS_PROVIDER; else process.env.SAINTPETRUS_PROVIDER = previous; }
  });
});

test('A-01 REAL mode never answers with the mock', async () => {
  await withRunMode('real', async () => {
    const selection = Reflect.get(globalThis, 'saintpetrusSelection');
    Reflect.set(globalThis, 'saintpetrusSelection', { provider: 'mock', model: 'mock-v1' });
    try { assert.deepEqual([providerStatus().provider, providerStatus().connected, providerStatus().mode], ['none', false, 'real']); }
    finally { Reflect.set(globalThis, 'saintpetrusSelection', selection); }
    assert.throws(() => validateSelection('mock', 'mock-v1', {}), (error: unknown) => ProviderFailure.is(error) && error.code === 'invalid_request');
  });
});

test('A-01 the panel always shows MOCK or REAL and offers keyed providers only in REAL mode', async () => {
  const [workspace, panel] = await Promise.all(['components/workspace.tsx', 'components/provider-status.tsx'].map(path => readFile(path, 'utf8')));
  assert.match(workspace, /className=\{cn\('mode-badge', mockEnabled \? 'is-mock' : 'is-real'\)\}[^>]*>\{mockEnabled \? 'MOCK' : 'REAL'\}/);
  assert.match(panel, /<option value="gemini" disabled=\{!realMode\}>/);
  assert.match(panel, /<option value="deepseek" disabled=\{!realMode\}>/);
});

test('A-07 OpenAI is not supported until validated: out of the allowlist and never offered', async () => {
  const policy = JSON.parse(await readFile('config/token-policy.json', 'utf8'));
  assert.deepEqual(Object.entries(policy.models).filter(([, model]) => Reflect.get(Object(model), 'provider') === 'openai'), []);
  assert.match(await readFile('components/provider-status.tsx', 'utf8'), /<option value="openai" disabled>OpenAI \(not supported until validated\)<\/option>/);
  await withRunMode('real', async () => {
    const response = await configure({ action: 'set', provider: 'openai', model: 'gpt-5-nano', key: fakeKey() }, 'browser');
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'model_not_allowlisted' });
  });
});
