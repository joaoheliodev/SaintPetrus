import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { DeepSeekAdapter, deepseekErrorCode, deepseekUsage } from '../lib/providers/deepseek';
import { geminiErrorCode } from '../lib/providers/gemini';
import { ProviderFailure } from '../lib/providers/adapter';
import { ProviderProxy } from '../lib/providers/proxy';
import { TokenService } from '../lib/tokens/service';
import type { ModelPrice } from '../lib/tokens/pricing';
import type { TokenPolicy, Prices } from '../lib/tokens/config';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { safeLog, safeStringify } from '../lib/security/redact';
const completion = JSON.parse(await readFile('tests/fixtures/deepseek-chat-completion.json', 'utf8'));
const cacheMiss = JSON.parse(await readFile('tests/fixtures/deepseek-cache-miss.json', 'utf8'));
const outputLimit = JSON.parse(await readFile('tests/fixtures/deepseek-max-tokens.json', 'utf8'));
const model = 'deepseek-test-model';
const served = 'deepseek-test-served';
// Placeholder bands, not a rate card: they only have to keep the documented 50x spread between the
// two input bands and the documented 2:1 spread between peak and off-peak visible in the assertions.
const band = (factor: number) => ({ inputCacheHitPerMillion: .003 * factor, inputCacheMissPerMillion: .15 * factor, outputPerMillion: .6 * factor });
const price = (): ModelPrice => ({ effectiveAt: '1970-01-01', verifiedAt: '2026-09-10',
  peakWindowsUtc: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 }, { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 }],
  offPeak: band(1), peak: band(2) });
const offPeakAt = Date.parse('2026-09-09T12:00:00.000Z');
const costLimitsUsd = { global: 1, perAgent: 1, perModel: 1, perSession: 1 };
// `thinking` is required here on purpose: a default would hide the "policy did not declare it" case.
const policyFor = (thinking: unknown, models = [model]): TokenPolicy => JSON.parse(JSON.stringify({
  global: 4096, perAgent: 4096, perModel: 4096, perSession: 4096, costLimitsUsd, cacheTtlMs: 0, reservationTtlMs: 300000,
  models: Object.fromEntries(models.map(id => [id, { provider: 'deepseek', max_tokens: 128, temperature: 0, thinking }])),
}));
const pricesFor = (models = [model]): Prices => ({ date: '2026-09-10', currency: 'USD', models: Object.fromEntries(models.map(id => [id, price()])) });
const hooks = { ids: () => ['a'], pause: () => {}, pauseAll: () => {} };
const signal = () => new AbortController().signal;

