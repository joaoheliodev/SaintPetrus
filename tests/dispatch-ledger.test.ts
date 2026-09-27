import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter, RequestOptions } from '../lib/providers/adapter';
import { DeepSeekAdapter } from '../lib/providers/deepseek';
import { GeminiAdapter } from '../lib/providers/gemini';
import { OpenAIAdapter } from '../lib/providers/openai';
import { MockLLMAdapter } from '../lib/providers/mock-provider';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';

const deepseekReply = JSON.parse(await readFile('tests/fixtures/deepseek-chat-completion.json', 'utf8'));
const geminiReply = JSON.parse(await readFile('tests/fixtures/gemini-generate-content.json', 'utf8'));
const openaiReply = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } };
const model = 'deepseek-test-model';
const keyed: ('openai' | 'gemini' | 'deepseek')[] = ['openai', 'gemini', 'deepseek'];
const signal = () => new AbortController().signal;
const options = (thinking: RequestOptions['thinking']): RequestOptions => ({ systemPrompt: 'System', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 64, thinking });
const rate = (extra: Partial<ModelPrice> = {}): ModelPrice => ({ effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion: 0.01, inputCacheMissPerMillion: 0.1, outputPerMillion: 0.2 },
  peak: { inputCacheHitPerMillion: 0.01, inputCacheMissPerMillion: 0.1, outputPerMillion: 0.2 }, ...extra });

async function withStore<T>(run: (store: Credentials) => Promise<T>) {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/dispatch-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  for (const provider of keyed) await store.configure(provider, secret);
  try { return await run(store); }
  finally { for (const provider of keyed) store.disconnect(provider); secret.fill(0); await rm(dir, { recursive: true }); }
}

