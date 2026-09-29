import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphService } from '../lib/server/graph-service';
import { GRAPH_UNWRITABLE, GraphStore } from '../lib/server/graph-store';
import { graphRoutes } from '../lib/server/graph-http';
import { registerSecret } from '../lib/security/redact';
import { isGraphPersistence, persistenceWarning, type GraphPersistence } from '../lib/graph-persistence';
import { GraphSaveWarning } from '../components/graph-save-warning';

const context = (objective: string) => ({ objective, summary: 'Summary', artifacts: [] });
const pad = (text: string, length: number) => text + 'x'.repeat(length - text.length);
const refusedName = 'Graph file refused: agents[1].name is not valid text.';

test('R4-3 the store says it is not saving, and why, from the first refused write until the next saved one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-persistence-'));
  let clock = 1000; const warnings: string[] = [];
  const store = new GraphStore(directory, message => { warnings.push(message); }, 60_000, () => clock);
  const graph = new GraphService(); const detach = store.attach(graph);
  // Shorter than "[REDACTED]", so redaction lengthens the name past its limit.
  const word = randomBytes(4).toString('hex');
  try {
    assert.deepEqual(store.persistence(), { saving: true });
    const id = graph.add({ name: pad(`Agent ${word} `, 70), provider: 'Unconfigured', context: context('Plan.') });
    store.flush(); assert.deepEqual(store.persistence(), { saving: true });
    // R-01: a key configured after the text was written. The door could not see it; the store refuses to save.
    const unregister = registerSecret(Buffer.from(word));
    try {
      clock = 2000; graph.move(id, { x: 5, y: 5 }); store.flush();
      assert.deepEqual(store.persistence(), { saving: false, reason: refusedName, since: 2000 });
      assert.ok(!JSON.stringify(store.persistence()).includes(word), 'the state never repeats the refused text');
      clock = 3000; graph.move(id, { x: 6, y: 6 }); store.flush();
      assert.deepEqual(store.persistence(), { saving: false, reason: refusedName, since: 2000 }, 'since stays at the first refusal');
      const copy = store.persistence(); Reflect.set(copy, 'saving', true);
      assert.equal(store.persistence().saving, false, 'a reader gets a copy it cannot change');
    } finally { unregister(); }
    clock = 4000; graph.move(id, { x: 7, y: 7 }); store.flush();
    assert.deepEqual(store.persistence(), { saving: true }, 'the next saved write clears it');
    assert.equal(JSON.parse(await readFile(join(directory, 'graph.json'), 'utf8')).agents[1].position.x, 7);
    assert.equal(warnings.length, 1, 'the terminal is still told once per reason');
  } finally { detach(); await rm(directory, { recursive: true, force: true }); }
});

test('R4-3 a write that fails is reported with a fixed sentence, and the error still reaches the caller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saintpetrus-persistence-'));
  // A file where the directory should be: the write fails whoever runs the test, root included.
  const directory = join(root, 'not-a-directory'); await writeFile(directory, 'occupied');
  let clock = 5000; const store = new GraphStore(directory, () => {}, 60_000, () => clock);
  const graph = new GraphService(); const detach = store.attach(graph);
  try {
    assert.throws(() => store.flush());
    assert.deepEqual(store.persistence(), { saving: false, reason: GRAPH_UNWRITABLE, since: 5000 });
    assert.ok(!GRAPH_UNWRITABLE.includes(root), 'no path reaches the panel');
    // Refused for another reason after a failed write: the reason changes, the time saving stopped does not.
    const word = randomBytes(4).toString('hex');
    const id = graph.add({ name: pad(`Agent ${word} `, 70), provider: 'Unconfigured', context: context('Plan.') });
    const unregister = registerSecret(Buffer.from(word));
    try { clock = 6000; graph.move(id, { x: 1, y: 1 }); store.flush(); } finally { unregister(); }
    assert.deepEqual(store.persistence(), { saving: false, reason: refusedName, since: 5000 });
  } finally { detach(); await rm(root, { recursive: true, force: true }); }
});

