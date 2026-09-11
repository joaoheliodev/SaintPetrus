import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelIdError, normalizeModelId } from '../lib/providers/model-id';
import { validateConfig, type Prices, type TokenPolicy } from '../lib/tokens/config';

test('Gemini canonical and bare model IDs resolve to the same normalized allowlist key', () => {
  assert.equal(normalizeModelId('gemini', 'models/gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite');
  assert.equal(normalizeModelId('gemini', 'gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite');
  assert.throws(() => normalizeModelId('openai', 'models/gpt-5-nano'), ModelIdError);
});

test('model ID grammar rejects extra slashes, whitespace and overlong identifiers', () => {
  for (const value of ['gemini/model', ' gemini-2.5-flash-lite', 'x'.repeat(101)]) {
    assert.throws(() => normalizeModelId('gemini', value), ModelIdError);
  }
});

test('token policy accepts only normalized model keys', () => {
  const model = 'gemini-2.5-flash-lite';
  const prices: Prices = { date: '2026-09-07', currency: 'USD', models: { [model]: { effectiveAt: '2026-09-07', verifiedAt: '2026-09-07', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 0.1, inputCacheMissPerMillion: 0.1, outputPerMillion: 0.4 }, peak: { inputCacheHitPerMillion: 0.1, inputCacheMissPerMillion: 0.1, outputPerMillion: 0.4 } } } };
  const policy: TokenPolicy = { global: 1024, perAgent: 1024, perModel: 1024, perSession: 1024, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 300000, models: { [model]: { provider: 'gemini', max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  assert.doesNotThrow(() => validateConfig(policy, prices));
  const prefixed = structuredClone(policy); prefixed.models[`models/${model}`] = prefixed.models[model]; delete prefixed.models[model];
  assert.throws(() => validateConfig(prefixed, prices), /Invalid local model policy/);
  for (const malformedPolicy of [null, {}, { ...policy, models: null }, { ...policy, costLimitsUsd: null }]) {
    assert.throws(() => validateConfig(JSON.parse(JSON.stringify(malformedPolicy)), prices), /Invalid local token configuration/);
  }
  assert.throws(() => validateConfig(policy, JSON.parse('{"date":"2026-09-07","currency":"USD","models":null}')), /Invalid local token configuration/);
});
