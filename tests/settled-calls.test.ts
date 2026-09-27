import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderProxy } from '../lib/providers/proxy';
import { MockLLMAdapter } from '../lib/providers/mock-provider';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';

// Fictitious tariff and models for these tests only.
const price = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 }, peak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 } };
const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { 'test-model': price, 'mock-v1': { ...price, provider: 'mock' } } };
const answering = (billingModel?: string): ProviderAdapter => ({ id: 'openai', model: 'test-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); return { text: 'Answer', usage: { prompt: 10, completion: 5, total: 15 }, ...(billingModel ? { billingModel } : {}) }; } });

test('R1 a settled call stays settled when bookkeeping after it throws, for a provider and for the mock', async () => {
  for (const adapter of [answering('test-model'), new MockLLMAdapter()]) {
    // The role hook first runs after settlement, when the answer becomes an artifact; it fails once, so the failure
    // bookkeeping would otherwise run to completion on a call that was already billed.
    let roleCalls = 0;
    const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {}, role: () => { if (roleCalls++ === 0) throw new Error('Synthetic hook failure.'); return 'Agent'; } }, fixedRatioTokenCounter(1000), () => 0);
    await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Question', new AbortController().signal, 'a', 'System'), /Synthetic hook failure/);
    const snapshot = service.snapshot();
    // The four scopes this call reserved in: global, its agent, its model and the session.
    for (const row of snapshot.rows.filter(item => item.scope === 'model' ? item.id === adapter.model : item.scope !== 'agent' || item.id === 'a')) {
      assert.equal(row.reserved, 0, `${adapter.id}: released once, never twice`); assert.equal(row.unverifiable, 0, `${adapter.id}: not counted as unverifiable`);
      assert.ok(row.used > 0, `${adapter.id}: the usage stays accounted`);
    }
    assert.deepEqual(snapshot.reservations, []);
    const [receipt] = service.receiptSnapshot().receipts;
    assert.equal(receipt.kind === 'call' && receipt.verdict, 'billed', adapter.id);
  }
});

test('R1 only the mock is priced as asked: a keyed adapter that names no served model is never billed at the requested tariff', async () => {
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => 0);
  await assert.rejects(service.execute(new ProviderProxy(), answering(), 'Question', new AbortController().signal, 'a', 'System'), /upstream/);
  const snapshot = service.snapshot();
  assert.deepEqual(snapshot.reservations.map(item => item.status), ['unverifiable'], 'the hold stays, as for any unreadable answer');
  assert.ok(snapshot.rows.every(row => row.costAccountedUsd === 0 && row.used === 0), 'nothing was priced at the requested tariff');
  const [receipt] = service.receiptSnapshot().receipts;
  assert.deepEqual(receipt.kind === 'call' ? [receipt.verdict, receipt.outcome, receipt.servedModel] : [], ['unverifiable', 'upstream', null]);
});
