import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenService, UnpricedServedModel } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter, RequestOptions } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { eventBus } from '../lib/events/bus';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { OpenAIAdapter } from '../lib/providers/openai';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';

const requested = 'synthetic-requested';
const served = 'synthetic-unpriced-served';
const rate: ModelPrice = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 2 },
  peak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 2 } };
const providers: ProviderAdapter['id'][] = ['openai', 'gemini', 'deepseek', 'mock'];

function setup(provider: ProviderAdapter['id']) {
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000,
    costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100,
    models: { [requested]: { provider, max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { [requested]: rate } };
  const paused: string[] = []; let now = 0;
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: id => { paused.push(id); }, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  return { service, paused, advance: (ms: number) => { now += ms; } };
}

test('A served model without a captured tariff stays unverifiable for every provider and never borrows the requested tariff', async () => {
  for (const provider of providers) {
    const { service, paused, advance } = setup(provider);
    const adapter: ProviderAdapter = { id: provider, model: requested, complete: async () => ({ text: 'Answer', billingModel: served, usage: { prompt: 10, completion: 5, total: 15 } }) };
    const before = eventBus().snapshot().cursor;
    const error = await service.execute(new ProviderProxy(), adapter, 'Question', new AbortController().signal, 'a', 'System').then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof UnpricedServedModel, provider);
    assert.deepEqual([error.requestedModel, error.servedModel], [requested, served]);
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.reservations.map(item => [item.id, item.status, item.model, item.servedModel]), [[error.reservationId, 'unverifiable', requested, served]], provider);
    // Held in all four scopes and priced at nothing: the requested tariff would have accounted a cost.
    assert.equal(snapshot.rows.filter(row => row.reserved > 0 && row.unverifiable === 1).length, 4, provider);
    assert.ok(snapshot.rows.every(row => row.costAccountedUsd === 0 && row.actual.total === 0 && row.mock.total === 0), provider);
    assert.deepEqual(paused, ['a'], provider);
    const events = eventBus().snapshot(before).events;
    assert.deepEqual(events.map(event => event.type), ['provider.rerouted', 'provider.unpriced'], provider);
    assert.doesNotMatch(events[0].payload, /reconcil/i, 'the reroute record must not claim a reconciliation that did not happen');
    for (const text of [requested, served, error.reservationId]) assert.match(events[1].payload, new RegExp(text));
    assert.throws(() => service.resume(), /unverifiable/);
    // Expiry converts the hold into conservative usage; it never frees it.
    advance(100);
    const expired = service.snapshot().rows.find(row => row.scope === 'global')!;
    assert.equal(expired.reserved, 0); assert.ok(expired.used > 0); assert.ok(expired.costUnmeasuredUsd > 0, provider);
    // Confirmed usage replaces the estimate; only real providers enter the persisted reconciliation journal.
    service.reconcileReservation(error.reservationId, 10, 5, 0.01);
    const [manual] = service.receiptSnapshot().receipts;
    assert.equal(manual.kind, 'manual');
    if (manual.kind === 'manual') assert.deepEqual(manual.journal?.models ?? null, provider === 'mock' ? null : [requested, served], provider);
  }
});

test('A priced reroute reconciles at the served tariff and its record makes no premature claim', async () => {
  const { service } = setup('deepseek');
  service.catalog.append({ model: served, price: { ...rate, provider: 'deepseek', sourceUrl: 'https://example.invalid/synthetic', offPeak: { inputCacheHitPerMillion: 3, inputCacheMissPerMillion: 3, outputPerMillion: 6 }, peak: { inputCacheHitPerMillion: 3, inputCacheMissPerMillion: 3, outputPerMillion: 6 } } });
  const adapter: ProviderAdapter = { id: 'deepseek', model: requested, complete: async () => ({ text: 'Answer', billingModel: served, usage: { prompt: 10, completion: 5, total: 15 } }) };
  const before = eventBus().snapshot().cursor;
  const result = await service.execute(new ProviderProxy(), adapter, 'Question', new AbortController().signal, 'a', 'System');
  assert.equal(result.billingModel, served);
  assert.ok(Math.abs(service.snapshot().rows.find(row => row.scope === 'global')!.costAccountedUsd - (10 * 3 + 5 * 6) / 1e6) < 1e-12);
  const reroute = eventBus().snapshot(before).events.find(event => event.type === 'provider.rerouted');
  assert.equal(reroute?.payload, `Request for ${requested} was served by ${served}.`);
});

test('OpenAI prices the snapshot its response names, plain or streamed, and fails closed without one', async () => {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/openai-served-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  const snapshot = `${requested}-2026-01-01`;
  const output = [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }];
  const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
  try {
    await store.configure('openai', secret);
    const { service } = setup('openai');
    service.catalog.append({ model: snapshot, price: { ...rate, provider: 'openai', sourceUrl: 'https://example.invalid/synthetic', offPeak: { inputCacheHitPerMillion: 5, inputCacheMissPerMillion: 5, outputPerMillion: 7 }, peak: { inputCacheHitPerMillion: 5, inputCacheMissPerMillion: 5, outputPerMillion: 7 } } });
    const result = await service.execute(new ProviderProxy(), new OpenAIAdapter(requested, store, async () => Response.json({ model: snapshot, output, usage })), 'Question', new AbortController().signal, 'a', 'System');
    assert.equal(result.billingModel, snapshot);
    assert.ok(Math.abs(service.snapshot().rows.find(row => row.scope === 'global')!.costAccountedUsd - (10 * 5 + 5 * 7) / 1e6) < 1e-12, 'priced at the snapshot, not the requested alias');
    const before = eventBus().snapshot().cursor;
    const { service: blind } = setup('openai');
    await assert.rejects(blind.execute(new ProviderProxy(), new OpenAIAdapter(requested, store, async () => Response.json({ output, usage })), 'Question', new AbortController().signal, 'a', 'System'), /upstream/);
    assert.equal(blind.snapshot().rows.find(row => row.scope === 'global')!.unverifiable, 1);
    assert.match(eventBus().snapshot(before).events.find(event => event.type === 'provider.usage_unparsed')?.payload ?? '', /output, usage/);
    const stream = (response: object) => async () => new Response(['{"type":"response.output_text.delta","delta":"OK"}', JSON.stringify({ type: 'response.completed', response })].map(data => `data: ${data}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    const options: RequestOptions = { systemPrompt: '', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 64, onText: () => {} };
    const streamed = await new OpenAIAdapter(requested, store, stream({ model: snapshot, usage })).complete('Hi', new AbortController().signal, options);
    assert.equal(streamed.billingModel, snapshot);
    await assert.rejects(new OpenAIAdapter(requested, store, stream({ usage })).complete('Hi', new AbortController().signal, options), /upstream/);
  } finally { store.disconnect('openai'); secret.fill(0); await rm(dir, { recursive: true }); }
});
