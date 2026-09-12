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
  models: Object.fromEntries(models.map(id => [id, { provider: 'deepseek', max_tokens: 128, temperature: 0, deterministic: true, thinking }])),
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

test('A populated reasoning_content leaves no trace in the result, the bus, the preview or the cache', async () => {
  const marker = 'CHAIN-OF-THOUGHT-MARKER';
  const reasoning = { ...completion, choices: [{ ...completion.choices[0], message: { ...completion.choices[0].message, content: '<div>OK</div>' } }] };
  // Without this the test proves nothing: the leak has to be present in the response to be caught.
  assert.ok(JSON.stringify(reasoning).includes(marker));
  assert.ok(reasoning.choices[0].message.reasoning_content.includes(marker));
  const { eventBus } = await import('../lib/events/bus');
  const { artifacts } = await import('../lib/preview/store');
  const preview = process.env.SAINTPETRUS_PREVIEW;
  process.env.SAINTPETRUS_PREVIEW = 'true';
  const before = eventBus().snapshot().cursor;
  try {
    await withCredentials(async store => {
      const policy = policyFor({ mode: 'disabled' }); policy.cacheTtlMs = 60000;
      const service = new TokenService(policy, pricesFor(), hooks, undefined, () => offPeakAt);
      const adapter = new DeepSeekAdapter(model, store, async () => Response.json(reasoning));
      const result = await service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System');
      assert.equal(result.text, '<div>OK</div>');
      assert.ok(!JSON.stringify(result).includes(marker), 'the completion envelope must not carry the chain of thought');
      artifacts().flush();
      const stored = artifacts().snapshot();
      assert.ok(stored.length > 0, 'the preview must have observed the visible answer');
      assert.ok(!JSON.stringify(stored).includes(marker), 'the preview must not carry the chain of thought');
      assert.ok(JSON.stringify(stored).includes('<div>OK</div>'));
      const published = eventBus().snapshot(before).events;
      assert.ok(published.some(event => event.type === 'agent.message'), 'the visible answer must still reach the bus');
      assert.ok(!JSON.stringify(published).includes(marker), 'the bus must not carry the chain of thought');
      // A second identical call is served from the cache; the stored entry must be just as clean.
      const cached = await service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System');
      assert.equal(cached.cached, true);
      assert.ok(!JSON.stringify(cached).includes(marker), 'the cache must not carry the chain of thought');
    });
  } finally {
    if (preview === undefined) delete process.env.SAINTPETRUS_PREVIEW; else process.env.SAINTPETRUS_PREVIEW = preview;
  }
});

test('RT-04 reuses an answer only when the policy claims determinism and the request switched reasoning off', async () => {
  const cachingPolicy = (provider: string, id: string, thinking?: unknown, deterministic = true): TokenPolicy => JSON.parse(JSON.stringify({
    global: 4096, perAgent: 4096, perModel: 4096, perSession: 4096, costLimitsUsd, cacheTtlMs: 60000, reservationTtlMs: 300000,
    models: { [id]: { provider, max_tokens: 128, temperature: 0, deterministic, ...(thinking ? { thinking } : {}) } },
  }));
  const priced = (id: string): Prices => ({ date: '2026-09-10', currency: 'USD', models: { [id]: price() } });
  const twice = async (policy: TokenPolicy, id: string, provider: 'deepseek' | 'openai' | 'mock') => {
    let calls = 0;
    const service = new TokenService(policy, priced(id), hooks, undefined, () => offPeakAt);
    const adapter = { id: provider, model: id, complete: async () => { calls++; return { text: 'Answer', usage: { prompt: 10, completion: 10, total: 20 } }; } };
    await service.execute(new ProviderProxy(), adapter, 'Question', signal(), 'a', 'System');
    const second = await service.execute(new ProviderProxy(), adapter, 'Question', signal(), 'a', 'System');
    return { calls, service, secondCached: second.cached };
  };
  // Both halves present: the policy vouches for the model and the request turned reasoning off.
  const reusable = await twice(cachingPolicy('deepseek', model, { mode: 'disabled' }), model, 'deepseek');
  assert.equal(reusable.calls, 1); assert.equal(reusable.secondCached, true);
  // Reasoning on: the provider may ignore temperature while it reasons, so nothing may be reused.
  const reasoning = await twice(cachingPolicy('deepseek', model, { mode: 'enabled', effort: 'high' }), model, 'deepseek');
  assert.equal(reasoning.calls, 2); assert.equal(reasoning.secondCached, false);
  assert.equal(reasoning.service.snapshot().rows.find(row => row.scope === 'global')!.saved, 0);
  // Reasoning off but nobody vouched for the model: the claim is per model and absent means no.
  const unclaimed = await twice(cachingPolicy('deepseek', model, { mode: 'disabled' }, false), model, 'deepseek');
  assert.equal(unclaimed.calls, 2); assert.equal(unclaimed.secondCached, false);
  // Same criterion applied to the provider that was already here: an undeclared mode is not a disabled one.
  const undeclared = await twice(cachingPolicy('openai', 'gpt-test-model', undefined), 'gpt-test-model', 'openai');
  assert.equal(undeclared.calls, 2); assert.equal(undeclared.secondCached, false);
  // A model that cannot reason still has to say both things: neither half is inferred.
  const mockUndeclared = await twice(cachingPolicy('mock', 'mock-v1', undefined), 'mock-v1', 'mock');
  assert.equal(mockUndeclared.calls, 2); assert.equal(mockUndeclared.secondCached, false);
  const mockDeclared = await twice(cachingPolicy('mock', 'mock-v1', { mode: 'disabled' }), 'mock-v1', 'mock');
  assert.equal(mockDeclared.calls, 1); assert.equal(mockDeclared.secondCached, true);
  // The claim is validated as a claim, not coerced from whatever the operator typed.
  assert.throws(() => new TokenService(cachingPolicy('deepseek', model, { mode: 'disabled' }, 'yes' as unknown as boolean), priced(model), hooks), /Invalid local model policy/);
});

