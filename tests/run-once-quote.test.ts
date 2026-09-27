import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { POST as providerPost, GET as providerGet } from '../app/api/provider/route';
import { runtime } from '../lib/server/runtime';
import { runQuestion } from '../components/agent-inspector';

// Fictitious tariff and limits for this test only.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 3, outputPerMillion: 7 };
const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { 'test-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band, provider: 'openai' } } };
const policy = (perAgent = 100_000): TokenPolicy => ({ global: 100_000, perAgent, perModel: 100_000, perSession: 100_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 1000, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } });

test('A-09 the quote is exactly what the call reserves, and leaves no trace', async () => {
  const paused: string[] = [];
  const service = new TokenService(policy(), prices, { ids: () => ['a'], pause: id => { paused.push(id); }, pauseAll: () => {} }, fixedRatioTokenCounter(4), () => 5000);
  let release: () => void = () => {};
  const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: (_input, _signal, _options, onDispatch) => new Promise((_resolve, reject) => { onDispatch?.(); release = () => reject(new ProviderFailure('unauthorized')); }) };
  const before = JSON.stringify(service.snapshot());
  const quote = service.quote(adapter, 'Summarize the plan.', 'a', 'System prompt');
  assert.equal(JSON.stringify(service.snapshot()), before, 'no row, reservation or pause from a quote');
  const call = service.execute(new ProviderProxy(), adapter, 'Summarize the plan.', new AbortController().signal, 'a', 'System prompt').catch(() => undefined);
  const held = service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.deepEqual({ tokens: quote.reservedTokens, cost: quote.reservedCostUsd }, { tokens: held.reserved, cost: held.costReservedUsd }, 'what the call holds in flight');
  assert.equal(quote.provider, 'openai'); assert.equal(quote.model, 'test-model'); assert.equal(quote.cached, false);
  assert.ok(quote.reservedTokens > 64 && quote.reservedCostUsd > 0);
  release(); await call;
  assert.deepEqual(paused, []);
});

test('A-09 a quote never ties an agent to a model budget, and the kill switch covers agents added later', async () => {
  const ids = ['a', 'b'];
  const small: TokenPolicy = { ...policy(), perModel: 100 };
  const service = new TokenService(small, prices, { ids: () => ids, pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(4), () => 5000);
  const spend: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); return { text: 'Done', usage: { prompt: 50, completion: 60, total: 110 }, billingModel: 'test-model' }; } };
  await service.execute(new ProviderProxy(), spend, 'Hi', new AbortController().signal, 'b', 'System');
  assert.throws(() => service.quote(spend, 'Hi', 'a', 'System'), /budget exhausted/, 'the model budget is spent');
  service.kill();
  assert.deepEqual(service.resume(), ['a'], 'the quote did not bind a to the spent model; b used it and stays paused');
  service.kill(); ids.push('later');
  assert.throws(() => service.quote(spend, 'Hi', 'later', 'System'), /Agent paused/, 'the kill switch covers agents added after it');
});

test('A-09 the quote refuses what the call would refuse, without pausing the agent', () => {
  const paused: string[] = [];
  const hooks = { ids: () => ['a'], pause: (id: string) => { paused.push(id); }, pauseAll: () => {} };
  const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async () => { throw new Error('never called'); } };
  const tight = new TokenService(policy(70), prices, hooks, fixedRatioTokenCounter(4));
  assert.throws(() => tight.quote(adapter, 'A question that is long enough to pass the agent limit.', 'a', 'System'), /Preflight reservation exceeds token or monetary budget/);
  const service = new TokenService(policy(), prices, hooks, fixedRatioTokenCounter(4));
  assert.throws(() => service.quote(adapter, ' ', 'a', 'System'), /Invalid input/);
  assert.throws(() => service.quote(adapter, 'Hi', 'ghost', 'System'), /Unknown agent/);
  assert.throws(() => service.quote({ ...adapter, model: 'other-model' }, 'Hi', 'a', 'System'), /not allowlisted/);
  service.kill();
  assert.throws(() => service.quote(adapter, 'Hi', 'a', 'System'), /Agent paused/);
  assert.deepEqual(paused, [], 'a quote never pauses anyone');
});

test('A-09 the provider route quotes Run once without sending anything', async () => {
  runtime().mock.reset();
  const origin = 'http://127.0.0.1:3000';
  const post = (body: object) => providerPost(new Request(`${origin}/api/provider`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const dispatched = async () => (await (await providerGet(new Request(`${origin}/api/provider`))).json()).dispatches.total;
  const sent = await dispatched();
  const response = await post({ action: 'quote', input: 'Say something short.', agentId: 'root' });
  assert.equal(response.status, 200);
  const { quote } = await response.json();
  assert.equal(quote.provider, 'mock'); assert.equal(typeof quote.reservedTokens, 'number'); assert.equal(typeof quote.reservedCostUsd, 'number');
  assert.equal(await dispatched(), sent, 'a quote never reaches the proxy');
  assert.equal((await post({ action: 'quote', input: 'Hi', agentId: 'root', model: 'x' })).status, 400);
  assert.equal((await post({ action: 'quote', input: ' ', agentId: 'root' })).status, 409);
});

test('A-09 Run once asks first with the quoted maximum', async () => {
  assert.equal(runQuestion({ provider: 'openai', model: 'test-model', cached: false, reservedTokens: 120, reservedCostUsd: 0.000456 }), 'Send one call to test-model? It reserves 120 tokens, at most $0.000456 before sending. What the provider does not use is released when its usage is confirmed.');
  assert.match(runQuestion({ provider: 'mock', model: 'mock-v1', cached: false, reservedTokens: 80, reservedCostUsd: 0 }), /reserves 80 tokens, the mock is free/);
  assert.match(runQuestion({ provider: 'openai', model: 'test-model', cached: true, reservedTokens: 0, reservedCostUsd: 0 }), /nothing is reserved/);
  assert.match(runQuestion(null), /did not say how much/);
  const inspector = await readFile('components/agent-inspector.tsx', 'utf8');
  const quote = inspector.indexOf("action: 'quote'"), ask = inspector.indexOf('window.confirm(runQuestion('), send = inspector.indexOf("action: 'complete'");
  assert.ok(quote > 0 && quote < ask && ask < send, 'quote, then ask, then send');
});
