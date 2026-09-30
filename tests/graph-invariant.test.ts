import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { GraphError, GraphService } from '../lib/server/graph-service';
import { parseGraphDocument } from '../lib/server/graph-document';
import { registerSecret, safeStringify } from '../lib/security/redact';
import type { Agent, Graph, Provider } from '../lib/orchestrator';

// GraphStore writes the redacted snapshot, and refuses to write whatever this parser refuses.
const savedForm = (graph: GraphService) => parseGraphDocument(safeStringify(graph.snapshot()));

// One command. Accepted, it must leave a graph the app can save; refused, it must say why and change nothing.
function run(graph: GraphService, label: string, command: () => unknown): boolean {
  const before = graph.snapshot();
  try { command(); } catch (error) {
    assert.ok(GraphError.is(error), `${label} failed with something other than a refusal: ${String(error)}`);
    assert.deepEqual(graph.snapshot(), before, `${label} was refused but changed the graph`);
    return false;
  }
  assert.doesNotThrow(() => savedForm(graph), `${label} was accepted and left a graph the app cannot save`);
  return true;
}

const context = (objective: string) => ({ objective, summary: 'Summary', artifacts: [] });
const request = (name: string, provider: Provider = 'Unconfigured') => ({ name, provider, context: context(`${name} works.`) });
// Synthetic material generated at runtime, shaped so the redactor replaces it.
const bearer = () => `Bearer ${randomBytes(8).toString('hex')}`;
const keyLike = () => `sk-1${randomBytes(6).toString('hex')}`;
// A key as a person pastes it before configuring it: plain text until it is registered.
const typedKey = (bytes: number) => randomBytes(bytes).toString('hex');
const pad = (text: string, length: number) => text + 'x'.repeat(length - text.length);

test('R4-2 every GraphService command leaves a graph the app can save, or refuses and changes nothing', () => {
  const graph = new GraphService();
  const accept = (label: string, command: () => unknown) => assert.equal(run(graph, label, command), true, `${label} should be accepted`);
  const refuse = (label: string, command: () => unknown) => assert.equal(run(graph, label, command), false, `${label} should be refused`);
  let lead = '', helper = '', deep = '', peer = '';
  accept('create', () => { lead = graph.add(request('Lead')); });
  accept('create at a drop position on the edge of the canvas', () => { peer = graph.add(request('Peer'), { position: { x: -100000, y: 100000 } }); });
  accept('subagent', () => { helper = graph.add(request('Helper'), { parentId: lead }); });
  accept('subagent spawned by its parent', () => { deep = graph.spawn(helper, request('Deep', 'Mock')); });
  accept('connect', () => graph.connect(peer, lead));
  refuse('connect into a cycle', () => graph.connect(deep, lead));
  accept('move to the edge of the canvas', () => graph.move(lead, { x: 100000, y: 100000 }));
  accept('subagent of an agent on the edge of the canvas', () => graph.add(request('Edge child'), { parentId: lead }));
  accept('another, pushed further along by the first', () => graph.add(request('Edge child 2'), { parentId: lead }));
  accept('edit', () => graph.update(helper, { name: 'Renamed helper', objective: 'Help more.' }));
  // A key typed before it was configured (R4-5), shorter than "[REDACTED]", so redacting lengthens a name at its limit.
  const typed = typedKey(4); let forget = () => {};
  try {
    accept('type a key into a name at its limit and an objective', () => graph.update(peer, { name: pad(`Peer ${typed} `, 70), objective: `Use ${typed} here.` }));
    accept('configure it, which redacts the graph', () => { forget = registerSecret(Buffer.from(typed)); graph.redactSecrets(); });
    assert.ok(!JSON.stringify(graph.snapshot()).includes(typed), 'no field keeps the key');
    accept('redact with nothing left to change', () => graph.redactSecrets());
  } finally { forget(); }
  accept('a change after the key is forgotten', () => graph.move(peer, { x: -100000, y: 100000 }));
  accept('output', () => graph.recordOutput(helper, 'An answer.'));
  // Redacted and then cut at 8000: a cut inside "Bearer [REDACTED]" leaves text the redactor would change again.
  for (let at = 7980; at < 8000; at++) accept(`output with a bearer token at ${at}`, () => graph.recordOutput(helper, `${'w'.repeat(at)} ${bearer()}`));
  accept('output at the limit', () => graph.recordOutput(lead, 'x'.repeat(8000)));
  accept('demo output after it', () => graph.appendMockOutput(lead, 'y', false));
  for (const edge of graph.snapshot().edges) {
    if (edge.kind === 'delegation') refuse('delete a delegation', () => graph.disconnect(edge.id));
    else accept('delete a context connection', () => graph.disconnect(edge.id));
  }
  refuse('remove an agent with subagents', () => graph.remove(helper));
  accept('remove a subagent', () => graph.remove(deep));
  accept('limits', () => graph.setBudget({ maxDepth: 3, maxNodes: 20, maxCostCents: 50 }));
  refuse('limits the graph already exceeds', () => graph.setBudget({ maxDepth: 1, maxNodes: 2, maxCostCents: 1 }));
  accept('demo output charged until the budget runs out', () => { for (let i = 0; i < 60; i++) graph.appendMockOutput(helper, 'z', true); });
  accept('pause one agent', () => graph.setAgentStatus(helper, 'paused'));
  accept('resume it only while it is still paused', () => graph.compareAndSetAgentStatus(helper, 'paused', 'ready'));
  // Pause all pauses the run only while a demo runs (Round 5, R5-2), so the demo is running here.
  accept('a demo run', () => graph.setRunStatus('running'));
  accept('pause all', () => graph.pauseAll());
  const exported = safeStringify(graph.snapshot());
  refuse('import while the demo is paused', () => graph.replace(parseGraphDocument(exported), 'imported'));
  accept('run status', () => graph.setRunStatus('completed'));
  accept('import', () => graph.replace(parseGraphDocument(exported), 'imported'));
  accept('reset', () => graph.reset('Start over.'));
});

