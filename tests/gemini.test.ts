import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { GeminiAdapter, geminiUsage } from '../lib/providers/gemini';
import { ProviderProxy } from '../lib/providers/proxy';
import { TokenService } from '../lib/tokens/service';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { safeLog, safeStringify } from '../lib/security/redact';
const fixture = JSON.parse(await readFile('tests/fixtures/gemini-generate-content.json', 'utf8'));
const model = 'gemini-2.5-flash-lite';
// Schema-shaped synthetic fixture, derived from official UsageMetadata docs; NOT a captured live response.
test('Gemini fixture reconciles reported input, candidates plus thinking, total and configured cost through existing proxy', async () => {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/gemini-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex')); let calls = 0;
  const policy = { global: 1024, perAgent: 1024, perModel: 1024, perSession: 1024, cacheTtlMs: 0, models: { [model]: { provider: 'gemini' as const, max_tokens: 64, temperature: 0 } } };
  const prices = { date: '2026-09-07', currency: 'USD' as const, models: { [model]: { inputPerMillion: .1, outputPerMillion: .4 } } };
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  try {
    await store.configure('gemini', secret); assert.equal(store.status('gemini').remembered, false);
    const adapter = new GeminiAdapter(model, store, async (url, options) => {
      calls++; assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
      assert.equal(new URL(String(url)).search, ''); assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('x-goog-api-key'), secret.toString());
      const body = JSON.parse(String(options?.body)); assert.ok(!String(options?.body).includes(secret.toString()));
      assert.equal(body.generationConfig.maxOutputTokens, 64); assert.equal(body.generationConfig.candidateCount, 1);
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
      assert.equal(body.systemInstruction.parts[0].text, 'Brief system prompt'); assert.equal(body.contents[0].role, 'user');
      return Response.json(fixture);
    });
    const result = await service.execute(new ProviderProxy(), adapter, 'Reply OK.', new AbortController().signal, 'a', 'Brief system prompt');
    assert.equal(calls, 1); assert.equal(result.approximate, false); assert.deepEqual(result.usage, { prompt: 17, completion: 7, total: 24 });
    const row = service.snapshot().rows.find(r => r.scope === 'global')!;
    assert.deepEqual(row.actual, { prompt: 17, completion: 7, total: 24 }); assert.equal(row.reserved, 0);
    assert.ok(Math.abs(row.costEstimateUsd - .0000045) < 1e-12);
    const failed = new GeminiAdapter(model, store, async () => Response.json({ error: { message: secret.toString() } }, { status: 429 }));
    let error: unknown; try { await new ProviderProxy().execute(failed, 'Hi', new AbortController().signal); } catch (caught) { error = caught; }
    let log = ''; safeLog(error, text => { log = text; });
    assert.ok(!log.includes(secret.toString().slice(0, 12))); assert.ok(!safeStringify(error).includes(secret.toString().slice(0, 12)));
    // A 429 must stay distinguishable from an outage so the UI does not blame the user's key.
    assert.match(String(error), /rate_limited/);
  } finally { store.disconnect('gemini'); secret.fill(0); await rm(dir, { recursive: true }); }
});
test('Gemini usage mapping fails closed on inconsistencies, missing required counts, unsupported cache/tool pricing', () => {
  assert.deepEqual(geminiUsage({ promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 }), { prompt: 10, completion: 2, total: 12 });
  assert.deepEqual(geminiUsage({ promptTokenCount: 10, totalTokenCount: 10 }), { prompt: 10, completion: 0, total: 10 });
  for (const metadata of [undefined, {}, { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 99 }, { promptTokenCount: '10', totalTokenCount: 10 }, { promptTokenCount: 10, totalTokenCount: 10, cachedContentTokenCount: 2 }, { promptTokenCount: 10, totalTokenCount: 10, toolUsePromptTokenCount: 2 }]) assert.throws(() => geminiUsage(metadata), /upstream/);
});

test('Gemini RF-01 configuration selects the adapter through the existing API; execution request carries no key', async () => {
  const { POST: configure } = await import('../app/api/credentials/route');
  const { POST: execute } = await import('../app/api/provider/route');
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/gemini-api-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials; saintpetrusSelection?: { provider: string; model: string }; saintpetrusTokens?: TokenService };
  const old = { credentials: host.saintpetrusCredentials, selection: host.saintpetrusSelection, tokens: host.saintpetrusTokens, fetch: globalThis.fetch };
  const secret = randomBytes(32).toString('hex'); let calls = 0;
  const request = (path: string, body: unknown) => new Request(`http://127.0.0.1:3100/api/${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-SaintPetrus-Client': 'browser' }, body: JSON.stringify(body) });
  try {
    host.saintpetrusCredentials = store; delete host.saintpetrusTokens;
    globalThis.fetch = async (url, options) => { calls++; assert.ok(String(url).includes('generativelanguage.googleapis.com')); assert.ok(!String(options?.body).includes(secret)); return Response.json(fixture); };
    assert.equal((await configure(request('credentials', { action: 'set', provider: 'gemini', model, key: secret }))).status, 200);
    assert.equal(store.status('gemini').remembered, false);
    const req = request('provider', { action: 'test' }); assert.ok(!(await req.clone().text()).includes(secret)); assert.equal(req.headers.has('x-goog-api-key'), false);
    const response = await execute(req); assert.equal(response.status, 200); assert.equal(calls, 1);
    const body = await response.json(); assert.deepEqual(body.usage, { prompt: 17, completion: 7, total: 24 }); assert.equal(body.provider, 'gemini');
    assert.equal((await configure(request('credentials', { action: 'disconnect', provider: 'gemini' }))).status, 200);
    assert.equal(store.status('gemini').connected, false); assert.equal((await execute(request('provider', { action: 'test' }))).status, 409); assert.equal(calls, 1);
  } finally { store.disconnect('gemini'); host.saintpetrusCredentials = old.credentials; host.saintpetrusSelection = old.selection; host.saintpetrusTokens = old.tokens; globalThis.fetch = old.fetch; await rm(dir, { recursive: true }); }
});
