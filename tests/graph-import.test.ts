import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphService } from '../lib/server/graph-service';
import { GRAPH_DOCUMENT_MAX_BYTES, parseGraphDocument } from '../lib/server/graph-document';
import { GraphStore } from '../lib/server/graph-store';
import { runtime } from '../lib/server/runtime';
import { registerSecret, safeStringify } from '../lib/security/redact';
import { POST as importPost } from '../app/api/graph/import/route';
import { GET as exportGet } from '../app/api/graph/export/route';

const context = (objective: string) => ({ objective, summary: 'Summary', artifacts: [] });
function sample() {
  const graph = new GraphService();
  const a = graph.add({ name: 'Writer', provider: 'Unconfigured', context: context('Write') }, { position: { x: 400, y: 200 } });
  const child = graph.add({ name: 'Checker', provider: 'Mock', context: context('Check') }, { parentId: a });
  const b = graph.add({ name: 'Reader', provider: 'Unconfigured', context: context('Read') });
  graph.connect(b, a); graph.recordOutput(child, 'Checked.'); graph.setAgentStatus(child, 'completed');
  return { graph, a, child, b };
}
// The exported file, parsed back into plain JSON for editing in a test.
const exported = (graph: GraphService): Record<string, unknown> => JSON.parse(safeStringify(graph.snapshot()));
type Fields = Record<string, unknown>;
type GraphFile = Fields & { agents: (Fields & { context: Fields; position: Fields })[]; edges: Fields[]; budget: Fields };
const edited = (edit: (file: GraphFile) => void, graph = sample().graph) => {
  const file: GraphFile = JSON.parse(safeStringify(graph.snapshot())); edit(file); return JSON.stringify(file);
};
const origin = 'http://127.0.0.1:3000';
const post = (body: string, headers: Record<string, string> = {}) => importPost(new Request(`${origin}/api/graph/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body }));

test('A-04 an exported graph imports back whole, at rest', () => {
  const { graph, child } = sample();
  const parsed = parseGraphDocument(JSON.stringify(exported(graph)));
  const original = graph.snapshot();
  assert.deepEqual(parsed.agents.map(agent => [agent.id, agent.parentId, agent.name, agent.provider, agent.depth, agent.output, agent.context, agent.position]), original.agents.map(agent => [agent.id, agent.parentId, agent.name, agent.provider, agent.depth, agent.output, agent.context, agent.position]));
  assert.deepEqual(parsed.edges, original.edges); assert.deepEqual(parsed.budget, original.budget);
  assert.equal(original.agents.find(agent => agent.id === child)?.status, 'completed');
  assert.ok(parsed.agents.every(agent => agent.status === 'ready'), 'nothing is running after an import');
  assert.equal(parsed.status, 'idle');
});

test('A-04 import refuses unknown fields at every level, including a model, and never echoes them', () => {
  const cases: [string, string][] = [
    [edited(file => { file.extra = 1; }), 'the graph has a field'],
    [edited(file => { file.agents[1].model = 'any-model'; }), 'agents[1] has a field'],
    [edited(file => { file.agents[1].apiKey = 'x'; }), 'agents[1] has a field'],
    [edited(file => { file.agents[0].context.notes = ''; }), 'agents[0].context has a field'],
    [edited(file => { file.agents[0].position.z = 0; }), 'agents[0].position has a field'],
    [edited(file => { file.edges[0].weight = 1; }), 'edges[0] has a field'],
    [edited(file => { file.budget.maxUsd = 1; }), 'budget has a field'],
    [edited(file => { delete file.agents[1].output; }), 'agents[1] is missing a field'],
  ];
  for (const [text, reason] of cases) assert.throws(() => parseGraphDocument(text), (error: Error) => error.message.includes(reason) && !/model|apiKey|notes|weight|maxUsd/.test(error.message), reason);
});

test('A-04 import refuses credential-shaped text, a foreign provider, oversize files and non-JSON', () => {
  // Synthetic key-shaped material, generated at runtime.
  const key = `sk-${randomBytes(16).toString('hex')}`;
  assert.throws(() => parseGraphDocument(edited(file => { file.agents[1].context.objective = `Use ${key}`; })), /agents\[1\]\.context\.objective contains text shaped like a credential/);
  assert.throws(() => parseGraphDocument(edited(file => { file.agents[2].output = `Bearer ${randomBytes(8).toString('hex')}`; })), /credential/);
  assert.throws(() => parseGraphDocument(edited(file => { file.agents[1].provider = 'OpenAI'; })), /provider is not Unconfigured or Mock/);
  assert.throws(() => parseGraphDocument(' '.repeat(GRAPH_DOCUMENT_MAX_BYTES + 1)), /larger than 4 MiB/);
  assert.throws(() => parseGraphDocument('{'), /not JSON/);
  assert.throws(() => parseGraphDocument('[]'), /the graph is not an object/);
});

test('A-04 import refuses a graph the canvas could not have built', () => {
  const { graph, a, child } = sample();
  const cases: [string, RegExp][] = [
    [edited(file => { file.agents[1].id = file.agents[2].id; }, graph), /duplicate/],
    [edited(file => { file.agents.reverse(); }, graph), /parentId does not name an earlier agent|first agent is not the coordinator/],
    [edited(file => { file.agents[2].depth = 3; }, graph), /depth does not match/],
    [edited(file => { file.agents[0].id = 'lead'; }, graph), /not the coordinator|not an earlier agent/],
    [edited(file => { file.agents[1].id = '../../etc'; }, graph), /not a valid identifier/],
    [edited(file => { file.edges.push({ id: 'loop', source: child, target: a, kind: 'context' }); }, graph), /cycle/],
    [edited(file => { file.edges.push({ id: 'self', source: a, target: a, kind: 'context' }); }, graph), /two different agents/],
    [edited(file => { file.edges.push({ id: 'ghost', source: a, target: 'missing', kind: 'context' }); }, graph), /two different agents/],
    [edited(file => { file.edges.push({ ...file.edges[1], id: 'again' }); }, graph), /appears twice/],
    [edited(file => { file.edges = file.edges.filter(edge => edge.kind !== 'delegation'); }, graph), /no delegation connection/],
    [edited(file => { file.edges.push({ id: 'wrong', source: 'root', target: child, kind: 'delegation' }); file.edges = file.edges.filter(edge => !(edge.kind === 'delegation' && edge.source === a)); }, graph), /another parent/],
    [edited(file => { file.budget.maxNodes = 2; }, graph), /over budget\.maxNodes/],
    [edited(file => { file.budget.maxDepth = 99; }, graph), /budget\.maxDepth is out of range/],
    [edited(file => { file.costCents = 1e6; }, graph), /costCents is out of range/],
    [edited(file => { file.agents[1].name = ' '; }, graph), /name is not valid text/],
    [edited(file => { file.agents[1].output = 'x'.repeat(8001); }, graph), /output is not valid text/],
    [edited(file => { file.agents[1].position.x = 1e9; }, graph), /position\.x is out of range/],
  ];
  for (const [text, reason] of cases) assert.throws(() => parseGraphDocument(text), reason, String(reason));
});

test('A-04 the import route replaces the graph for a local JSON request only, and refuses while accounting is unsettled or a run is active', async () => {
  const { graph } = sample();
  const file = JSON.stringify(exported(graph));
  const previous = Reflect.get(globalThis, 'saintpetrusTokens');
  let held = false;
  Reflect.set(globalThis, 'saintpetrusTokens', { isStopped: () => false, holdsReservation: () => held });
  try {
    runtime().mock.reset();
    assert.equal((await post(file, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await post(file, { 'Content-Type': 'text/plain' })).status, 403);
    held = true;
    const before = runtime().graph.snapshot();
    const refused = await post(file);
    assert.equal(refused.status, 409); assert.match((await refused.json()).error, /Settle it in Tokens/);
    assert.deepEqual(runtime().graph.snapshot(), before, 'a refused import changes nothing');
    held = false;
    const unknown = await post(edited(value => { value.agents[1].model = 'secret-model-name'; }, graph));
    assert.equal(unknown.status, 400); assert.doesNotMatch(await unknown.text(), /secret-model-name|model/);
    assert.equal((await post(' '.repeat(GRAPH_DOCUMENT_MAX_BYTES + 1))).status, 413);
    // A file from another process can carry any revision; the canvas never goes back.
    const accepted = await post(edited(value => { value.revision = 0; }, graph));
    assert.equal(accepted.status, 200);
    const now = runtime().graph.snapshot();
    assert.deepEqual(now.agents.map(agent => agent.name), ['Coordinator', 'Writer', 'Checker', 'Reader']);
    assert.ok(now.revision > before.revision, 'revisions keep moving forward');
    runtime().graph.setRunStatus('running');
    const running = await post(file);
    assert.equal(running.status, 400); assert.match((await running.json()).error, /demo is running or paused: let it finish/); // Names the way out (R5-2).
  } finally { Reflect.set(globalThis, 'saintpetrusTokens', previous); runtime().mock.reset(); }
});

test('A-04 the export still redacts, and what it writes imports back', async () => {
  runtime().mock.reset();
  // A key configured after the text was written is the one leak the door cannot see: the export still redacts it.
  const key = randomBytes(16).toString('hex');
  runtime().graph.add({ name: 'Leaky', provider: 'Unconfigured', context: context(`Pasted ${key}`) });
  const unregister = registerSecret(Buffer.from(key));
  try {
    const text = await (await exportGet(new Request(`${origin}/api/graph/export`))).text();
    assert.ok(!text.includes(key)); assert.match(text, /\[REDACTED\]/);
    assert.equal(parseGraphDocument(text).agents[1].context.objective, 'Pasted [REDACTED]');
  } finally { unregister(); runtime().mock.reset(); }
});

test('A-04 the store saves privately, redacted and coalesced, restores through the same parser and sets a bad file aside', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saintpetrus-graph-'));
  try {
    const directory = join(root, 'data');
    const { graph } = sample();
    const warnings: string[] = [];
    const store = new GraphStore(directory, message => { warnings.push(message); }, 60_000);
    const detach = store.attach(graph);
    const key = randomBytes(16).toString('hex');
    graph.update('root', { name: 'Coordinator', objective: `Remember ${key}` });
    const unregister = registerSecret(Buffer.from(key));
    assert.deepEqual(await readdir(root), [], 'nothing is written before the delay');
    try { store.flush(); } finally { unregister(); } detach();
    const saved = await readFile(join(directory, 'graph.json'), 'utf8');
    assert.ok(!saved.includes(key), 'redacted before it reaches the disk');
    if (process.platform !== 'win32') {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(directory, 'graph.json'))).mode & 0o777, 0o600);
    }
    assert.deepEqual(await readdir(directory), ['graph.json'], 'no partial file is left');
    const restored = new GraphService();
    assert.deepEqual(new GraphStore(directory).restore(restored), { restored: true });
    assert.deepEqual(restored.snapshot().agents.map(agent => agent.name), ['Coordinator', 'Writer', 'Checker', 'Reader']);
    assert.equal(restored.snapshot().agents[0].context.objective, 'Remember [REDACTED]');
    assert.ok(restored.snapshot().revision >= graph.snapshot().revision);
    await writeFile(join(directory, 'graph.json'), edited(file => { file.agents[1].model = 'x'; }, graph));
    const fresh = new GraphService();
    const result = new GraphStore(directory).restore(fresh, new Date('2026-09-27T01:02:03.004Z'));
    assert.equal(result.restored, false); assert.equal(result.rejectedAs, join(directory, 'graph-rejected-2026-09-27T01-02-03-004Z.json'));
    assert.deepEqual(await readdir(directory), ['graph-rejected-2026-09-27T01-02-03-004Z.json'], 'the bad file is kept, never overwritten');
    assert.equal(fresh.snapshot().agents.length, 1);
    assert.deepEqual(new GraphStore(join(root, 'absent')).restore(new GraphService()), { restored: false });
    assert.deepEqual(warnings, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('A-04 the server restores the graph before it listens and saves the last change on shutdown', async () => {
  const server = await readFile('scripts/server.ts', 'utf8');
  assert.ok(server.indexOf('graphStore.restore(runtime().graph)') > 0);
  assert.ok(server.indexOf('graphStore.restore(') < server.indexOf('graphRoutes(runtime().graph, graphStore)'), 'before any route reads the graph, and the routes get the store');
  assert.ok(server.indexOf('graphStore.attach(runtime().graph)') < server.indexOf('server.listen('));
  assert.match(server, /process\.on\(signal, \(\) => \{ try \{ graphStore\.flush\(\);/);
  assert.match(server, /new GraphStore\(userDataDirectory\(\)/);
  const [workspace, transport] = await Promise.all(['components/workspace.tsx', 'lib/use-graph-transport.ts'].map(path => readFile(path, 'utf8')));
  assert.match(workspace, /void confirm\(\{ message: `Import \$\{file\.name\}\? It replaces every agent[^`]*`, confirmLabel: 'Import graph', destructive: true \}\)\.then\(yes => yes \? file\.text\(\)\.then\(importGraph\) : null\)/, 'import asks first');
  assert.match(transport, /send\('\/api\/graph\/import', file, 'import'\)/);
});