test('D6 DeepSeek is selectable end to end and an exhausted balance never rejects the credential', async () => {
  const { POST: configure } = await import('../app/api/credentials/route');
  const { POST: execute } = await import('../app/api/provider/route');
  const { providerStatus, validateSelection } = await import('../lib/providers/runtime');
  const { verificationMessage } = await import('../components/provider-status');
  const allowlist = policyFor({ mode: 'disabled' }).models;
  assert.deepEqual(validateSelection('deepseek', model, allowlist), { provider: 'deepseek', model });
  assert.throws(() => validateSelection('deepseek', 'deepseek-not-configured', allowlist), /model_not_allowlisted/);
  assert.throws(() => validateSelection('anthropic', model, allowlist), /invalid_request/);
  // An empty balance is neither a bad key nor an outage, and the panel has to say so in its own words.
  assert.notEqual(verificationMessage(402), verificationMessage(401));
  assert.notEqual(verificationMessage(402), verificationMessage(502));
  assert.match(verificationMessage(402), /balance/i);
  await withCredentials(async (store, secret) => {
    const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials; saintpetrusSelection?: { provider: string; model: string }; saintpetrusTokens?: TokenService };
    const old = { credentials: host.saintpetrusCredentials, selection: host.saintpetrusSelection, tokens: host.saintpetrusTokens, fetch: globalThis.fetch };
    let reply: () => Response = () => Response.json(completion);
    let calls = 0;
    const request = (path: string, body: unknown) => new Request(`http://127.0.0.1:3100/api/${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-SaintPetrus-Client': 'browser' }, body: JSON.stringify(body) });
    try {
      host.saintpetrusCredentials = store;
      host.saintpetrusTokens = new TokenService(policyFor({ mode: 'disabled' }), pricesFor(), { ids: () => ['root'], pause: () => {}, pauseAll: () => {} }, undefined, () => offPeakAt);
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
        assert.ok(!String(init?.body).includes(secret.toString()));
        return reply();
      };
      assert.equal((await configure(request('credentials', { action: 'set', provider: 'deepseek', model, key: secret.toString() }))).status, 200);
      assert.equal(providerStatus().provider, 'deepseek');
      assert.equal(providerStatus().model, model);
      assert.equal(providerStatus().state, 'configured');
      reply = () => Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 });
      const empty = await execute(request('provider', { action: 'test' }));
      assert.equal(empty.status, 402);
      assert.equal((await empty.json()).error, 'insufficient_balance');
      assert.equal(calls, 1);
      assert.equal(providerStatus().state, 'configured', 'an empty balance must not move the credential out of configured');
      assert.equal(providerStatus().verified, false);
      assert.equal(providerStatus().failureCode, undefined, 'an empty balance is not a verification failure');
      reply = () => Response.json(completion);
      const ok = await execute(request('provider', { action: 'test' }));
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.provider, 'deepseek');
      assert.deepEqual(body.usage, { prompt: 24, completion: 12, total: 36, inputBreakdown: { cacheHit: 16, cacheMiss: 8 } });
      assert.equal(providerStatus().state, 'verified');
      // A refused credential still has to be reported as refused.
      reply = () => Response.json({ error: { message: 'Authentication Fails' } }, { status: 401 });
      assert.equal((await execute(request('provider', { action: 'test' }))).status, 401);
      assert.equal(providerStatus().state, 'rejected');
      assert.equal(providerStatus().failureCode, 'unauthorized');
    } finally {
      host.saintpetrusCredentials = old.credentials; host.saintpetrusSelection = old.selection; host.saintpetrusTokens = old.tokens; globalThis.fetch = old.fetch;
    }
  });
});

test('C5 the connection probe switches reasoning off even when the policy asks for it', async () => {
  await withCredentials(async store => {
    const bodies: Record<string, unknown>[] = [];
    const adapter = new DeepSeekAdapter(model, store, async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json(completion); });
    const reasoningPolicy = policyFor({ mode: 'enabled', effort: 'high' });
    const service = new TokenService(reasoningPolicy, pricesFor(), hooks, undefined, () => offPeakAt);
    await service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System', undefined, true);
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' }, 'the probe must not pay for a chain of thought');
    assert.equal('reasoning_effort' in bodies[0], false);
    // Ordinary execution still obeys the policy the operator wrote.
    await service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System');
    assert.equal(bodies[1].reasoning_effort, 'high');
    assert.equal('thinking' in bodies[1], false);
    // A provider with no off switch keeps its policy: omitting the field would fall back to a
    // costlier provider default instead of a cheaper one.
    const openaiPolicy = policyFor({ mode: 'enabled', effort: 'minimal' });
    openaiPolicy.models[model].provider = 'openai';
    const seen: unknown[] = [];
    const openaiService = new TokenService(openaiPolicy, pricesFor(), hooks, undefined, () => offPeakAt);
    const openaiAdapter = { id: 'openai' as const, model, complete: async (_input: string, _signal: AbortSignal, options?: { thinking?: unknown }) => { seen.push(options?.thinking); return { text: 'Answer', usage: { prompt: 10, completion: 10, total: 20 } }; } };
    await openaiService.execute(new ProviderProxy(), openaiAdapter, 'Reply OK.', signal(), 'a', 'System', undefined, true);
    assert.deepEqual(seen[0], { mode: 'enabled', effort: 'minimal' });
  });
});

test('An expired reservation converts at the dearest model in the table, not at what was held', async () => {
  const dear = 'deepseek-test-dear';
  const policy = policyFor({ mode: 'disabled' }); policy.reservationTtlMs = 100;
  const prices = pricesFor([model]);
  // A model the request could have been rerouted to, four times the price of the one asked for.
  prices.models[dear] = { ...price(), offPeak: band(4), peak: band(8) };
  let now = offPeakAt;
  const service = new TokenService(policy, prices, hooks, undefined, () => now);
  const adapter = { id: 'deepseek' as const, model, complete: async () => { throw new ProviderFailure('timeout'); } };
  await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Reply OK.', signal(), 'a', 'System'), /timeout/);
  const held = service.snapshot().rows.find(row => row.scope === 'global')!.costReservedUsd;
  assert.ok(held > 0);
  now += 101;
  const row = service.snapshot().rows.find(item => item.scope === 'global')!;
  assert.equal(row.unresolved, 0); assert.equal(row.reserved, 0); assert.equal(row.costReservedUsd, 0);
  // Peak rate, no cache hits, dearest model: eight times the cheap model's own peak figure.
  assert.ok(Math.abs(row.costEstimatedUsd - held * 4) < 1e-12, `${row.costEstimatedUsd} is not the dearest model's cost`);
  assert.ok(row.costEstimatedUsd > held, 'converting at the held figure would understate a reroute');
  assert.equal(row.costEstimateUsd, row.costEstimatedUsd);
  // Manual reconciliation must remove exactly what the conversion charged, not the held figure.
  const reservation = service.snapshot().reservations[0];
  service.reconcileReservation(reservation.id, 24, 12, 0.000002);
  const settled = service.snapshot().rows.find(item => item.scope === 'global')!;
  assert.ok(Math.abs(settled.costEstimateUsd - 0.000002) < 1e-12, `${settled.costEstimateUsd} kept residue from the conversion`);
  assert.equal(settled.costEstimatedUsd, 0);
});
