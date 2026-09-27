import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { TokenService } from '../lib/tokens/service';
import { ReceiptJournal, type CacheReceipt, type Receipt } from '../lib/tokens/receipts';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type Completion, type ProviderAdapter } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { registerSecret } from '../lib/security/redact';

const requested = 'synthetic-requested';
const served = 'synthetic-served';
const priceOf = (hit: number, miss: number, output: number): ModelPrice => ({ provider: 'openai', effectiveAt: '2026-01-01', verifiedAt: '2026-01-01', sourceUrl: 'https://example.invalid/synthetic',
  peakWindowsUtc: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440 }],
  offPeak: { inputCacheHitPerMillion: hit / 2, inputCacheMissPerMillion: miss / 2, outputPerMillion: output / 2 },
  peak: { inputCacheHitPerMillion: hit, inputCacheMissPerMillion: miss, outputPerMillion: output } });
const start = Date.UTC(2026, 8, 27, 12);
const signal = () => new AbortController().signal;

function setup(cacheTtlMs = 0) {
  const policy: TokenPolicy = { global: 100_000, perAgent: 100_000, perModel: 100_000, perSession: 100_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs, reservationTtlMs: 100,
    models: { [requested]: { provider: 'openai', max_tokens: 64, temperature: 0, deterministic: true, thinking: { mode: 'disabled' } }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { [requested]: priceOf(2, 20, 40), [served]: priceOf(3, 30, 60), 'mock-v1': { ...priceOf(0, 0, 0), provider: 'mock' } } };
  let now = start;
  const service = new TokenService(policy, prices, { ids: () => ['a', 'b', 'c'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  const proxy = new ProviderProxy();
  // Like a real adapter, it signals the dispatch immediately before its (here synthetic) transport.
  const adapter = (answer: () => Completion): ProviderAdapter => ({ id: 'openai', model: requested, complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); return answer(); } });
  const run = (answer: () => Completion, system = 'System', input = 'Question', agent = 'a') => service.execute(proxy, adapter(answer), input, signal(), agent, system);
  return { service, proxy, run, advance: (ms: number) => { now += ms; }, now: () => now };
}
const receipts = (service: TokenService) => service.receiptSnapshot().receipts;
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('A billed call leaves a receipt with both identities, captured tariffs, its dispatch, usage, band, cost and journal', async () => {
  const f = setup();
  await f.run(() => ({ text: 'Answer', billingModel: served, usage: { prompt: 10, completion: 5, total: 15, inputBreakdown: { cacheHit: 4, cacheMiss: 6 }, reasoning: 2 } }));
  const [receipt] = receipts(f.service);
  assert.equal(receipt.kind, 'call');
  if (receipt.kind !== 'call') return;
  assert.deepEqual({ ...receipt, dispatch: null, costUsd: null, reserved: { ...receipt.reserved, costUsd: 0 } }, {
    kind: 'call', id: 1, at: start, agent: 'a', provider: 'openai', requestedModel: requested, servedModel: served, reservationId: 'reservation-1', verdict: 'billed', outcome: 'completed', mocked: false,
    requestedAt: start, priceVersionId: JSON.stringify([requested, '2026-01-01']), servedPriceVersionId: JSON.stringify([served, '2026-01-01']), dispatch: null,
    reserved: { tokens: 65, inputTokens: 1, maxOutputTokens: 64, costUsd: 0 },
    reportedUsage: { prompt: 10, completion: 5, total: 15, cacheHit: 4, cacheMiss: 6, reasoning: 2 }, band: 'peak', costUsd: null,
    journal: { models: [requested, served], from: start, to: start + 1 },
  });
  // Held at the requested peak rate with no cache hits; reconciled at the served peak rate with the reported split.
  close(receipt.reserved.costUsd, (1 * 20 + 64 * 40) / 1e6);
  close(receipt.costUsd, (4 * 3 + 6 * 30 + 5 * 60) / 1e6);
  assert.equal(receipt.dispatch?.sequence, f.proxy.dispatches.snapshot().recent[0].sequence);
  assert.equal(f.proxy.dispatches.snapshot().recent[0].correlationId, receipt.reservationId);
});

test('Unbilled, unverifiable, expired and manually reconciled calls each leave their own receipt without invented usage', async () => {
  const f = setup();
  await assert.rejects(f.run(() => { throw new ProviderFailure('rate_limited'); }), /rate_limited/);
  await assert.rejects(f.run(() => { throw new ProviderFailure('timeout'); }, 'Timed out'), /timeout/);
  // An unverifiable call pauses its agent, so the next one comes from another agent.
  await assert.rejects(f.run(() => ({ text: 'Answer', billingModel: 'synthetic-unpriced', usage: { prompt: 10, completion: 5, total: 15 } }), 'Unpriced', 'Question', 'b'), /no verified price/);
  const [unpriced, lost, limited] = receipts(f.service);
  assert.deepEqual([limited, lost, unpriced].map(item => item.kind === 'call' ? [item.verdict, item.outcome, item.servedModel, item.reportedUsage?.total ?? null, item.costUsd, item.band, item.journal] : []), [
    ['unbilled', 'rate_limited', null, null, null, null, null],
    ['unverifiable', 'timeout', null, null, null, null, null],
    ['unverifiable', 'served_model_unpriced', 'synthetic-unpriced', 15, null, null, null],
  ]);
  f.advance(100);
  const expired = receipts(f.service).filter(item => item.kind === 'expiry');
  assert.deepEqual(expired.map(item => item.kind === 'expiry' ? item.reservationId : ''), ['reservation-3', 'reservation-2']);
  for (const item of expired) if (item.kind === 'expiry') assert.ok(item.costUsd >= item.heldCostUsd && item.heldCostUsd > 0);
  const estimate = f.service.snapshot().reservations.find(item => item.id === 'reservation-2')!;
  f.service.reconcileReservation('reservation-2', 10, 5, 0.25);
  const [manual] = receipts(f.service);
  assert.deepEqual(manual, { kind: 'manual', id: manual.id, at: start + 100, agent: 'a', provider: 'openai', requestedModel: requested, servedModel: null, reservationId: 'reservation-2',
    usage: { prompt: 10, completion: 5, total: 15 }, replacedCostUsd: estimate.costUsd, costUsd: 0.25, journal: { models: [requested], from: start, to: start + 101 } });
  assert.deepEqual(receipts(f.service).map(item => item.id), [6, 5, 4, 3, 2, 1], 'newest first, one sequence');
  const mock = await f.service.execute(f.proxy, { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'Synthetic' }) }, 'Question', signal(), 'c', 'System');
  assert.equal(mock.approximate, true);
  const [mocked] = receipts(f.service);
  assert.ok(mocked.kind === 'call' && mocked.mocked && mocked.verdict === 'billed' && mocked.dispatch === null && mocked.reportedUsage !== null);
});

