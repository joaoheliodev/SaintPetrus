import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightCostUsd, reconciledCostUsd, validateModelPrice, worstCasePeakCostUsd, type ModelPrice } from '../lib/tokens/pricing';

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

test('P1 expiresAt is optional and must be a strict UTC calendar date after effectiveAt', () => {
  assert.equal(validateModelPrice(price), true);
  for (const expiresAt of ['2027-01-01', '2028-02-29']) {
    assert.equal(validateModelPrice({ ...price, expiresAt }), true, expiresAt);
  }
  for (const expiresAt of [null, undefined, 2027, '', '2027-1-1', '2027-02-29', '2027-04-31', '2027-01-01T00:00:00Z', ' 2027-01-01', price.effectiveAt, '2026-08-31']) {
    assert.equal(validateModelPrice({ ...price, expiresAt }), false, String(expiresAt));
  }
});

test('P1 pricing rejects expiration at either end of the request/response interval', () => {
  const expiring = { ...price, expiresAt: '2027-01-01' };
  const end = Date.UTC(2027, 0, 1);
  const usage = { prompt: 1_000_000, completion: 0 };
  assert.equal(reconciledCostUsd(expiring, usage, end - 2, end - 1), 50);
  assert.throws(() => preflightCostUsd(expiring, 1, 1, end), /expired/);
  assert.throws(() => reconciledCostUsd(expiring, usage, end - 1, end), /expired/);
  assert.throws(() => reconciledCostUsd(expiring, usage, end, end + 1), /expired/);
});

test('P3 provider metadata is optional but any supplied value must identify a known provider', () => {
  assert.equal(validateModelPrice(price), true);
  for (const provider of ['mock', 'openai', 'gemini', 'deepseek']) {
    assert.equal(validateModelPrice({ ...price, provider }), true, provider);
  }
  for (const provider of [undefined, null, '', 'unknown', 'OPENAI', 1, {}]) {
    assert.equal(validateModelPrice({ ...price, provider }), false, String(provider));
  }
});

test('P3 complete price metadata excludes other providers and retains priced reroute candidates', () => {
  const models: Record<string, ModelPrice> = {
    requested: { ...price, provider: 'openai' },
    'priced-reroute-only': { ...price, provider: 'openai', peak: { ...price.peak, outputPerMillion: 40 } },
    'other-provider': { ...price, provider: 'gemini', peak: { ...price.peak, outputPerMillion: 80 } },
  };
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, monday(5), 'openai'), 140);
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, monday(5), 'gemini'), 180);
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, monday(5)), 180);
});

test('P3 even a cheap unlinked price forces the global floor instead of excluding another provider', () => {
  const models: Record<string, ModelPrice> = {
    requested: { ...price, provider: 'openai', peak: { ...price.peak, outputPerMillion: 40 } },
    unlinked: price,
    'other-provider': { ...price, provider: 'gemini', peak: { ...price.peak, outputPerMillion: 80 } },
  };
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, monday(5), 'openai'), 180);
});

test('P3 unusable prices are not candidates and cannot turn provider restriction into a global floor', () => {
  const models: Record<string, ModelPrice> = {
    requested: { ...price, provider: 'openai' },
    'other-provider': { ...price, provider: 'gemini', peak: { ...price.peak, outputPerMillion: 80 } },
    expired: { ...price, expiresAt: '2026-09-07' },
    future: { ...price, effectiveAt: '2026-09-08' },
    malformed: { ...price, effectiveAt: '2026-09-31' },
  };
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, monday(5), 'openai'), 120);
});

test('P3 candidate linkage is evaluated at the original request instant with exclusive expiry', () => {
  const start = Date.UTC(2026, 8, 8);
  const end = Date.UTC(2026, 8, 9);
  const models: Record<string, ModelPrice> = {
    requested: { ...price, provider: 'openai' },
    'other-provider': { ...price, provider: 'gemini', peak: { ...price.peak, outputPerMillion: 80 } },
    unlinked: { ...price, effectiveAt: '2026-09-08', expiresAt: '2026-09-09' },
  };
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, start - 1, 'openai'), 120);
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, start, 'openai'), 180);
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, end - 1, 'openai'), 180);
  assert.equal(worstCasePeakCostUsd(models, 1_000_000, 1_000_000, end, 'openai'), 120);
});
