import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter, Usage } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';

// Fictitious tariff: the requested model costs 2 USD per million input tokens and 4 per million output, at peak.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 2, outputPerMillion: 4 };
const price = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band };
const policy: TokenPolicy = { global: 1_000_000, perAgent: 1_000_000, perModel: 1_000_000, perSession: 1_000_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'requested-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { 'requested-model': { ...price, provider: 'openai' } } };

// The provider answers from a model with no captured price, reporting its usage.
async function unpricedCall(usage: Usage) {
  let now = 0; const paused = new Set<string>();
  const service = new TokenService(policy, prices, { ids: () => ['a', 'b'], pause: id => { paused.add(id); }, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  const adapter: ProviderAdapter = { id: 'openai', model: 'requested-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); return { text: 'Answer', usage, billingModel: 'unpriced-model' }; } };
  await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Question', new AbortController().signal, 'a', 'System'), /no verified price/);
  const [held] = service.snapshot().reservations;
  now = 1000;
  const expired = service.receiptSnapshot().receipts.find(receipt => receipt.kind === 'expiry');
  assert.ok(expired && expired.kind === 'expiry');
  const global = service.snapshot().rows.find(row => row.scope === 'global')!;
  return { service, held, expired, global, paused };
}

test('A-10 an unpriced served model expires at the usage it reported, at least at the requested model peak, cache-miss rate', async () => {
  const { service, held, expired, global } = await unpricedCall({ prompt: 4000, completion: 64, total: 4064 });
  assert.equal(expired.tokens, 4064, 'the reported input replaces the smaller estimate');
  assert.equal(global.used, 4064); assert.equal(global.estimated, 4064); assert.equal(global.reserved, 0);
  const requestedPeak = (4000 * 2 + 64 * 4) / 1e6;
  assert.ok(Math.abs(expired.costUsd - requestedPeak) < 1e-12, `${expired.costUsd} is the requested model at peak, cache miss`);
  assert.ok(expired.costUsd > held.costUsd, 'larger than what was held');
  assert.equal(service.snapshot().reservations[0].status, 'estimated', 'still an estimate');
});

test('A-10 the conversion is never reduced below the hold, and the reasoning dimension counts on its own', async () => {
  const small = await unpricedCall({ prompt: 1, completion: 1, total: 2 });
  assert.equal(small.expired.tokens, small.held.tokens, 'a smaller report never lowers the estimate');
  assert.ok(small.expired.costUsd >= small.held.costUsd);
  const reasoning = await unpricedCall({ prompt: 1, completion: 10, total: 11, reasoning: 500 });
  assert.equal(reasoning.expired.tokens, reasoning.held.tokens - 64 + 500, 'reasoning beyond the output allowance is charged');
});

test('A-10 the agent stays paused until the estimate is reconciled by hand', async () => {
  const { service, paused } = await unpricedCall({ prompt: 4000, completion: 64, total: 4064 });
  assert.ok(paused.has('a'));
  assert.deepEqual(service.resume('a'), [], 'expiry does not release the agent');
  assert.ok(!service.resume().includes('a'), 'nor does a global resume');
  const [reservation] = service.snapshot().reservations;
  service.reconcileReservation(reservation.id, 4000, 64, 0.01);
  const global = service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.deepEqual([global.used, global.estimated], [4064, 0], 'the confirmed usage replaces the converted estimate, not the smaller hold');
  assert.deepEqual(service.resume('a'), ['a'], 'confirmed usage releases it');
});
