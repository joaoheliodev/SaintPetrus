import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { POST as graphPost } from '../app/api/graph/route';
import { POST as importPost } from '../app/api/graph/import/route';
import { GET as tokensGet, POST as tokensPost } from '../app/api/tokens/route';
import { POST as providerPost } from '../app/api/provider/route';
import { runtime } from '../lib/server/runtime';
import { GraphService } from '../lib/server/graph-service';
import { safeStringify } from '../lib/security/redact';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { AccountingJournal } from '../lib/tokens/accounting-journal';
import { withRunMode } from './run-mode';

// Fictitious model and tariff for the service-level tests only.
const band = { inputCacheHitPerMillion: 2, inputCacheMissPerMillion: 2, outputPerMillion: 4 };
const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'fictitious-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band } } };

// The routes and the token service wired as the server wires them (lib/tokens/runtime.ts), in memory, with the mock.
const origin = 'http://127.0.0.1:3000';
const request = (path: string, body: unknown) => new Request(`${origin}/api/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const graph = (body: unknown) => graphPost(request('graph', body));
const tokens = (body: unknown) => tokensPost(request('tokens', body));
const imported = () => importPost(request('graph/import', safeStringify(runtime().graph.snapshot())));
const statuses = () => runtime().graph.snapshot().agents.map(agent => agent.status);
const run = () => runtime().graph.snapshot().status;
async function seed() {
  runtime().mock.reset(); assert.equal((await tokens({ action: 'resume' })).status, 200);
  const writer = runtime().graph.add({ name: 'Writer', provider: 'Unconfigured', context: { objective: 'Write.', summary: '', artifacts: [] } });
  const helper = runtime().graph.add({ name: 'Helper', provider: 'Unconfigured', context: { objective: 'Help.', summary: '', artifacts: [] } }, { parentId: writer });
  return { writer, helper };
}
const until = async (check: () => boolean, label: string) => { for (let i = 0; i < 100 && !check(); i++) await delay(20); assert.ok(check(), label); };
const snapshot = async () => (await tokensGet(new Request(`${origin}/api/tokens`))).json();
// A zero limit is a full scope: the call is refused before any I/O and pauses its agent.
async function pauseByBudget(agent: string) {
  assert.equal((await tokens({ action: 'limit', scope: 'agent', id: agent, limit: 0 })).status, 200);
  assert.equal((await providerPost(request('provider', { action: 'complete', input: 'Question', agentId: agent }))).status, 409);
  assert.ok((await snapshot()).paused.includes(agent), 'paused by the refused call');
}
// Every agent this file paused gets room again, so the next test starts from a graph nothing holds.
async function release() {
  for (const agent of runtime().graph.snapshot().agents) await tokens({ action: 'limit', scope: 'agent', id: agent.id, limit: 100000 });
  await tokens({ action: 'resume' }); runtime().mock.reset();
}

const modes: ('mock' | 'real')[] = ['mock', 'real'];
for (const mode of modes) test(`R5-2 after Pause all agents and Resume eligible agents the graph can be edited, imported and reset again (${mode})`, () => withRunMode(mode, async () => {
  try {
    const { helper } = await seed();
    assert.equal((await tokens({ action: 'kill' })).status, 200);
    assert.deepEqual(statuses(), ['paused', 'paused', 'paused']);
    assert.equal(run(), 'idle', 'no demo was running, so there is no run to pause');
    assert.equal((await tokens({ action: 'resume' })).status, 200);
    assert.deepEqual([statuses(), run()], [['ready', 'ready', 'ready'], 'idle']);
    assert.equal((await graph({ action: 'budget', depth: 3, nodes: 10, cents: 100 })).status, 200, 'Graph limits');
    assert.equal((await graph({ action: 'remove-agent', id: helper })).status, 200, 'remove');
    assert.equal((await imported()).status, 200, 'import');
    assert.equal((await graph({ action: 'reset', objective: 'Start over.' })).status, 200, 'reset');
    // REAL has no configured provider here, so only the mock can quote Run once.
    if (mode === 'mock') assert.equal((await providerPost(request('provider', { action: 'quote', input: 'Hi', agentId: 'root' }))).status, 200, 'Run once');
  } finally { await tokens({ action: 'resume' }); runtime().mock.reset(); }
}));

test('R5-2 a demo that Pause all agents paused goes on after Resume eligible agents; one paused with Pause demo waits for Resume demo', async () => {
  try {
    await seed();
    assert.equal((await graph({ action: 'start', objective: 'Demo.' })).status, 200); assert.equal(run(), 'running');
    assert.equal((await tokens({ action: 'kill' })).status, 200); assert.equal(run(), 'paused');
    assert.equal((await tokens({ action: 'resume' })).status, 200);
    assert.equal(run(), 'running', 'Pause all paused it, so turning Pause all off lets it go on');
    await until(() => statuses()[0] !== 'paused', 'the demo runs its agents again');
    assert.equal((await graph({ action: 'pause' })).status, 200); assert.equal(run(), 'paused');
    assert.equal((await tokens({ action: 'kill' })).status, 200);
    assert.equal((await tokens({ action: 'resume' })).status, 200);
    assert.equal(run(), 'paused', 'paused on purpose, it stays paused');
    assert.equal((await graph({ action: 'reset', objective: 'Ends the paused demo.' })).status, 200, 'Reset graph ends a paused demo');
    assert.equal(run(), 'idle');
  } finally { await tokens({ action: 'resume' }); runtime().mock.reset(); }
});

test('R5-2 with Pause all agents on, the graph refuses what would run or replace agents, and names the way out', async () => {
  try {
    await seed();
    assert.equal((await tokens({ action: 'kill' })).status, 200);
    const refusals = [await graph({ action: 'reset', objective: 'Bypass.' }), await graph({ action: 'start', objective: 'Bypass.' }), await graph({ action: 'resume' }),
      await graph({ action: 'add', name: 'Late', objective: 'Late.', parentId: null }), await imported()];
    for (const response of refusals) {
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'Pause all agents is on, so every agent is paused. Use Resume eligible agents first.' });
    }
    assert.deepEqual(statuses(), ['paused', 'paused', 'paused'], 'nothing replaced them');
  } finally { await tokens({ action: 'resume' }); runtime().mock.reset(); }
});

test('R5-3 an agent removed or reset away takes its pause with it, so Resume eligible agents has nothing left to do', async () => {
  try {
    const { writer, helper } = await seed();
    await pauseByBudget(helper);
    assert.equal((await graph({ action: 'remove-agent', id: helper })).status, 200);
    assert.deepEqual((await snapshot()).paused, [], 'the removed agent left no pause behind');
    await pauseByBudget(writer);
    assert.equal((await graph({ action: 'reset', objective: 'Start over.' })).status, 200);
    assert.deepEqual((await snapshot()).paused, [], 'nor did the one a reset removed');
  } finally { await release(); }
});

test('R5-3 the Coordinator keeps the pause the token service holds through Reset graph and the demo', async () => {
  try {
    await seed();
    await pauseByBudget('root');
    assert.equal((await graph({ action: 'reset', objective: 'Start over.' })).status, 200);
    assert.deepEqual(statuses(), ['paused'], 'the new Coordinator shows the pause it still has');
    assert.equal((await graph({ action: 'start', objective: 'Demo.' })).status, 200);
    await delay(400);
    assert.equal(statuses()[0], 'paused', 'the demo sets it running at its first step, never over a held pause');
    await tokens({ action: 'limit', scope: 'agent', id: 'root', limit: 100000 });
    assert.equal((await tokens({ action: 'resume' })).status, 200);
    await until(() => statuses()[0] !== 'paused', 'released, the demo drives it again');
  } finally { await release(); }
});

test('R5-3 an import shows the pause the token service holds for an agent it brings back', async () => {
  try {
    const { writer } = await seed();
    await pauseByBudget(writer);
    assert.equal((await imported()).status, 200);
    assert.equal(runtime().graph.snapshot().agents.find(agent => agent.id === writer)?.status, 'paused', 'the file says Ready; the token service holds the pause');
  } finally { await release(); }
});

test('R5-3 a held pause survives the demo running out of its budget', () => {
  const service = new GraphService(); service.followPauses(id => id === 'root');
  service.setAgentStatus('root', 'paused'); service.setBudget({ maxDepth: 5, maxNodes: 12, maxCostCents: 1 });
  assert.equal(service.appendMockOutput('root', 'x', true), true);
  assert.equal(service.appendMockOutput('root', 'y', true), false, 'the demo budget is spent');
  assert.deepEqual([service.snapshot().status, service.snapshot().agents[0].status], ['blocked', 'paused']);
});

test('R5-3 an agent that leaves the graph holding a reservation keeps its pause until the reservation is settled', async () => {
  // The adapter loses contact, so the reservation stays unverifiable. No network.
  let now = 1000; const ids = ['root', 'gone'];
  const service = new TokenService(policy, prices, { ids: () => ids, pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  const adapter: ProviderAdapter = { id: 'openai', model: 'fictitious-model', complete: async () => { throw new ProviderFailure('timeout'); } };
  await assert.rejects(service.execute(new ProviderProxy(), adapter, 'Question', new AbortController().signal, 'gone', 'System'), /timeout/);
  ids.splice(1, 1);
  assert.deepEqual(service.snapshot().paused, ['gone'], 'unverifiable usage keeps it, should an import bring it back');
  now += 101;
  const [estimate] = service.snapshot().reservations; assert.equal(estimate.status, 'estimated');
  assert.deepEqual(service.snapshot().paused, ['gone'], 'so does the estimate it became');
  service.reconcileReservation(estimate.id, 10, 10, 0.001);
  assert.deepEqual(service.snapshot().paused, [], 'settled, the pause goes with the agent');
});

test('R5-3 a journal restores no pause for an agent the restored graph no longer has', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-pauses-'));
  try {
    const first = new TokenService(policy, prices, { ids: () => ['root', 'gone'], pause: () => {}, pauseAll: () => {} });
    first.restore(new AccountingJournal(directory)); first.kill();
    const second = new TokenService(policy, prices, { ids: () => ['root'], pause: () => {}, pauseAll: () => {} });
    second.restore(new AccountingJournal(directory));
    assert.deepEqual([second.holdsPause('gone'), second.holdsPause('root')], [false, true], 'dropped as it is read back, before an import could bring it back paused');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
