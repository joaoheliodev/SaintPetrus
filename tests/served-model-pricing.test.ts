import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenService, UnpricedServedModel } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { eventBus } from '../lib/events/bus';

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
