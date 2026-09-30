import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphService } from '../lib/server/graph-service';
import { runtime } from '../lib/server/runtime';
import { POST as graphPost } from '../app/api/graph/route';
import { AgentInspector } from '../components/agent-inspector';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import type { Agent } from '../lib/orchestrator';

const post = (body: object) => graphPost(new Request('http://127.0.0.1:3000/api/graph', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

test('A-03 the graph removes an agent and its connections, never the coordinator, a parent or an agent in a mock run', () => {
  const graph = new GraphService();
  const a = graph.add({ name: 'A', provider: 'Unconfigured', context: { objective: 'x', summary: 'x', artifacts: [] } });
  const child = graph.add({ name: 'Child', provider: 'Unconfigured', context: { objective: 'x', summary: 'x', artifacts: [] } }, { parentId: a });
  const b = graph.add({ name: 'B', provider: 'Unconfigured', context: { objective: 'x', summary: 'x', artifacts: [] } });
  graph.connect(b, a);
  assert.throws(() => graph.remove('root'), /coordinator/);
  assert.throws(() => graph.remove('missing'), /not found/);
  assert.throws(() => graph.remove(a), /subagents first/);
  graph.remove(child); graph.remove(a);
  const after = graph.snapshot();
  assert.deepEqual(after.agents.map(agent => agent.name), ['Coordinator', 'B']);
  const gone: string[] = [a, child];
  assert.equal(after.edges.some(edge => gone.includes(edge.source) || gone.includes(edge.target)), false, 'its connections go with it');
  graph.setRunStatus('running');
  // The refusal names the demo and both ways out of it (Round 5, R5-2).
  assert.throws(() => graph.remove(b), /demo is running or paused: let it finish \(Resume demo if it is paused\) or reset the graph/);
});

test('A-03 removal is refused while the agent holds a reservation, and allowed once it is settled', async () => {
  runtime().mock.reset();
  assert.equal((await post({ action: 'add', name: 'Removable', objective: 'Removal guard' })).status, 200);
  const id = runtime().graph.snapshot().agents.find(agent => agent.name === 'Removable')!.id;
  const previous = Reflect.get(globalThis, 'saintpetrusTokens');
  let held = true;
  Reflect.set(globalThis, 'saintpetrusTokens', { isStopped: () => false, holdsReservation: (agent: string) => held && agent === id });
  try {
    const before = runtime().graph.snapshot();
    const refused = await post({ action: 'remove-agent', id });
    assert.equal(refused.status, 409); assert.match((await refused.json()).error, /Settle it in Tokens/);
    assert.deepEqual(runtime().graph.snapshot(), before, 'a refused removal changes nothing');
    held = false;
    assert.equal((await post({ action: 'remove-agent', id })).status, 200);
    assert.equal(runtime().graph.snapshot().agents.some(agent => agent.id === id), false);
  } finally { Reflect.set(globalThis, 'saintpetrusTokens', previous); runtime().mock.reset(); }
});

test('A-03 the token service holds an agent while a call is in flight, unverifiable or estimated, and keeps its rows once it is gone', async () => {
  // Fictitious tariff for this test only.
  const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 };
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
  const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { 'test-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band } } };
  let now = 0; let ids = ['a', 'b'];
  const service = new TokenService(policy, prices, { ids: () => ids, pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  let release: () => void = () => {};
  const lost: ProviderAdapter = { id: 'openai', model: 'test-model', complete: (_input, _signal, _options, onDispatch) => new Promise((_resolve, reject) => { onDispatch?.(); release = () => reject(new ProviderFailure('timeout')); }) };
  const call = service.execute(new ProviderProxy(), lost, 'Question', new AbortController().signal, 'a', 'System').catch(() => undefined);
  assert.equal(service.holdsReservation('a'), true, 'in flight'); assert.equal(service.holdsReservation('b'), false);
  release(); await call;
  assert.equal(service.holdsReservation('a'), true, 'unverifiable');
  now = 1000;
  assert.equal(service.holdsReservation('a'), true, 'estimated, awaiting reconciliation');
  service.reconcileReservation(service.snapshot().reservations[0].id, 10, 5, 0.001);
  assert.equal(service.holdsReservation('a'), false, 'settled');
  ids = ['b'];
  const row = service.snapshot().rows.find(item => item.scope === 'agent' && item.id === 'a');
  assert.ok(row && 'removed' in row && row.removed === true, 'the removed agent keeps its accounting, marked as removed');
  assert.equal(row.actual.total, 15);
});

test('A-03 the inspector offers removal with a confirmation, never for the coordinator', () => {
  const graph = new GraphService();
  graph.add({ name: 'Worker', provider: 'Unconfigured', context: { objective: 'x', summary: 'x', artifacts: [] } });
  const [root, worker] = graph.snapshot().agents;
  const render = (agent: Agent) => renderToStaticMarkup(React.createElement(AgentInspector, { agent, agents: [root, worker], pending: false, command: async () => null, connect: async () => {} }));
  assert.match(render(worker), /aria-label="Remove this agent"/);
  assert.doesNotMatch(render(root), /Remove agent/);
});
