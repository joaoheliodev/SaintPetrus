import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenService } from '../lib/tokens/service';
import type { TokenPolicy, Prices } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter, type RequestOptions } from '../lib/providers/adapter';
import { POST as providerPost } from '../app/api/provider/route';
import { POST as controls } from '../app/api/tokens/route';
import { POST as graphPost } from '../app/api/graph/route';
import { runtime } from '../lib/server/runtime';
const signal = () => new AbortController().signal;
const costLimits = (limit = 1) => ({ global: limit, perAgent: limit, perModel: limit, perSession: limit });
const modelPrice = (inputCacheHitPerMillion: number, inputCacheMissPerMillion: number, outputPerMillion: number) => ({
  effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion, inputCacheMissPerMillion, outputPerMillion },
  peak: { inputCacheHitPerMillion, inputCacheMissPerMillion, outputPerMillion },
});
function fixture(limit = 1000, temperature = 0) {
  const policy: TokenPolicy = { global: limit, perAgent: limit, perModel: limit, perSession: limit, costLimitsUsd: costLimits(), cacheTtlMs: 50, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature } } };
  const prices: Prices = { date: '2026-09-06', currency: 'USD', models: { 'test-model': modelPrice(2, 2, 4), 'mock-v1': modelPrice(0, 0, 0) } };
  const paused = new Set<string>(); let now = 0, calls = 0; const ids = ['a', 'b'];
  const service = new TokenService(policy, prices, { ids: () => ids, pause: id => { paused.add(id); }, pauseAll: () => ids.forEach(id => paused.add(id)) }, fixedRatioTokenCounter(1000), () => now);
  const proxy = new ProviderProxy();
  const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async () => { calls++; return { text: 'Answer', usage: { prompt: 10, completion: 10, total: 20 } }; } };
  const run = (system = 'System', messages?: RequestOptions['messages']) => service.execute(proxy, adapter, 'Question', signal(), 'a', system, messages);
  return { service, policy, prices, proxy, adapter, run, paused, calls: () => calls, advance: (ms = 51) => { now += ms; } };
}

test('RF-06 reserves before dispatch and enforces each of four scopes', async () => {
  for (const scope of ['global','agent','model','session']) {
    const f = fixture(); const id = scope === 'global' ? 'all' : scope === 'agent' ? 'a' : scope === 'model' ? 'test-model' : f.service.sessionId;
    f.service.setLimit(scope, id, 1);
    await assert.rejects(f.run(), /reservation/); assert.equal(f.calls(), 0); assert.ok(f.paused.has('a'));
    assert.equal(f.service.snapshot().rows.find(row => row.scope === 'global')!.actual.total, 0);
  }
});

test('RF-06 reconciles actual usage, costs, 80% warning and 100% pause', async () => {
  const f = fixture(100);
  f.adapter.complete = async () => ({ text: 'Answer', usage: { prompt: 50, completion: 30, total: 80 } });
  await f.run();
  let row = f.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.deepEqual(row.actual, { prompt: 50, completion: 30, total: 80 }); assert.equal(row.reserved, 0); assert.equal(row.state, 'warning');
  assert.equal(row.costEstimateUsd, (50 * 2 + 30 * 4) / 1e6);
  await assert.rejects(f.run('Different'), /reservation/); assert.ok(f.paused.has('a'));
  const g = fixture(100); g.adapter.complete = async () => ({ text: 'Answer', usage: { prompt: 60, completion: 40, total: 100 } });
  await g.run(); row = g.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.equal(row.state, 'stopped'); assert.ok(g.paused.has('a')); await assert.rejects(g.run(), /paused/);
});