test('Each adapter records one dispatch immediately before transport and none for a refusal it decides locally', async () => {
  await withStore(async store => {
    const proxy = new ProviderProxy();
    const seen: number[] = [];
    const counted = (reply: object): typeof fetch => async () => { seen.push(proxy.dispatches.snapshot().total); return Response.json(reply); };
    const adapters: [ProviderAdapter, RequestOptions][] = [
      [new OpenAIAdapter('gpt-test-model', store, counted(openaiReply)), options(undefined)],
      [new GeminiAdapter('gemini-test-model', store, counted(geminiReply)), options({ mode: 'disabled' })],
      [new DeepSeekAdapter(model, store, counted(deepseekReply)), options({ mode: 'disabled' })],
    ];
    for (const [index, [adapter, request]] of adapters.entries()) {
      await proxy.execute(adapter, 'Hi', signal(), request, { correlationId: `correlation-${index}` });
      assert.equal(seen[index], index + 1, `${adapter.id} must record before the request leaves`);
      assert.deepEqual(proxy.dispatches.snapshot().recent[0], { ...proxy.dispatches.snapshot().recent[0], provider: adapter.id, model: adapter.model, correlationId: `correlation-${index}` });
    }
    const total = proxy.dispatches.snapshot().total;
    // Refusals decided before any provider I/O: adapter thinking checks, proxy input checks, a pre-aborted
    // signal and the synthetic provider, which never transports anything.
    await assert.rejects(proxy.execute(adapters[1][0], 'Hi', signal(), options({ mode: 'enabled', effort: 'low' })), /invalid_request/);
    await assert.rejects(proxy.execute(adapters[2][0], 'Hi', signal(), options({ mode: 'enabled', effort: 'minimal' })), /invalid_request/);
    await assert.rejects(proxy.execute(adapters[2][0], '', signal(), options({ mode: 'disabled' })), /invalid_request/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(proxy.execute(adapters[2][0], 'Hi', aborted.signal, options({ mode: 'disabled' })), /cancelled/);
    await proxy.execute(new MockLLMAdapter(), 'Hi', signal());
    assert.equal(proxy.dispatches.snapshot().total, total);
    assert.equal(seen.length, 3);
    assert.deepEqual(proxy.dispatches.snapshot().byProvider, { openai: 1, gemini: 1, deepseek: 1 });
  });
});

test('Preflight refusals leave the upstream dispatch count unchanged; an admitted or lost call adds exactly one', async () => {
  await withStore(async store => {
    // Two minutes before midnight UTC, so a price ending at midnight cannot outlive the reservation TTL.
    const now = Date.UTC(2026, 8, 27, 23, 58);
    const policy: TokenPolicy = { global: 4096, perAgent: 4096, perModel: 4096, perSession: 4096, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 60_000, reservationTtlMs: 300_000,
      models: Object.fromEntries([model, 'deepseek-unpriced', 'deepseek-expiring'].map(id => [id, { provider: 'deepseek', max_tokens: 64, temperature: 0, deterministic: true, thinking: { mode: 'disabled' } }])) };
    // Expires within the reservation TTL of `now`, so preflight must refuse it.
    const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { [model]: rate(), 'deepseek-expiring': rate({ expiresAt: '2026-09-28' }) } };
    let transported = 0; let reply: (init?: RequestInit) => Promise<Response> = async () => Response.json(deepseekReply);
    const transport: typeof fetch = async (_url, init) => { transported++; return reply(init); };
    const proxy = new ProviderProxy(50);
    const fresh = () => new TokenService(structuredClone(policy), structuredClone(prices), { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, undefined, () => now);
    const call = (service: TokenService, input = 'Reply OK.', agent = 'a', id = model, system = 'System') => service.execute(proxy, new DeepSeekAdapter(id, store, transport), input, signal(), agent, system);
    const unchanged = async (label: string, attempt: Promise<unknown>, pattern: RegExp) => {
      const before = proxy.dispatches.snapshot().total; const calls = transported;
      await assert.rejects(attempt, pattern, label);
      assert.equal(proxy.dispatches.snapshot().total, before, `${label} must not dispatch`);
      assert.equal(transported, calls, `${label} must not reach the transport`);
    };
    await unchanged('unknown agent', call(fresh(), 'Reply OK.', 'ghost'), /Unknown agent/);
    await unchanged('model outside the allowlist', call(fresh(), 'Reply OK.', 'a', 'deepseek-unlisted'), /not allowlisted/);
    await unchanged('empty input', call(fresh(), ' '), /Invalid input/);
    await unchanged('oversized input', call(fresh(), 'x'.repeat(2001)), /Invalid input/);
    await unchanged('missing price', call(fresh(), 'Reply OK.', 'a', 'deepseek-unpriced'), /price missing/);
    await unchanged('price expiring within the reservation TTL', call(fresh(), 'Reply OK.', 'a', 'deepseek-expiring'), /expires within reservation TTL/);
    const killed = fresh(); killed.kill();
    await unchanged('global pause', call(killed), /paused/);
    const exhausted = fresh(); exhausted.setLimit('global', 'all', 0);
    await unchanged('exhausted token budget', call(exhausted), /exhausted/);
    const small = fresh(); small.setLimit('agent', 'a', 10);
    await unchanged('token reservation over budget', call(small), /Preflight reservation exceeds/);
    const cheap = fresh(); cheap.setCostLimit('session', cheap.sessionId, 1e-9);
    await unchanged('USD reservation over budget', call(cheap), /Preflight reservation exceeds/);
    // Positive controls: an admitted call and a lost call each leave exactly one trace, correlated to their reservation.
    const service = fresh();
    const before = proxy.dispatches.snapshot().total;
    await call(service);
    assert.equal(proxy.dispatches.snapshot().total, before + 1);
    assert.match(String(proxy.dispatches.snapshot().recent[0].correlationId), /^reservation-\d+$/);
    // A cache hit is answered locally: no second dispatch.
    const cached = await call(service);
    assert.equal(cached.cached, true); assert.equal(proxy.dispatches.snapshot().total, before + 1);
    // Like fetch, the stalled request only ends when the proxy timeout aborts it.
    reply = init => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    await assert.rejects(call(fresh(), 'Different question'), /timeout/);
    assert.equal(proxy.dispatches.snapshot().total, before + 2, 'a timeout after dispatch is recorded, because the request did leave');
  });
});

test('The provider status route exposes the dispatch ledger and a refused probe leaves it unchanged', async () => {
  const { GET, POST } = await import('../app/api/provider/route');
  const keys = ['saintpetrusTokens', 'saintpetrusProxy'];
  const old = new Map(keys.map(key => [key, Reflect.get(globalThis, key)]));
  const previousMock = process.env.SAINTPETRUS_MOCK, previousProvider = process.env.SAINTPETRUS_PROVIDER;
  try {
    process.env.SAINTPETRUS_MOCK = 'true'; process.env.SAINTPETRUS_PROVIDER = 'mock';
    const { runtime } = await import('../lib/server/runtime');
    const policy: TokenPolicy = { global: 0, perAgent: 0, perModel: 0, perSession: 0, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 300_000, models: { 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
    Reflect.set(globalThis, 'saintpetrusTokens', new TokenService(policy, { date: '2026-09-27', currency: 'USD', models: { 'mock-v1': rate() } }, { ids: () => runtime().graph.snapshot().agents.map(agent => agent.id), pause: () => {}, pauseAll: () => {} }));
    Reflect.set(globalThis, 'saintpetrusProxy', new ProviderProxy());
    const status = async () => (await GET(new Request('http://127.0.0.1:3000/api/provider'))).json();
    const before = await status();
    assert.deepEqual(before.dispatches, { total: 0, byProvider: {}, recent: [], capacity: 50 });
    const refused = await POST(new Request('http://127.0.0.1:3000/api/provider', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) }));
    assert.equal(refused.status, 409);
    assert.deepEqual((await status()).dispatches, before.dispatches);
  } finally {
    for (const [key, value] of old) Reflect.set(globalThis, key, value);
    if (previousMock === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = previousMock;
    if (previousProvider === undefined) delete process.env.SAINTPETRUS_PROVIDER; else process.env.SAINTPETRUS_PROVIDER = previousProvider;
  }
});
