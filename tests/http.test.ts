import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/graph/route';
import { runtime } from '../lib/server/runtime';
const url = 'http://127.0.0.1:3000/api/graph';
const post = (body: unknown, origin = 'http://127.0.0.1:3000') => POST(new Request(url, {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

test('HTTP graph guard rejects invalid edges even with no client validation', async () => {
  runtime().mock.reset();
  await post({ action: 'add', name: 'A', objective: 'Manual graph test' });
  const initial = await (await GET(new Request(url))).json(); const a = initial.agents[1].id;
  assert.equal((await post({ action: 'connect', source: 'root', target: a })).status, 200);
  const before = runtime().graph.snapshot();
  assert.equal((await post({ action: 'connect', source: a, target: 'root' })).status, 400);
  assert.equal((await post({ action: 'connect', source: 'root', target: a })).status, 400);
  assert.equal((await post({ action: 'connect', source: a, target: a })).status, 400);
  assert.deepEqual(runtime().graph.snapshot(), before);
});

test('edge deletion dispatch removes only the requested connection and node deletion stays unavailable', async () => {
  runtime().mock.reset();
  assert.equal((await post({ action: 'add', name: 'Child', objective: 'Deletion guard', parentId: 'root' })).status, 200);
  const connected = runtime().graph.snapshot(); const edge = connected.edges[0];
  assert.ok(edge);
  assert.equal((await post({ action: 'disconnect', id: edge.id })).status, 200);
  const disconnected = runtime().graph.snapshot();
  assert.equal(disconnected.edges.length, 0); assert.deepEqual(disconnected.agents, connected.agents);
  const beforeRejectedNodeDelete = runtime().graph.snapshot();
  assert.equal((await post({ action: 'remove-agent', id: connected.agents[1].id })).status, 400);
  assert.deepEqual(runtime().graph.snapshot(), beforeRejectedNodeDelete);
});

test('mock flag, origin and payload boundaries fail closed', async () => {
  const previous = process.env.SAINTPETRUS_MOCK; delete process.env.SAINTPETRUS_MOCK;
  try {
    const before = runtime().graph.snapshot();
    assert.equal((await post({ action: 'start', objective: 'Not enabled' })).status, 400);
    assert.equal((await post({ action: 'reset', objective: 'Cross origin' }, 'https://example.invalid')).status, 403);
    assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 403);
    assert.equal((await GET(new Request('http://attacker.invalid/api/graph'))).status, 403);
    assert.equal((await post({ action: 'add', name: 'a'.repeat(17000), objective: 'Oversized' })).status, 413);
    assert.deepEqual(runtime().graph.snapshot(), before);
  } finally { if (previous === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = previous; }
});

test('invalid JSON returns a fixed error without echoing request contents', async () => {
  const response = await POST(new Request(url, { method: 'POST', headers: {
    origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json',
  }, body: 'PRIVATE_INPUT_NOT_JSON' }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid request.' });
});


test('Host validation supports Next URL normalization and rejects rebinding', async () => {
  const good = await GET(new Request('http://localhost:3000/api/graph', { headers: { host: '127.0.0.1:3000' } }));
  assert.equal(good.status, 200);
  const bad = await GET(new Request(url, { headers: { host: 'attacker.invalid', 'x-forwarded-host': '127.0.0.1:3000' } }));
  assert.equal(bad.status, 403);
});

test('add attaches to a parent, honours a drop position and still fails closed on limits', async () => {
  runtime().mock.reset();
  const root = runtime().graph.snapshot().agents[0];
  // A subagent created from a handle drag is a delegation edge, one level deeper, server-side.
  assert.equal((await post({ action: 'add', name: 'Child', objective: 'Attached', parentId: root.id })).status, 200);
  const withChild = runtime().graph.snapshot();
  const child = withChild.agents.find(a => a.name === 'Child')!;
  assert.equal(child.parentId, root.id);
  assert.equal(child.depth, root.depth + 1);
  assert.equal(withChild.edges.filter(e => e.source === root.id && e.target === child.id && e.kind === 'delegation').length, 1);
  // An explicit drop position is used verbatim, so the node appears where the pointer released.
  assert.equal((await post({ action: 'add', name: 'Dropped', objective: 'At pointer', x: 1234.6, y: -87.2 })).status, 200);
  const dropped = runtime().graph.snapshot().agents.find(a => a.name === 'Dropped')!;
  assert.deepEqual(dropped.position, { x: 1235, y: -87 });
  assert.equal(dropped.parentId, null);
  // Automatic placement never stacks a new agent on top of an existing one.
  assert.equal((await post({ action: 'add', name: 'Sibling', objective: 'Auto placed', parentId: root.id })).status, 200);
  const agents = runtime().graph.snapshot().agents;
  for (const a of agents) for (const b of agents) if (a.id !== b.id) assert.ok(Math.abs(a.position.x - b.position.x) >= 320 || Math.abs(a.position.y - b.position.y) >= 240);
  const before = runtime().graph.snapshot();
  // Position and parent are validated on the server; a client cannot bypass any of it.
  for (const body of [
    { action: 'add', name: 'X', objective: 'Unknown parent', parentId: 'not-an-agent' },
    { action: 'add', name: 'X', objective: 'Half a position', x: 10 },
    { action: 'add', name: 'X', objective: 'Non numeric', x: '10', y: '10' },
    { action: 'add', name: 'X', objective: 'Out of range', x: 100001, y: 0 },
    { action: 'add', name: 'X', objective: 'Not finite', x: null, y: null },
    { action: 'add', name: '', objective: 'Empty name', parentId: root.id },
  ]) assert.equal((await post(body)).status, 400, JSON.stringify(body));
  assert.deepEqual(runtime().graph.snapshot(), before);
});

test('depth limit cannot be bypassed by supplying a parent from the client', async () => {
  runtime().mock.reset();
  let parent: string = runtime().graph.snapshot().agents[0].id;
  const depth = runtime().graph.snapshot().budget.maxDepth;
  for (let level = 1; level <= depth; level++) {
    assert.equal((await post({ action: 'add', name: `L${level}`, objective: 'Chain', parentId: parent })).status, 200);
    const created = runtime().graph.snapshot().agents.find(a => a.name === `L${level}`)!;
    assert.equal(created.depth, level);
    parent = created.id;
  }
  const before = runtime().graph.snapshot();
  assert.equal((await post({ action: 'add', name: 'TooDeep', objective: 'Chain', parentId: parent })).status, 400);
  assert.deepEqual(runtime().graph.snapshot(), before);
});