test('RT-04 caches full payload, expires by TTL, records savings and bypasses stochastic calls', async () => {
  const f = fixture(); await f.run(); assert.equal((await f.run()).cached, true); assert.equal(f.calls(), 1);
  assert.equal(f.service.snapshot().rows.find(row => row.scope === 'global')!.saved, 20);
  assert.equal(f.service.snapshot().rows.find(row => row.scope === 'global')!.actual.total, 20);
  await f.run('Other system'); assert.equal(f.calls(), 2);
  await f.run('System', [{ role: 'assistant', content: 'Question' }]); assert.equal(f.calls(), 3);
  await f.run('System', [{ role: 'user', content: 'Different' }]); assert.equal(f.calls(), 4);
  f.policy.models['test-model'].max_tokens = 65; await f.run(); assert.equal(f.calls(), 5);
  f.advance(); await f.run(); assert.equal(f.calls(), 6);
  f.policy.models['other-model'] = { ...f.policy.models['test-model'] }; f.prices.models['other-model'] = f.prices.models['test-model'];
  await f.service.execute(f.proxy, { ...f.adapter, model: 'other-model' }, 'Question', signal(), 'a', 'System'); assert.equal(f.calls(), 7);
  f.policy.models['test-model'].temperature = .5; await f.run(); await f.run(); assert.equal(f.calls(), 9);
  const g = fixture(1000, .7); await g.run(); await g.run(); assert.equal(g.calls(), 2);
});

test('RF-06 unknown real usage keeps reservation, pauses agent, never fabricates billing', async () => {
  const f = fixture(); f.adapter.complete = async () => ({ text: 'No usage returned' });
  await assert.rejects(f.run(), /usage missing/);
  const snapshot = f.service.snapshot(); const row = snapshot.rows.find(row => row.scope === 'global')!;
  assert.equal(row.actual.total, 0); assert.ok(row.reserved > 0); assert.equal(row.unresolved, 1); assert.ok(f.paused.has('a'));
  assert.deepEqual(snapshot.reservations.map(item => ({ id: item.id, createdAt: item.createdAt, expiresAt: item.expiresAt, status: item.status })), [{ id: 'reservation-1', createdAt: 0, expiresAt: 100, status: 'unresolved' }]);
  assert.throws(() => f.service.resume(), /unresolved/);
});