test('R4-3 an error that is not the parser\'s own refusal reaches the panel as a fixed sentence, never its message', () => {
  const store = new GraphStore(join(tmpdir(), 'saintpetrus-never-written'), () => {}, 60_000, () => 9);
  // Not a graph: Node's own TypeError quotes what it was given, and nothing it quotes may reach the panel.
  const detach = Reflect.apply(GraphStore.prototype.attach, store, [{ snapshot: () => undefined, subscribe: () => () => {} }]);
  try {
    store.flush();
    assert.deepEqual(store.persistence(), { saving: false, reason: 'Graph file refused.', since: 9 });
  } finally { detach(); }
});

test('R4-3 GET /api/graph/persistence serves the store state, to local requests only, redacted', async () => {
  let state: GraphPersistence = { saving: true };
  const route = graphRoutes(new GraphService(), { persistence: () => state }).get('/api/graph/persistence')!;
  const local = 'http://127.0.0.1:3000/api/graph/persistence';
  assert.equal(route(new Request('http://attacker.invalid/api/graph/persistence')).status, 403);
  assert.equal(route(new Request(local, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  assert.equal(route(new Request(local, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const saving = route(new Request(local));
  assert.equal(saving.status, 200); assert.equal(saving.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await saving.json(), { saving: true });
  // The reason never carries text by construction; the response redactor runs over it anyway.
  const secret = Buffer.from(randomBytes(16).toString('hex')); const unregister = registerSecret(secret);
  try {
    state = { saving: false, reason: `Graph file refused: ${secret.toString()}`, since: 7 };
    assert.deepEqual(await route(new Request(local)).json(), { saving: false, reason: 'Graph file refused: [REDACTED]', since: 7 });
  } finally { unregister(); secret.fill(0); }
});

test('R4-3 the panel takes only the route shape and warns with its reason, persistently, until the graph is saved again', async () => {
  const refused: GraphPersistence = { saving: false, reason: refusedName, since: 0 };
  assert.ok(isGraphPersistence({ saving: true })); assert.ok(isGraphPersistence(refused));
  const malformed: unknown[] = [null, [], {}, { saving: true, reason: 'x' }, { saving: false, reason: '', since: 0 }, { saving: false, reason: 'x' },
    { ...refused, extra: 1 }, { ...refused, since: -1 }, { ...refused, since: 1.5 }, { ...refused, reason: 'x'.repeat(501) }, { saving: 'false', reason: 'x', since: 0 }];
  for (const value of malformed) assert.equal(isGraphPersistence(value), false, JSON.stringify(value));
  assert.equal(persistenceWarning(undefined, String), '');
  assert.equal(persistenceWarning({ saving: true }, String), '');
  assert.equal(persistenceWarning(refused, at => `T${at}`), `${refusedName} The last saved copy stays on disk, and changes made since T0 are lost if the server restarts. This warning stays until the graph is saved again.`);
  const markup = renderToStaticMarkup(React.createElement(GraphSaveWarning, { state: refused }));
  assert.match(markup, /^<div role="alert" class="save-warning">/);
  assert.ok(markup.includes('<strong>The graph is not being saved.</strong>') && markup.includes(refusedName));
  assert.ok(!markup.includes('<button'), 'nothing dismisses it but a save');
  assert.equal(renderToStaticMarkup(React.createElement(GraphSaveWarning, { state: { saving: true } })), '');
  assert.equal(renderToStaticMarkup(React.createElement(GraphSaveWarning, { state: undefined })), '');
  // Wired: the workspace shows the transport's state under the top bar, and the transport reads the route.
  const [workspace, transport] = await Promise.all(['components/workspace.tsx', 'lib/use-graph-transport.ts'].map(path => readFile(path, 'utf8')));
  assert.match(workspace, /<\/header>\s*<GraphSaveWarning state=\{persistence\} \/>/);
  assert.match(transport, /readGraphRoute\('\/api\/graph\/persistence', controller\.signal\)/);
});