async function withCredentials<T>(run: (store: Credentials, secret: Buffer) => Promise<T>) {
  await mkdir('.audit', { recursive: true });
  const dir = await mkdtemp('.audit/deepseek-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  await store.configure('deepseek', secret);
  try { return await run(store, secret); } finally { store.disconnect('deepseek'); secret.fill(0); await rm(dir, { recursive: true }); }
}

test('DeepSeek reconciles the reported cache split at the off-peak bands through the existing proxy', async () => {
  await withCredentials(async (store, secret) => {
    assert.ok([1, 2, 3, 4, 5].includes(new Date(offPeakAt).getUTCDay()), 'the chosen timestamp must be a weekday for the peak window to apply');
    let calls = 0;
    const adapter = new DeepSeekAdapter(model, store, async (url, options) => {
      calls++;
      assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
      assert.equal(new URL(String(url)).search, '');
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${secret.toString()}`);
      const body = JSON.parse(String(options?.body));
      assert.ok(!String(options?.body).includes(secret.toString()));
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal('reasoning_effort' in body, false);
      assert.equal(body.model, model); assert.equal(body.max_tokens, 128); assert.equal(body.temperature, 0); assert.equal(body.stream, false);
      assert.deepEqual(body.messages[0], { role: 'system', content: 'Brief system prompt' });
      return Response.json(completion);
    });
    const service = new TokenService(policyFor({ mode: 'disabled' }), pricesFor(), hooks, undefined, () => offPeakAt);
    const result = await service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'Brief system prompt');
    assert.equal(calls, 1);
    assert.deepEqual(result.usage, { prompt: 24, completion: 12, total: 36, inputBreakdown: { cacheHit: 16, cacheMiss: 8 } });
    const row = service.snapshot().rows.find(item => item.scope === 'global')!;
    assert.deepEqual(row.actual, { prompt: 24, completion: 12, total: 36 });
    assert.equal(row.reserved, 0); assert.equal(row.unresolved, 0);
    const expected = (16 * .003 + 8 * .15 + 12 * .6) / 1e6;
    assert.ok(Math.abs(row.costEstimateUsd - expected) < 1e-12, `${row.costEstimateUsd} != ${expected}`);
    // Same token count, all cache miss, must cost the documented 50x more on the input side.
    const missService = new TokenService(policyFor({ mode: 'disabled' }), pricesFor(), hooks, undefined, () => offPeakAt);
    const missAdapter = new DeepSeekAdapter(model, store, async () => Response.json(cacheMiss));
    const missResult = await missService.execute(new ProviderProxy(), missAdapter, 'Reply OK.', signal(), 'a', 'Brief system prompt');
    assert.deepEqual(missResult.usage!.inputBreakdown, { cacheHit: 0, cacheMiss: 24 });
    const missRow = missService.snapshot().rows.find(item => item.scope === 'global')!;
    assert.ok(Math.abs(missRow.costEstimateUsd - (24 * .15 + 12 * .6) / 1e6) < 1e-12);
    assert.ok(missRow.costEstimateUsd - 12 * .6 / 1e6 > 49 * (row.costEstimateUsd - 12 * .6 / 1e6 - 8 * .15 / 1e6));
  });
});

test('DeepSeek usage parsing fails closed on an unconfirmed shape instead of assuming zero', () => {
  assert.deepEqual(deepseekUsage(completion.usage), { prompt: 24, completion: 12, total: 36, inputBreakdown: { cacheHit: 16, cacheMiss: 8 } });
  assert.deepEqual(deepseekUsage(cacheMiss.usage), { prompt: 24, completion: 12, total: 36, inputBreakdown: { cacheHit: 0, cacheMiss: 24 } });
  const base = { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36, prompt_cache_hit_tokens: 16, prompt_cache_miss_tokens: 8 };
  for (const usage of [
    undefined, null, 'usage', [],
    {},
    // The whole split absent is the shape that a silent zero-fill would price as 100% cache miss.
    { prompt_tokens: 24, completion_tokens: 12, total_tokens: 36 },
    { ...base, prompt_cache_hit_tokens: undefined },
    { ...base, prompt_cache_miss_tokens: undefined },
    { ...base, prompt_cache_hit_tokens: 15 },
    { ...base, total_tokens: 99 },
    { ...base, prompt_tokens: '24' },
    { ...base, completion_tokens: -1 },
    { ...base, completion_tokens_details: 7 },
    { ...base, completion_tokens_details: { reasoning_tokens: '0' } },
    { ...base, completion_tokens_details: { reasoning_tokens: 13 } },
    { ...base, prompt_tokens_details: { cached_tokens: 15 } },
  ]) assert.throws(() => deepseekUsage(usage), /upstream/, `expected a closed failure for ${JSON.stringify(usage)}`);
});

test('DeepSeek owns its status mapping and contradicts the shared one Gemini needs', async () => {
  for (const [status, code] of [[400, 'invalid_request'], [401, 'unauthorized'], [402, 'insufficient_balance'], [422, 'invalid_request'], [429, 'rate_limited'], [500, 'upstream'], [503, 'upstream']] as const) {
    assert.equal(deepseekErrorCode(status), code);
  }
  // The same status means opposite things per provider, which is why the translation cannot be shared.
  assert.equal(geminiErrorCode(400), 'unauthorized');
  assert.notEqual(deepseekErrorCode(400), geminiErrorCode(400));
  assert.equal(deepseekErrorCode(402), 'insufficient_balance');
  await withCredentials(async (store, secret) => {
    for (const [status, code] of [[400, 'invalid_request'], [401, 'unauthorized'], [402, 'insufficient_balance'], [422, 'invalid_request'], [429, 'rate_limited'], [500, 'upstream'], [503, 'upstream']] as const) {
      const adapter = new DeepSeekAdapter(model, store, async () => Response.json({ error: { message: `leaked ${secret.toString()}` } }, { status }));
      let error: unknown;
      try { await new ProviderProxy().execute(adapter, 'Hi', signal(), { systemPrompt: '', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 64, thinking: { mode: 'disabled' } }); }
      catch (caught) { error = caught; }
      assert.ok(error instanceof ProviderFailure); assert.equal(error.code, code);
      let log = ''; safeLog(error, text => { log = text; });
      assert.ok(!log.includes(secret.toString().slice(0, 12)));
      assert.ok(!safeStringify(error).includes(secret.toString().slice(0, 12)));
      assert.doesNotMatch(String(error), /leaked/);
    }
  });
});

test('DeepSeek failures that prove no billing release the reservation; lost contact never does', async () => {
  for (const [code, unresolved] of [['insufficient_balance', 0], ['rate_limited', 0], ['unauthorized', 0], ['invalid_request', 0], ['upstream', 1], ['timeout', 1]] as const) {
    const service = new TokenService(policyFor({ mode: 'disabled' }), pricesFor(), hooks, undefined, () => offPeakAt);
    const adapter = { id: 'deepseek' as const, model, complete: async () => { throw new ProviderFailure(code); } };
    await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System'), new RegExp(code));
    const row = service.snapshot().rows.find(item => item.scope === 'global')!;
    assert.equal(row.unresolved, unresolved, `${code} must leave ${unresolved} unresolved`);
    assert.equal(row.reserved > 0, unresolved === 1, `${code} must ${unresolved ? 'hold' : 'release'} the reservation`);
    assert.equal(row.costReservedUsd > 0, unresolved === 1);
  }
});

test('DeepSeek prices by the model that answered, and a served model with no price stays unresolved', async () => {
  await withCredentials(async store => {
    const reroute = { ...completion, model: served };
    const priced = new TokenService(policyFor({ mode: 'disabled' }), pricesFor([model, served]), hooks, undefined, () => offPeakAt);
    const adapter = new DeepSeekAdapter(model, store, async () => Response.json(reroute));
    const result = await priced.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System');
    assert.equal(result.billingModel, served);
    assert.notEqual(result.billingModel, result.model);
    const row = priced.snapshot().rows.find(item => item.scope === 'global')!;
    assert.ok(Math.abs(row.costEstimateUsd - (16 * .003 + 8 * .15 + 12 * .6) / 1e6) < 1e-12);
    assert.equal(row.unresolved, 0);
    // The requested model is priced, the served one is not: the call happened and must not be
    // released as if it had been free.
    const unpriced = new TokenService(policyFor({ mode: 'disabled' }), pricesFor([model]), hooks, undefined, () => offPeakAt);
    const strayAdapter = new DeepSeekAdapter(model, store, async () => Response.json(reroute));
    await assert.rejects(unpriced.execute(new ProviderProxy(), strayAdapter, 'Reply OK.', signal(), 'a', 'System'), /no verified price/);
    const strayRow = unpriced.snapshot().rows.find(item => item.scope === 'global')!;
    assert.equal(strayRow.unresolved, 1);
    assert.ok(strayRow.reserved > 0);
    assert.deepEqual(strayRow.actual, { prompt: 0, completion: 0, total: 0 });
  });
});

test('DeepSeek refuses to run on the provider thinking default and reports an output-limit response', async () => {
  await withCredentials(async store => {
    let calls = 0;
    const adapter = new DeepSeekAdapter(model, store, async () => { calls++; return Response.json(outputLimit); });
    const options = { systemPrompt: '', messages: [{ role: 'user' as const, content: 'Hi' }], temperature: 0, maxTokens: 128 };
    await assert.rejects(adapter.complete('Hi', signal(), options), /invalid_request/);
    await assert.rejects(adapter.complete('Hi', signal(), { ...options, thinking: { mode: 'enabled', effort: 'minimal' } }), /invalid_request/);
    await assert.rejects(adapter.complete('Hi', signal()), /invalid_request/);
    assert.equal(calls, 0, 'an undeclared or inexpressible thinking mode must not reach the transport');
    const limited = await adapter.complete('Hi', signal(), { ...options, thinking: { mode: 'disabled' } });
    assert.equal(calls, 1); assert.equal(limited.outcome, 'output_limit'); assert.equal(limited.text, '');
    assert.deepEqual(limited.usage, { prompt: 24, completion: 128, total: 152, inputBreakdown: { cacheHit: 0, cacheMiss: 24 } });
    const effortAdapter = new DeepSeekAdapter(model, store, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.reasoning_effort, 'high'); assert.equal('thinking' in body, false);
      return Response.json(completion);
    });
    assert.equal((await effortAdapter.complete('Hi', signal(), { ...options, thinking: { mode: 'enabled', effort: 'high' } })).text, 'OK');
  });
});

test('A DeepSeek model policy must declare its thinking mode and cannot ask for an unsupported effort', () => {
  assert.throws(() => new TokenService(policyFor(undefined), pricesFor(), hooks), /Invalid local model policy/);
  assert.throws(() => new TokenService(policyFor({ mode: 'enabled', effort: 'minimal' }), pricesFor(), hooks), /Invalid local model policy/);
  assert.doesNotThrow(() => new TokenService(policyFor({ mode: 'enabled', effort: 'max' }), pricesFor(), hooks));
  assert.doesNotThrow(() => new TokenService(policyFor({ mode: 'disabled' }), pricesFor(), hooks));
});