test('RF-06 expired unresolved reservation becomes conservative usage and remains manually reconcilable', async () => {
  const f = fixture(); f.adapter.complete = async () => { throw new ProviderFailure('timeout'); };
  await assert.rejects(f.run(), /timeout/);
  const pending = f.service.snapshot(); const reservation = pending.reservations[0];
  const before = pending.rows.map(row => row.used + row.reserved);
  const costBefore = pending.rows.map(row => row.costEstimateUsd + row.costReservedUsd);
  assert.ok(reservation); assert.equal(reservation.tokens, 65); assert.equal(reservation.costUsd, 258 / 1e6);

  f.advance(99);
  const withinTtl = f.service.snapshot();
  const affectedWithinTtl = withinTtl.rows.filter(row => row.reserved > 0);
  assert.equal(affectedWithinTtl.length, 4);
  assert.ok(affectedWithinTtl.every(row => row.used === 0 && row.reserved === reservation.tokens && row.unresolved === 1));
  assert.ok(affectedWithinTtl.every(row => row.costEstimateUsd === 0 && row.costReservedUsd === reservation.costUsd && row.costEstimatedUsd === 0));
  assert.throws(() => f.service.resume(), /unresolved/);

  f.advance(1);
  assert.doesNotThrow(() => f.service.resume());
  const expired = f.service.snapshot();
  assert.deepEqual(expired.rows.map(row => row.used + row.reserved), before);
  assert.deepEqual(expired.rows.map(row => row.costEstimateUsd + row.costReservedUsd), costBefore);
  const affectedExpired = expired.rows.filter(row => row.estimated > 0);
  assert.equal(affectedExpired.length, 4);
  assert.ok(affectedExpired.every(row => row.used === reservation.tokens && row.reserved === 0 && row.estimated === reservation.tokens && row.unresolved === 0));
  assert.ok(affectedExpired.every(row => row.costEstimateUsd === reservation.costUsd && row.costReservedUsd === 0 && row.costEstimatedUsd === reservation.costUsd));
  assert.equal(expired.reservations[0]?.status, 'estimated');

  f.service.reconcileReservation(reservation.id, 10, 5, .25);
  const reconciled = f.service.snapshot(); const global = reconciled.rows.find(row => row.scope === 'global')!;
  assert.deepEqual(global.actual, { prompt: 10, completion: 5, total: 15 });
  assert.equal(global.used, 15); assert.equal(global.estimated, 0); assert.equal(global.costEstimateUsd, .25);
  assert.equal(global.costEstimatedUsd, 0); assert.equal(global.costReservedUsd, 0);
  assert.ok(reconciled.rows.filter(row => row.actual.total === 15).every(row => row.costEstimateUsd === .25 && row.costEstimatedUsd === 0));
  assert.equal(reconciled.reservations.length, 0);
  assert.throws(() => f.service.reconcileReservation(reservation.id, 10, 5, .25), /Unknown/);
  assert.throws(() => f.service.reconcileReservation('missing', -1, 5, 0), /Invalid/);
  assert.throws(() => f.service.reconcileReservation('missing', 1, 1, Infinity), /Invalid/);

  for (const code of ['unauthorized', 'insufficient_balance', 'rate_limited'] as const) {
    const rejected = fixture(); rejected.adapter.complete = async () => { throw new ProviderFailure(code); };
    await assert.rejects(rejected.run(), new RegExp(code)); rejected.advance(1000);
    assert.ok(rejected.service.snapshot().rows.every(row => row.used === 0 && row.reserved === 0 && row.unresolved === 0 && row.costReservedUsd === 0 && row.costEstimateUsd === 0));
    assert.equal(rejected.service.snapshot().reservations.length, 0);
  }
});

test('RF-06 does not expire an in-flight reservation', async () => {
  const f = fixture(); let finish: (() => void) | undefined;
  f.adapter.complete = async () => { await new Promise<void>(resolve => { finish = resolve; }); return { text: 'Answer', usage: { prompt: 5, completion: 5, total: 10 } }; };
  const execution = f.run(); f.advance(1000);
  const active = f.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.equal(active.used, 0); assert.equal(active.reserved, 65); assert.equal(active.unresolved, 0);
  finish!(); await execution;
  const complete = f.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.equal(complete.used, 10); assert.equal(complete.reserved, 0);
});

test('RF-06 mock is labeled estimated; kill switch pauses every agent', async () => {
  const f = fixture(); const mock: ProviderAdapter = { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'Synthetic' }) };
  const result = await f.service.execute(f.proxy, mock, 'Question', signal(), 'a', 'System');
  assert.equal(result.approximate, true); const row = f.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.equal(row.actual.total, 0); assert.ok(row.mock.total > 0);
  f.service.kill(); assert.deepEqual([...f.paused].sort(), ['a','b']); await assert.rejects(f.run(), /paused/); assert.equal(f.calls(), 0);
});

