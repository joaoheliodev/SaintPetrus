import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphService } from '../lib/server/graph-service';
import { GraphStore } from '../lib/server/graph-store';
import { registerSecret } from '../lib/security/redact';
import { runtime } from '../lib/server/runtime';
import { POST as graphPost } from '../app/api/graph/route';

const context = (objective: string, summary = 'Summary', artifacts: string[] = []) => ({ objective, summary, artifacts });
const pad = (text: string, length: number) => text + 'x'.repeat(length - text.length);
// Synthetic key-shaped material, generated at runtime.
const keyLike = () => `sk-1${randomBytes(4).toString('hex')}`;

async function roundTrip(fill: (graph: GraphService) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-round-trip-'));
  try {
    const graph = new GraphService(); fill(graph);
    const warnings: string[] = []; const store = new GraphStore(directory, message => { warnings.push(message); }, 60_000);
    const detach = store.attach(graph); store.flush(); detach();
    const restored = new GraphService();
    const result = new GraphStore(directory).restore(restored);
    return { result, warnings, files: await readdir(directory), restored: restored.snapshot(), saved: graph.snapshot() };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('R-01 creation, edit and reset refuse credential-shaped text in every field, and say why', () => {
  const graph = new GraphService();
  const refused = /contains text shaped like a credential/;
  assert.throws(() => graph.add({ name: pad(`Agent ${keyLike()}`, 70), provider: 'Unconfigured', context: context('Plan.') }), /The name contains text shaped like a credential/);
  assert.throws(() => graph.add({ name: 'Agent', provider: 'Unconfigured', context: context(pad('Use the Bearer token here. ', 2000)) }), /The objective contains/);
  assert.throws(() => graph.add({ name: 'Agent', provider: 'Unconfigured', context: context('Plan.', `Bearer ${randomBytes(6).toString('hex')}`) }), /The summary contains/);
  assert.throws(() => graph.add({ name: 'Agent', provider: 'Unconfigured', context: context('Plan.', 'Summary', [keyLike()]) }), /The artifacts contains|The artifacts/);
  const id = graph.add({ name: 'Agent', provider: 'Unconfigured', context: context('Plan.') });
  assert.throws(() => graph.update(id, { name: `Agent ${keyLike()}`, objective: 'Plan.' }), refused);
  assert.throws(() => graph.update(id, { name: 'Agent', objective: `Plan with ${keyLike()}` }), refused);
  assert.throws(() => graph.reset(`Coordinate with Bearer ${randomBytes(6).toString('hex')}`), refused);
  assert.equal(graph.snapshot().agents.length, 2, 'nothing refused was added');
});

test('R-01 the route explains the refusal instead of "Invalid request"', async () => {
  runtime().mock.reset();
  const origin = 'http://127.0.0.1:3000';
  const response = await graphPost(new Request(`${origin}/api/graph`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', name: pad(`A ${keyLike()}`, 70), objective: 'Plan.' }) }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'The name contains text shaped like a credential (an API key or an authorization header). Remove it and try again.', 'the whole message survives the response redactor');
  runtime().mock.reset();
});

test('R-01 every field survives a save and a restart at and near its limit, and nothing the app saves is rejected', async () => {
  const cases: [string, (graph: GraphService) => void][] = [
    ['name at 70', graph => { graph.add({ name: pad('Name ', 70), provider: 'Unconfigured', context: context('Plan.') }); }],
    ['objective at 2000', graph => { graph.add({ name: 'A', provider: 'Unconfigured', context: context(pad('Objective ', 2000)) }); }],
    ['summary at 2000 and artifacts at 500', graph => { graph.add({ name: 'A', provider: 'Unconfigured', context: context('Plan.', pad('Summary ', 2000), [pad('Artifact ', 500)]) }); }],
    ['coordinator objective at 2000', graph => { graph.reset(pad('Coordinate ', 2000)); }],
    ['output at 8000 with a key near the end', graph => { const id = graph.add({ name: 'A', provider: 'Unconfigured', context: context('Plan.') }); graph.recordOutput(id, `${'y'.repeat(7990)} ${keyLike()}`); }],
    ['output over 8000 with a key at the start', graph => { const id = graph.add({ name: 'A', provider: 'Unconfigured', context: context('Plan.') }); graph.recordOutput(id, `${keyLike()} ${'z'.repeat(9000)}`); }],
    ['output with a bearer token cut in the middle', graph => { const id = graph.add({ name: 'A', provider: 'Unconfigured', context: context('Plan.') }); graph.recordOutput(id, `${'w'.repeat(7995)} Bearer ${randomBytes(8).toString('hex')}`); }],
  ];
  for (const [label, fill] of cases) {
    const { result, warnings, files, restored, saved } = await roundTrip(fill);
    assert.deepEqual(result, { restored: true }, label); assert.deepEqual(warnings, [], label);
    assert.ok(!files.some(name => name.startsWith('graph-rejected-')), label);
    assert.deepEqual(restored.agents.map(agent => [agent.name, agent.context, agent.output]), saved.agents.map(agent => [agent.name, agent.context, agent.output]), label);
    for (const agent of saved.agents) assert.ok(agent.output.length <= 8000 && !/sk-1|Bearer [0-9a-f]/.test(agent.output), `${label}: output redacted before the cut`);
  }
});

test('R-01 the store never writes what the restore would refuse: it keeps the last valid file and says so once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-round-trip-'));
  // Shorter than "[REDACTED]", so redaction lengthens the name past its limit.
  const word = randomBytes(4).toString('hex');
  try {
    const graph = new GraphService(); const warnings: string[] = [];
    const store = new GraphStore(directory, message => { warnings.push(message); }, 60_000);
    const detach = store.attach(graph);
    const id = graph.add({ name: pad(`Agent ${word} `, 70), provider: 'Unconfigured', context: context('Plan.') });
    store.flush();
    const valid = await readFile(join(directory, 'graph.json'), 'utf8');
    // A key configured later that the name happens to contain: redacted, the name would pass 70 characters.
    const unregister = registerSecret(Buffer.from(word));
    try {
      graph.move(id, { x: 5, y: 5 }); store.flush();
      graph.move(id, { x: 6, y: 6 }); store.flush();
    } finally { unregister(); detach(); }
    assert.equal(await readFile(join(directory, 'graph.json'), 'utf8'), valid, 'the last valid copy is kept');
    assert.equal(warnings.length, 1, 'one warning per reason'); assert.match(warnings[0], /^The graph was not saved, and the last valid copy is kept\. Graph file refused: agents\[1\]\.name/);
    assert.ok(!warnings[0].includes(word), 'the warning never repeats the text');
    assert.deepEqual(new GraphStore(directory).restore(new GraphService()), { restored: true });
    assert.deepEqual(await readdir(directory), ['graph.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
