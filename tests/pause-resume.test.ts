import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { POST as graphPost } from '../app/api/graph/route';
import { POST as importPost } from '../app/api/graph/import/route';
import { POST as tokensPost } from '../app/api/tokens/route';
import { POST as providerPost } from '../app/api/provider/route';
import { runtime } from '../lib/server/runtime';
import { safeStringify } from '../lib/security/redact';
import { withRunMode } from './run-mode';

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
