import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenService } from '../lib/tokens/service';
import type { TokenPolicy, Prices } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter, RequestOptions } from '../lib/providers/adapter';
import { POST as providerPost } from '../app/api/provider/route';
import { POST as controls } from '../app/api/tokens/route';
import { POST as graphPost } from '../app/api/graph/route';
import { runtime } from '../lib/server/runtime';
const signal = () => new AbortController().signal;
function fixture(limit = 1000, temperature = 0) {
  const policy: TokenPolicy = { global: limit, perAgent: limit, perModel: limit, perSession: limit, cacheTtlMs: 50, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature } } };
  const prices: Prices = { date: '2026-09-06', currency: 'USD', models: { 'test-model': { inputPerMillion: 2, outputPerMillion: 4 }, 'mock-v1': { inputPerMillion: 0, outputPerMillion: 0 } } };
  const paused = new Set<string>(); let now = 0, calls = 0; const ids = ['a', 'b'];
  const service = new TokenService(policy, prices, { ids: () => ids, pause: id => { paused.add(id); }, pauseAll: () => ids.forEach(id => paused.add(id)) }, fixedRatioTokenCounter(1000), () => now);
  const proxy = new ProviderProxy();
  const adapter: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async () => { calls++; return { text: 'Answer', usage: { prompt: 10, completion: 10, total: 20 } }; } };
  const run = (system = 'System', messages?: RequestOptions['messages']) => service.execute(proxy, adapter, 'Question', signal(), 'a', system, messages);
  return { service, policy, prices, proxy, adapter, run, paused, calls: () => calls, advance: () => { now += 51; } };
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
  const row = f.service.snapshot().rows.find(row => row.scope === 'global')!;
  assert.equal(row.actual.total, 0); assert.ok(row.reserved > 0); assert.equal(row.unresolved, 1); assert.ok(f.paused.has('a'));
  assert.throws(() => f.service.resume(), /unresolved/);
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

test('RF-06 resume cannot erase exhaustion; model allowlist rejects before dispatch', async () => {
  const f = fixture(0); await assert.rejects(f.run(), /exhausted/); f.service.resume(); await assert.rejects(f.run(), /paused/);
  assert.equal(f.calls(), 0);
  const g = fixture(); await assert.rejects(g.service.execute(g.proxy, { ...g.adapter, model: 'not-allowed' }, 'Question', signal(), 'a', 'System'), /allowlisted/);
  assert.equal(g.calls(), 0);
});
