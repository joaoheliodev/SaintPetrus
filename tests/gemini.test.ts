import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { GeminiAdapter, geminiErrorCode, geminiUsage } from '../lib/providers/gemini';
import { ProviderProxy } from '../lib/providers/proxy';
import { TokenService } from '../lib/tokens/service';
import type { TokenPolicy } from '../lib/tokens/config';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { safeLog, safeStringify } from '../lib/security/redact';
import { connectionLabel } from '../components/provider-status';
const fixture = JSON.parse(await readFile('tests/fixtures/gemini-generate-content.json', 'utf8'));
const maxTokensFixture = JSON.parse(await readFile('tests/fixtures/gemini-max-tokens.json', 'utf8'));
const model = 'gemini-2.5-flash-lite';
const costLimitsUsd = { global: 1, perAgent: 1, perModel: 1, perSession: 1 };
const geminiPrice = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: .1, inputCacheMissPerMillion: .1, outputPerMillion: .4 }, peak: { inputCacheHitPerMillion: .1, inputCacheMissPerMillion: .1, outputPerMillion: .4 } };
// Schema-shaped synthetic fixture, derived from official UsageMetadata docs; NOT a captured live response.
test('Gemini fixture reconciles reported input, candidates plus thinking, total and configured cost through existing proxy', async () => {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/gemini-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex')); let calls = 0;
  const configuredModel = 'gemini-2.5-flash';
  const policy: TokenPolicy = { global: 1024, perAgent: 1024, perModel: 1024, perSession: 1024, costLimitsUsd, cacheTtlMs: 0, reservationTtlMs: 300000, models: { [configuredModel]: { provider: 'gemini', max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  const prices = { date: '2026-09-07', currency: 'USD' as const, models: { [configuredModel]: geminiPrice } };
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  try {
    await store.configure('gemini', secret); assert.equal(store.status('gemini').remembered, false);
    const adapter = new GeminiAdapter(configuredModel, store, async (url, options) => {
      calls++; assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent`);
      assert.equal(new URL(String(url)).search, ''); assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('x-goog-api-key'), secret.toString());
      const body = JSON.parse(String(options?.body)); assert.ok(!String(options?.body).includes(secret.toString()));
      assert.equal(body.generationConfig.maxOutputTokens, 64); assert.equal(body.generationConfig.candidateCount, 1);
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
      assert.equal(body.systemInstruction.parts[0].text, 'Brief system prompt'); assert.equal(body.contents[0].role, 'user');
      return Response.json(fixture);
    });
    const result = await service.execute(new ProviderProxy(), adapter, 'Reply OK.', new AbortController().signal, 'a', 'Brief system prompt');
    assert.equal(calls, 1); assert.equal(result.approximate, false); assert.deepEqual(result.usage, { prompt: 17, completion: 7, total: 24, cachedPromptFullRate: 4, inputBreakdown: { cacheHit: 4, cacheMiss: 13 } });
    const row = service.snapshot().rows.find(r => r.scope === 'global')!;
    assert.deepEqual(row.actual, { prompt: 17, completion: 7, total: 24 }); assert.equal(row.reserved, 0); assert.equal(row.conservativeCachedInput, 4);
    assert.ok(Math.abs(row.costEstimateUsd - .0000045) < 1e-12);
    const failed = new GeminiAdapter(configuredModel, store, async () => Response.json({ error: { message: secret.toString() } }, { status: 429 }));
    let error: unknown; try { await new ProviderProxy().execute(failed, 'Hi', new AbortController().signal); } catch (caught) { error = caught; }
    let log = ''; safeLog(error, text => { log = text; });
    assert.ok(!log.includes(secret.toString().slice(0, 12))); assert.ok(!safeStringify(error).includes(secret.toString().slice(0, 12)));
    // A 429 must stay distinguishable from an outage so the UI does not blame the user's key.
    assert.match(String(error), /rate_limited/);
  } finally { store.disconnect('gemini'); secret.fill(0); await rm(dir, { recursive: true }); }
});
test('Gemini usage mapping fails closed on inconsistencies, missing required counts and unsupported tool pricing', () => {
  assert.deepEqual(geminiUsage({ promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 }), { prompt: 10, completion: 2, total: 12 });
  assert.deepEqual(geminiUsage({ promptTokenCount: 10, totalTokenCount: 10 }), { prompt: 10, completion: 0, total: 10 });
  for (const metadata of [undefined, {}, { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 99 }, { promptTokenCount: '10', totalTokenCount: 10 }, { promptTokenCount: 10, totalTokenCount: 10, cachedContentTokenCount: 11 }, { promptTokenCount: 10, totalTokenCount: 10, toolUsePromptTokenCount: 2 }]) assert.throws(() => geminiUsage(metadata), /upstream/);
});

test('Gemini cached prompt tokens reconcile at the conservative full input rate', async () => {
  const usage = geminiUsage({ promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 4, totalTokenCount: 12 });
  assert.deepEqual(usage, { prompt: 10, completion: 2, total: 12, cachedPromptFullRate: 4, inputBreakdown: { cacheHit: 4, cacheMiss: 6 } });
  assert.equal(usage.prompt + usage.completion, usage.total);
  const policy: TokenPolicy = { global: 1024, perAgent: 1024, perModel: 1024, perSession: 1024, costLimitsUsd, cacheTtlMs: 0, reservationTtlMs: 300000, models: { [model]: { provider: 'gemini', max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  const prices = { date: '2026-09-07', currency: 'USD' as const, models: { [model]: geminiPrice } };
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  await service.execute(new ProviderProxy(), { id: 'gemini', model, complete: async () => ({ text: 'OK', usage }) }, 'Reply OK.', new AbortController().signal, 'a', 'System');
  const row = service.snapshot().rows.find(item => item.scope === 'global')!;
  const freeCacheCost = ((usage.prompt - usage.cachedPromptFullRate) * .1 + usage.completion * .4) / 1e6;
  assert.equal(row.conservativeCachedInput, 4);
  assert.ok(Math.abs(row.costEstimateUsd - (usage.prompt * .1 + usage.completion * .4) / 1e6) <= 1e-12);
  assert.ok(row.costEstimateUsd >= freeCacheCost);
});

test('Gemini thinking policy rejects models without explicit zero-budget support', () => {
  const prices = { date: '2026-09-07', currency: 'USD' as const, models: { [model]: geminiPrice } };
  const policy = (thinking: unknown): TokenPolicy => JSON.parse(JSON.stringify({ global: 1024, perAgent: 1024, perModel: 1024, perSession: 1024, costLimitsUsd, cacheTtlMs: 0, reservationTtlMs: 300000, models: { [model]: { provider: 'gemini', max_tokens: 64, temperature: 0, thinking } } }));
  assert.throws(() => new TokenService(policy(undefined), prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }), /Invalid/);
  assert.throws(() => new TokenService(policy({ mode: 'enabled', effort: 'low' }), prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }), /Invalid/);
  assert.throws(() => new TokenService(policy({ mode: 'disabled', effort: 'low' }), prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }), /Invalid/);
});

test('Gemini owns its HTTP mapping and rejects unsupported thinking before transport', async () => {
  for (const [status, code] of [[400, 'unauthorized'], [401, 'unauthorized'], [403, 'unauthorized'], [404, 'not_found'], [429, 'rate_limited'], [500, 'upstream']] as const) assert.equal(geminiErrorCode(status), code);
  let calls = 0;
  const credentials = { use: async () => { calls++; throw new Error('credential access'); } } as unknown as Credentials;
  await assert.rejects(new GeminiAdapter(model, credentials).complete('Hi', new AbortController().signal, { systemPrompt: '', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 64, thinking: { mode: 'enabled', effort: 'low' } }), /invalid_request/);
  assert.equal(calls, 0);
});

test('Gemini RF-01 configuration selects the adapter through the existing API; execution request carries no key', async () => {
  const { POST: configure } = await import('../app/api/credentials/route');
  const { POST: execute } = await import('../app/api/provider/route');
  const { providerStatus } = await import('../lib/providers/runtime');
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/gemini-api-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials; saintpetrusSelection?: { provider: string; model: string }; saintpetrusTokens?: TokenService };
  const old = { credentials: host.saintpetrusCredentials, selection: host.saintpetrusSelection, tokens: host.saintpetrusTokens, fetch: globalThis.fetch };
  const secret = randomBytes(32).toString('hex'); let calls = 0; let providerReply = maxTokensFixture;
  const request = (path: string, body: unknown) => new Request(`http://127.0.0.1:3100/api/${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-SaintPetrus-Client': 'browser' }, body: JSON.stringify(body) });
  try {
    host.saintpetrusCredentials = store; delete host.saintpetrusTokens;
    globalThis.fetch = async (url, options) => { calls++; assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`); assert.ok(!String(options?.body).includes(secret)); return Response.json(providerReply); };
    assert.equal((await configure(request('credentials', { action: 'set', provider: 'gemini', model: `models/${model}`, key: secret }))).status, 200);
    assert.equal(store.status('gemini').remembered, false);
    assert.equal(providerStatus().model, model);
    const req = request('provider', { action: 'test' }); assert.ok(!(await req.clone().text()).includes(secret)); assert.equal(req.headers.has('x-goog-api-key'), false);
    const limited = await execute(req); assert.equal(limited.status, 422); assert.equal(calls, 1);
    const limitedBody = await limited.json(); assert.equal(limitedBody.error, 'output_limit'); assert.equal(limitedBody.outcome, 'output_limit'); assert.deepEqual(limitedBody.usage, { prompt: 17, completion: 64, total: 81 });
    assert.equal(limitedBody.status.state, 'incomplete'); assert.equal(providerStatus().verified, false);
    assert.doesNotMatch(connectionLabel('incomplete', limitedBody.status), /connected|conectado/i);
    const limitedRow = host.saintpetrusTokens!.snapshot().rows.find(row => row.scope === 'global')!;
    assert.deepEqual(limitedRow.actual, { prompt: 17, completion: 64, total: 81 }); assert.equal(limitedRow.reserved, 0); assert.equal(limitedRow.unresolved, 0);
    providerReply = fixture;
    const response = await execute(request('provider', { action: 'test' })); assert.equal(response.status, 200); assert.equal(calls, 2);
    const body = await response.json(); assert.deepEqual(body.usage, { prompt: 17, completion: 7, total: 24, cachedPromptFullRate: 4, inputBreakdown: { cacheHit: 4, cacheMiss: 13 } }); assert.equal(body.provider, 'gemini'); assert.equal(providerStatus().state, 'verified');
    assert.equal((await configure(request('credentials', { action: 'disconnect', provider: 'gemini' }))).status, 200);
    assert.equal(store.status('gemini').connected, false); assert.equal((await execute(request('provider', { action: 'test' }))).status, 409); assert.equal(calls, 2);
  } finally { store.disconnect('gemini'); host.saintpetrusCredentials = old.credentials; host.saintpetrusSelection = old.selection; host.saintpetrusTokens = old.tokens; globalThis.fetch = old.fetch; await rm(dir, { recursive: true }); }
});
