import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type Completion, type ProviderAdapter } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';

const model = 'synthetic-test-model';
const served = 'synthetic-rerouted-model';
const day = (date: number) => Date.UTC(2030, 0, date);
const rate = (input = 1_000_000, output = 2_000_000): ModelPrice => ({
  provider: 'openai', effectiveAt: '2030-01-01', verifiedAt: '2030-01-01', sourceUrl: 'https://example.invalid/synthetic',
  peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: input, inputCacheMissPerMillion: input, outputPerMillion: output },
  peak: { inputCacheHitPerMillion: input, inputCacheMissPerMillion: input, outputPerMillion: output },
});
function fixture() {
  let now = day(1) + 43_200_000;
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000,
    costLimitsUsd: { global: 10000, perAgent: 10000, perModel: 10000, perSession: 10000 }, cacheTtlMs: 0, reservationTtlMs: 100,
    models: { [model]: { provider: 'openai', max_tokens: 64, temperature: 0 } } };
  const prices: Prices = { date: '2030-01-01', currency: 'USD', models: { [model]: rate(), [served]: rate(3_000_000, 4_000_000) } };
  const service = new TokenService(policy, prices, { ids: () => ['synthetic-agent'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  let finish: ((result: Completion) => void) | undefined;
  const adapter: ProviderAdapter = { id: 'openai', model, complete: () => new Promise(resolve => { finish = resolve; }) };
  const run = () => service.execute(new ProviderProxy(), adapter, 'Synthetic request', new AbortController().signal, 'synthetic-agent', 'Synthetic system');
  const answer = (billingModel = model) => finish!({ text: 'Synthetic answer', billingModel, usage: { prompt: 10, completion: 5, total: 15 } });
  return { service, prices, adapter, run, answer, setTime: (value: number) => { now = value; } };
}

test('Price admin closes an open tariff without changing its other bytes and reconciles inflight usage with captured numbers', async () => {
  const f = fixture();
  const before = JSON.stringify(f.prices.models[model]);
  const inflight = f.run();
  f.service.catalog.append({ model, price: { ...rate(9_000_000, 12_000_000), effectiveAt: '2030-01-02' } });
  assert.equal(f.prices.models[model].expiresAt, '2030-01-02');
  const remaining = structuredClone(f.prices.models[model]); delete remaining.expiresAt;
  assert.equal(JSON.stringify(remaining), before);
  f.setTime(day(2)); f.answer(); await inflight;
  const rows = f.service.snapshot().rows.filter(row => row.actual.total === 15);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.costAccountedUsd === 20 && row.costReservedUsd === 0));
  const next = f.run(); f.answer(); await next;
  assert.ok(f.service.snapshot().rows.filter(row => row.actual.total === 30).every(row => row.costAccountedUsd === 170));
});

test('Price admin captures reroute-only price versions without authorizing that model for requests', async () => {
  const f = fixture(); const inflight = f.run();
  f.service.catalog.append({ model: served, price: { ...rate(9_000_000, 12_000_000), effectiveAt: '2030-01-02' } });
  f.setTime(day(2)); f.answer(served); await inflight;
  const snapshot = f.service.snapshot();
  assert.equal(snapshot.models[served], undefined);
  assert.equal(snapshot.rows.find(row => row.scope === 'model')!.id, model);
  assert.ok(snapshot.rows.filter(row => row.actual.total === 15).every(row => row.costAccountedUsd === 50));
});

test('Price admin unresolved expiry retains the captured candidate catalog and version identity', async () => {
  const f = fixture();
  f.adapter.complete = async () => { throw new ProviderFailure('timeout'); };
  await assert.rejects(f.run(), /timeout/);
  const reservation = f.service.snapshot().reservations[0];
  assert.equal(reservation.priceVersionId, JSON.stringify([model, '2030-01-01']));
  f.service.catalog.append({ model: served, price: { ...rate(9_000_000, 12_000_000), effectiveAt: '2030-01-02' } });
  f.setTime(day(2));
  const expired = f.service.snapshot();
  assert.equal(expired.reservations[0].costUsd, 259);
  assert.ok(expired.rows.filter(row => row.estimated > 0).every(row => row.costAccountedUsd === 259));
});

test('Price admin cannot reprice a served model that was unknown at dispatch by adding it during flight', async () => {
  const f = fixture(); delete f.prices.models[served];
  const inflight = f.run();
  f.service.catalog.append({ model: served, price: rate() });
  f.answer(served);
  await assert.rejects(inflight, /no verified price/);
  assert.equal(f.service.snapshot().reservations[0].status, 'unverifiable');
});

test('Price admin actual reconciliation blocks later retroactive closure of the captured tariff', async () => {
  const f = fixture(); const inflight = f.run();
  f.setTime(day(3)); f.answer(); await inflight;
  const before = JSON.stringify(f.prices);
  assert.throws(() => f.service.catalog.append({ model, price: { ...rate(), effectiveAt: '2030-01-02' } }), /reconcil/i);
  assert.equal(JSON.stringify(f.prices), before);
});

test('Price admin manual reconciliation protects the period of a previously unpriced served model', async () => {
  const f = fixture(); delete f.prices.models[served];
  const inflight = f.run(); f.answer(served);
  await assert.rejects(inflight, /no verified price/);
  f.setTime(day(2));
  const reservation = f.service.snapshot().reservations[0];
  f.service.reconcileReservation(reservation.id, 10, 5, 20);
  assert.equal(f.service.snapshot().reservations.length, 0);
  assert.throws(() => f.service.catalog.append({ model: served, price: rate() }), /reconcil/i);
});