test('RF-06 direct API cannot override limits, forge session or evade kill through graph reset', async () => {
  const host = globalThis as typeof globalThis & { saintpetrusTokens?: TokenService };
  const previous = host.saintpetrusTokens, oldMock = process.env.SAINTPETRUS_MOCK, oldProvider = process.env.SAINTPETRUS_PROVIDER;
  const f = fixture(1); runtime().mock.reset(); const graph = runtime().graph;
  const service = new TokenService(f.policy, f.prices, { ids: () => graph.snapshot().agents.map(a => a.id), pause: id => graph.setAgentStatus(id, 'paused'), pauseAll: () => graph.pauseAll() });
  host.saintpetrusTokens = service; process.env.SAINTPETRUS_MOCK = 'true'; process.env.SAINTPETRUS_PROVIDER = 'mock';
  const req = (path: string, data: unknown) => new Request(`http://127.0.0.1:3000/api/${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await providerPost(req('provider', { action: 'test', limit: 999999 }))).status, 400);
    assert.equal((await providerPost(req('provider', { action: 'test', sessionId: 'forged' }))).status, 400);
    assert.equal((await providerPost(req('provider', { action: 'test', agentId: 'forged' }))).status, 400);
    assert.equal((await providerPost(req('provider', { action: 'test' }))).status, 409);
    assert.equal(graph.snapshot().agents[0].status, 'paused');
    const costLimit = await controls(req('tokens', { action: 'cost-limit', scope: 'global', id: 'all', limit: .5 }));
    assert.equal(costLimit.status, 200); assert.equal((await costLimit.json()).rows.find((row: { scope: string }) => row.scope === 'global').costLimitUsd, .5);
    assert.equal((await controls(req('tokens', { action: 'cost-limit', scope: 'global', id: 'all', limit: 'invalid' }))).status, 400);
    graph.add({ name: 'Second', provider: 'Unconfigured', context: { objective: 'Test', summary: '', artifacts: [] } });
    assert.equal((await controls(req('tokens', { action: 'kill' }))).status, 200);
    assert.ok(graph.snapshot().agents.every(a => a.status === 'paused'));
    assert.equal((await graphPost(req('graph', { action: 'reset', objective: 'Bypass' }))).status, 409);
    assert.equal((await providerPost(req('provider', { action: 'test' }))).status, 409);
  } finally {
    host.saintpetrusTokens = previous; runtime().mock.reset();
    if (oldMock === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = oldMock;
    if (oldProvider === undefined) delete process.env.SAINTPETRUS_PROVIDER; else process.env.SAINTPETRUS_PROVIDER = oldProvider;
  }
});

test('RF-06 active reservations prevent concurrent budget oversubscription', async () => {
  const f = fixture(100); let finish: (() => void) | undefined;
  f.adapter.complete = async () => { await new Promise<void>(resolve => { finish = resolve; }); return { text: 'Answer', usage: { prompt: 5, completion: 5, total: 10 } }; };
  const first = f.run(); assert.ok(f.service.snapshot().rows.find(row => row.scope === 'global')!.reserved > 0);
  await assert.rejects(f.service.execute(new ProviderProxy(), f.adapter, 'Other', signal(), 'b', 'System'), /reservation/);
  finish!(); await first;
  assert.equal(f.service.snapshot().rows.find(row => row.scope === 'global')!.reserved, 0);
});

test('D2 monetary reservations prevent concurrent oversubscription in all four scopes', async () => {
  for (const scope of ['global','agent','model','session'] as const) {
    const f = fixture();
    f.policy.costLimitsUsd = costLimits(1000);
    f.prices.models['test-model'] = modelPrice(1_000_000, 1_000_000, 1_000_000);
    const id = scope === 'global' ? 'all' : scope === 'agent' ? 'a' : scope === 'model' ? 'test-model' : f.service.sessionId;
    f.service.setCostLimit(scope, id, 100);
    let finish: (() => void) | undefined; let adapterCalls = 0;
    f.adapter.complete = async () => {
      adapterCalls++;
      if (adapterCalls === 1) await new Promise<void>(resolve => { finish = resolve; });
      return { text: 'Answer', usage: { prompt: 5, completion: 5, total: 10 } };
    };
    const first = f.run();
    try {
      const target = f.service.snapshot().rows.find(row => row.scope === scope && row.id === id)!;
      assert.equal(target.costReservedUsd, 65);
      await assert.rejects(f.service.execute(new ProviderProxy(), f.adapter, 'Other', signal(), 'a', 'System'), /reservation/);
      assert.equal(adapterCalls, 1);
    } finally { finish?.(); await first; }
  }
});

test('D2 monetary usage alone drives warning and hard stop', async () => {
  const warning = fixture(1000); warning.policy.costLimitsUsd = costLimits(1000); warning.prices.models['test-model'] = modelPrice(1_000_000, 1_000_000, 1_000_000);
  warning.service.setCostLimit('global', 'all', 65);
  warning.adapter.complete = async () => ({ text: 'Answer', usage: { prompt: 26, completion: 26, total: 52 } });
  await warning.run();
  let row = warning.service.snapshot().rows.find(item => item.scope === 'global')!;
  assert.equal(row.used, 52); assert.equal(row.costEstimateUsd, 52); assert.equal(row.state, 'warning'); assert.equal(warning.paused.has('a'), false);

  const stopped = fixture(1000); stopped.policy.costLimitsUsd = costLimits(1000); stopped.prices.models['test-model'] = modelPrice(1_000_000, 1_000_000, 1_000_000);
  stopped.service.setCostLimit('global', 'all', 65);
  stopped.adapter.complete = async () => ({ text: 'Answer', usage: { prompt: 1, completion: 64, total: 65 } });
  await stopped.run();
  row = stopped.service.snapshot().rows.find(item => item.scope === 'global')!;
  assert.equal(row.costEstimateUsd, 65); assert.equal(row.state, 'stopped'); assert.ok(stopped.paused.has('a'));
});

test('D2 TokenService reconciliation passes actual cache split and both call timestamps', async () => {
  const peakPrice = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [{ weekdays: [1], startMinute: 60, endMinute: 240 }], offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 50, outputPerMillion: 10 }, peak: { inputCacheHitPerMillion: 2, inputCacheMissPerMillion: 100, outputPerMillion: 20 } };
  const executeAcross = async (requestAt: number, responseAt: number) => {
    const policy: TokenPolicy = { global: 2_000_000, perAgent: 2_000_000, perModel: 2_000_000, perSession: 2_000_000, costLimitsUsd: costLimits(1000), cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
    const prices: Prices = { date: '2026-09-07', currency: 'USD', models: { 'test-model': peakPrice } };
    let now = requestAt;
    const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
    const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async () => { now = responseAt; return { text: 'Answer', usage: { prompt: 1_000_000, completion: 0, total: 1_000_000, inputBreakdown: { cacheHit: 500_000, cacheMiss: 500_000 } } }; } };
    await service.execute(new ProviderProxy(), adapter, 'Question', signal(), 'a', 'System');
    return service.snapshot().rows.find(row => row.scope === 'global')!.costEstimateUsd;
  };
  const monday = (hour: number, minute: number) => Date.UTC(2026, 8, 7, hour, minute);
  assert.equal(await executeAcross(monday(0, 59), monday(1, 1)), 51);
  assert.equal(await executeAcross(monday(3, 59), monday(4, 1)), 51);
});

test('D2 missing model price fails closed before provider I/O or reservation', async () => {
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: costLimits(), cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
  const prices: Prices = { date: '2026-09-06', currency: 'USD', models: {} };
  let calls = 0;
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => 0);
  const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async () => { calls++; return { text: 'unexpected' }; } };
  await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Question', signal(), 'a', 'System'), /price missing/);
  assert.equal(calls, 0);
  assert.ok(service.snapshot().rows.every(row => row.reserved === 0 && row.costReservedUsd === 0));
});

test('RF-06 resume cannot erase exhaustion; model allowlist rejects before dispatch', async () => {
  const f = fixture(0); await assert.rejects(f.run(), /exhausted/); f.service.resume(); await assert.rejects(f.run(), /paused/);
  assert.equal(f.calls(), 0);
  const g = fixture(); await assert.rejects(g.service.execute(g.proxy, { ...g.adapter, model: 'not-allowed' }, 'Question', signal(), 'a', 'System'), /allowlisted/);
  assert.equal(g.calls(), 0);
});