test('R4-2 a seeded random walk over every command never leaves a graph the app cannot save', () => {
  // A fixed generator, so a failing step reproduces.
  let seed = 20260929;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const statuses: Agent['status'][] = ['ready', 'paused', 'running', 'completed', 'blocked'];
  const runs: Graph['status'][] = ['idle', 'running', 'paused', 'completed', 'blocked'];
  const coordinate = () => pick([0, 360, -360, 99999.6, 100000, -100000, 100001, Math.round((random() * 2 - 1) * 100000)]);
  const text = (max: number) => pick(['Plan.', ' padded ', 'x'.repeat(max), 'x'.repeat(max + 1), '', `Use ${bearer()} here.`]);
  const output = () => pick(['A short answer.', 'o'.repeat(9000), `${'w'.repeat(7980 + Math.floor(random() * 20))} ${bearer()}`, `${keyLike()} ${'k'.repeat(8000)}`]);
  // A standalone peer lets agents connect again after an import. Pause all no longer pauses an idle run (Round 5, R5-2),
  // so imports land twice as often, and with only a delegation to import no connection could be made or deleted.
  const other = new GraphService(); other.add(request('Imported lead'), { parentId: 'root' }); other.add(request('Imported peer')); other.recordOutput('root', 'Imported answer.');
  const graph = new GraphService();
  const agents = () => [...graph.snapshot().agents.map(agent => agent.id), 'missing'];
  // Half the deletions aim at context connections, which are rarer than delegations and the only ones deleted.
  const edges = () => [...graph.snapshot().edges.filter(edge => random() < 0.5 || edge.kind === 'context').map(edge => edge.id), 'missing'];
  // Keys typed into the graph, and the ones configured since; at most five stay configured at a time.
  const typedKeys: string[] = []; const forgets: (() => void)[] = [];
  const commands: [string, () => unknown][] = [
    ['create', () => graph.add({ name: text(70), provider: pick<Provider>(['Unconfigured', 'Mock']), context: { objective: text(2000), summary: pick(['', 'Summary', 'x'.repeat(2001)]), artifacts: pick([[], ['note'], ['x'.repeat(501)]]) } }, random() < 0.5 ? {} : { position: { x: coordinate(), y: coordinate() } })],
    ['subagent', () => graph.add({ name: text(70), provider: 'Unconfigured', context: context(text(2000)) }, { parentId: pick(agents()) })],
    ['spawn', () => graph.spawn(pick(agents()), { name: text(70), provider: 'Mock', context: context(text(2000)) })],
    ['connect', () => graph.connect(pick(agents()), pick(agents()))],
    ['delete connection', () => graph.disconnect(pick(edges()))],
    ['remove', () => graph.remove(pick(agents()))],
    ['edit', () => graph.update(pick(agents()), { name: text(70), objective: text(2000) })],
    ['move', () => graph.move(pick(agents()), { x: coordinate(), y: coordinate() })],
    ['limits', () => graph.setBudget({ maxDepth: pick([1, 2, 3, 5, 6]), maxNodes: pick([1, 5, 12, 50, 51]), maxCostCents: pick([1, 10, 100, 10000, 10001]) })],
    ['reset', () => graph.reset(text(2000))],
    ['output', () => graph.recordOutput(pick(agents()), output())],
    ['demo output', () => graph.appendMockOutput(pick(agents()), pick(['y', 'MOCK ', '\n']), random() < 0.5)],
    ['status', () => graph.setAgentStatus(pick(agents()), pick(statuses))],
    ['compare and set', () => graph.compareAndSetAgentStatus(pick(agents()), pick(statuses), pick(statuses))],
    ['pause all', () => graph.pauseAll()],
    ['run status', () => graph.setRunStatus(pick(runs))],
    ['import', () => graph.replace(parseGraphDocument(safeStringify(pick([graph, other]).snapshot())), 'imported')],
    ['type a key', () => { const key = typedKey(pick([4, 16])); typedKeys.push(key); graph.update(pick(agents()), { name: pick([`Agent ${key}`, pad(`A ${key} `, 70)]), objective: `Use ${key} here.` }); }],
    ['configure a key', () => { if (forgets.length >= 5) forgets.shift()?.(); forgets.push(registerSecret(Buffer.from(pick([...typedKeys, typedKey(16)])))); graph.redactSecrets(); }],
    ['forget a key', () => { forgets.splice(Math.floor(random() * forgets.length), 1)[0]?.(); }],
    ['redact', () => graph.redactSecrets()],
  ];
  const accepted = new Set<string>();
  try {
    for (let step = 0; step < 3000; step++) {
      const [label, command] = pick(commands);
      if (run(graph, `step ${step} (${label})`, command)) accepted.add(label);
    }
  } finally { forgets.forEach(forget => forget()); }
  assert.deepEqual([...accepted].sort(), commands.map(([label]) => label).sort(), 'every command was accepted at least once');
});
