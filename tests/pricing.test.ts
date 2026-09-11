import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightCostUsd, reconciledCostUsd, validateModelPrice, type ModelPrice } from '../lib/tokens/pricing';

const monday = (hour: number, minute = 0) => Date.UTC(2026, 8, 7, hour, minute);
const price: ModelPrice = {
  effectiveAt: '2026-09-01',
  verifiedAt: '2026-09-07',
  peakWindowsUtc: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 }],
  offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 50, outputPerMillion: 10 },
  peak: { inputCacheHitPerMillion: 2, inputCacheMissPerMillion: 100, outputPerMillion: 20 },
};

test('D2 prices the same usage at the exact peak/off-peak 2:1 ratio in UTC', () => {
  const usage = { prompt: 1_000_000, completion: 1_000_000 };
  const peak = reconciledCostUsd(price, usage, monday(2), monday(2));
  const offPeak = reconciledCostUsd(price, usage, monday(4), monday(4));
  assert.equal(peak, 120);
  assert.equal(offPeak, 60);
  assert.equal(peak / offPeak, 2);
});

test('D2 uses the actual cache split and preserves the synthetic 50:1 miss/hit ratio', () => {
  const hit = reconciledCostUsd(price, { prompt: 1_000_000, completion: 0, inputBreakdown: { cacheHit: 1_000_000, cacheMiss: 0 } }, monday(5), monday(5));
  const miss = reconciledCostUsd(price, { prompt: 1_000_000, completion: 0, inputBreakdown: { cacheHit: 0, cacheMiss: 1_000_000 } }, monday(5), monday(5));
  assert.equal(hit, 1);
  assert.equal(miss, 50);
  assert.equal(miss / hit, 50);
});

test('D2 crossing a peak boundary uses peak even when the response arrives off-peak', () => {
  const crossing = reconciledCostUsd(price, { prompt: 1_000_000, completion: 0 }, monday(3, 59), monday(4, 1));
  assert.equal(crossing, 100);
});

test('D2 preflight always reserves peak rates with 100 percent cache miss', () => {
  assert.equal(preflightCostUsd(price, 1_000_000, 1_000_000, monday(5)), 120);
});

test('D2 price validation rejects inactive, malformed and non-worst-case configurations', () => {
  assert.throws(() => preflightCostUsd({ ...price, effectiveAt: '2026-09-08', verifiedAt: '2026-09-08' }, 1, 1, monday(5)), /not yet effective/);
  assert.equal(validateModelPrice({ ...price, verifiedAt: '2026-08-31' }), true);
  assert.equal(validateModelPrice({ ...price, verifiedAt: '2026-99-99' }), false);
  assert.equal(validateModelPrice({ ...price, peakWindowsUtc: [{ weekdays: [7], startMinute: 60, endMinute: 240 }] }), false);
  assert.equal(validateModelPrice({ ...price, offPeak: { ...price.offPeak, inputCacheHitPerMillion: 51 } }), false);
  assert.equal(validateModelPrice({ ...price, peak: { ...price.peak, outputPerMillion: 9 } }), false);
});