test('The receipt journal is bounded, newest first, reports its evictions and hands out copies', () => {
  const journal = new ReceiptJournal(3);
  const draft = (at: number): Omit<CacheReceipt, 'id'> => ({ kind: 'cache', at, agent: 'a', provider: 'openai', requestedModel: requested, servedModel: requested, savedTokens: at });
  for (let at = 1; at <= 5; at++) journal.append(draft(at));
  const snapshot = journal.snapshot();
  assert.deepEqual(snapshot.receipts.map(item => item.id), [5, 4, 3]);
  assert.deepEqual([snapshot.capacity, snapshot.total, snapshot.evicted], [3, 5, 2]);
  snapshot.receipts[0].at = -1;
  assert.equal(journal.snapshot().receipts[0].at, 5);
  assert.throws(() => new ReceiptJournal(0), /Invalid receipt capacity/);
});

test('Receipts carry no prompt, output or credential, and only a local read-only GET serves them', async () => {
  const route = await import('../app/api/receipts/route');
  assert.equal('POST' in route, false, 'receipts have no write endpoint');
  const secret = Buffer.from(randomBytes(24).toString('hex')); const unregister = registerSecret(secret);
  const previous = Reflect.get(globalThis, 'saintpetrusTokens');
  try {
    const f = setup(60_000);
    Reflect.set(globalThis, 'saintpetrusTokens', f.service);
    const marker = 'PROMPT-OR-OUTPUT-MARKER';
    const answer = (): Completion => ({ text: `${marker} ${secret.toString()}`, billingModel: requested, usage: { prompt: 10, completion: 5, total: 15 } });
    await f.run(answer, `${marker} system ${secret.toString()}`, `${marker} input`);
    const cached = await f.run(answer, `${marker} system ${secret.toString()}`, `${marker} input`);
    assert.equal(cached.cached, true);
    const response = await route.GET(new Request('http://127.0.0.1:3000/api/receipts'));
    assert.equal(response.status, 200);
    const text = await response.text();
    for (const forbidden of [marker, secret.toString(), secret.toString().slice(0, 12)]) assert.ok(!text.includes(forbidden), 'a receipt must hold numbers, identities and codes only');
    const body: { receipts: Receipt[] } = JSON.parse(text);
    assert.deepEqual(body.receipts.map(item => item.kind), ['cache', 'call']);
    assert.equal((await route.GET(new Request('http://attacker.invalid/api/receipts'))).status, 403);
    assert.equal((await route.GET(new Request('http://127.0.0.1:3000/api/receipts', { headers: { origin: 'https://example.invalid' } }))).status, 403);
  } finally { Reflect.set(globalThis, 'saintpetrusTokens', previous); unregister(); secret.fill(0); }
});
