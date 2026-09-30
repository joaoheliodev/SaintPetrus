import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GraphService } from '../lib/server/graph-service';
import { GraphStore } from '../lib/server/graph-store';
import { registerSecret } from '../lib/security/redact';
import { EventBus } from '../lib/events/bus';
import { optionalEventRoutes } from '../lib/events/http';
import { ArtifactStore } from '../lib/preview/store';
import { optionalPreviewRoutes } from '../lib/preview/http';
import { runtime } from '../lib/server/runtime';
import type { GraphEvent } from '../lib/orchestrator';

// Fictitious and generated at runtime: 32 characters, as in the reproduction.
const fictitiousKey = () => randomBytes(16).toString('hex');
const pad = (text: string, length: number) => text + 'x'.repeat(length - text.length);

test('R4-5 a key configured after it was typed leaves memory and the saved file at once, and forgetting it cannot bring it back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-configured-key-'));
  const key = fictitiousKey(); const file = join(directory, 'graph.json');
  const graph = new GraphService(); const stopFollowing = graph.followSecrets();
  const store = new GraphStore(directory, () => {}, 20); const detach = store.attach(graph);
  const events: GraphEvent[] = []; graph.subscribe(event => { events.push(event); });
  try {
    const id = graph.add({ name: `Agent ${key}`, provider: 'Unconfigured', context: { objective: `Call the API with ${key} please.`, summary: `Holds ${key}`, artifacts: [`note ${key}`] } });
    graph.recordOutput(id, `Echoing ${key} back.`);
    await delay(100);
    assert.ok((await readFile(file, 'utf8')).includes(key), 'saved as typed, before the key was configured');
    events.length = 0;
    const unregister = registerSecret(Buffer.from(key));
    try {
      // No other change: configuring the key cleans memory, and the store saves that like any change.
      assert.ok(!JSON.stringify(graph.snapshot()).includes(key), 'memory no longer holds the key');
      assert.deepEqual(events.map(event => event.type), ['graph.redacted']);
      const agent = graph.snapshot().agents[1];
      assert.deepEqual([agent.name, agent.context.objective, agent.context.summary, agent.context.artifacts, agent.output],
        ['Agent [REDACTED]', 'Call the API with [REDACTED] please.', 'Holds [REDACTED]', ['note [REDACTED]'], 'Echoing [REDACTED] back.'], 'what the screen already showed');
      await delay(100);
      assert.ok(!(await readFile(file, 'utf8')).includes(key), 'the saved file no longer holds the key');
      assert.deepEqual(store.persistence(), { saving: true });
    } finally { unregister(); }
    // Disconnect and Forget key take the secret out of the registry: a later change must not write it back.
    graph.move(id, { x: 10, y: 10 }); await delay(100);
    const saved = await readFile(file, 'utf8');
    assert.ok(!saved.includes(key) && saved.includes('[REDACTED]'), 'forgotten, and the next change still writes no key');
    const quiet = events.length; registerSecret(Buffer.from(fictitiousKey()))();
    assert.equal(events.length, quiet, 'a key the graph does not hold changes nothing and publishes nothing');
  } finally { stopFollowing(); detach(); await rm(directory, { recursive: true, force: true }); }
});

test('R4-5 a configured key that makes a field longer when redacted is cut back into its limit, so the graph still saves', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-configured-key-'));
  // Shorter than "[REDACTED]": R-01 expected the store to refuse this one; now it is never asked to.
  const word = randomBytes(4).toString('hex'); const warnings: string[] = [];
  const graph = new GraphService(); const stopFollowing = graph.followSecrets();
  const store = new GraphStore(directory, message => { warnings.push(message); }, 20); const detach = store.attach(graph);
  try {
    graph.add({ name: pad(`Agent ${word} `, 70), provider: 'Unconfigured', context: { objective: 'Plan.', summary: 'Summary', artifacts: [] } });
    await delay(100);
    const unregister = registerSecret(Buffer.from(word));
    try {
      const { name } = graph.snapshot().agents[1];
      assert.ok(name.length <= 70 && name.startsWith('Agent [REDACTED] ') && !name.includes(word), name);
      await delay(100);
      assert.deepEqual(store.persistence(), { saving: true }); assert.deepEqual(warnings, []);
      assert.ok(!(await readFile(join(directory, 'graph.json'), 'utf8')).includes(word));
    } finally { unregister(); }
  } finally { stopFollowing(); detach(); await rm(directory, { recursive: true, force: true }); }
});

test('R4-5 the process graph follows the key registry; a graph built for a test or a file waits to be told', () => {
  runtime().mock.reset();
  const key = fictitiousKey(); const context = { objective: `Use ${key}.`, summary: '', artifacts: [] };
  runtime().graph.add({ name: 'Keyed', provider: 'Unconfigured', context });
  const standalone = new GraphService(); standalone.add({ name: 'Keyed', provider: 'Unconfigured', context });
  const unregister = registerSecret(Buffer.from(key));
  try {
    assert.ok(!JSON.stringify(runtime().graph.snapshot()).includes(key), 'the graph every route shares is cleaned');
    assert.ok(JSON.stringify(standalone.snapshot()).includes(key), 'a graph that does not follow the registry keeps its text');
    assert.equal(standalone.redactSecrets(), true); assert.ok(!JSON.stringify(standalone.snapshot()).includes(key));
    assert.equal(standalone.redactSecrets(), false, 'nothing left to change');
  } finally { unregister(); runtime().mock.reset(); }
});

test('R4-5 the feed redacts again when it sends, so an event published before a key was configured does not repeat it', async () => {
  const key = fictitiousKey(); const bus = new EventBus(5);
  bus.publish({ agent_id: 'root', role: `Agent ${key}`, type: 'agent.message', payload: `Answer with ${key}` });
  assert.ok(JSON.stringify(bus.snapshot()).includes(key), 'retained as published, before the key was configured');
  const unregister = registerSecret(Buffer.from(key));
  const response = optionalEventRoutes(true, bus).get('/api/events')!(new Request('http://127.0.0.1:3100/api/events'));
  const reader = response.body!.getReader();
  try {
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.ok(!frame.includes(key) && !frame.includes(key.slice(4, 16)), 'the old event reaches the feed without the key or a fragment of it');
    assert.match(frame, /"role":"Agent \[REDACTED\]"/); assert.match(frame, /"payload":"Answer with \[REDACTED\]"/);
  } finally { await reader.cancel(); unregister(); }
});

test('R4-6 the preview redacts again when it sends, so a version stored before a key was configured does not repeat it', async () => {
  // Run once reaches the preview too: TokenService passes every answer to observeArtifact.
  const key = fictitiousKey(); const store = new ArtifactStore();
  store.update(`agent-${key}`, `Designer ${key}`, `<html><p>Token ${key}</p></html>`); store.flush();
  assert.ok(JSON.stringify(store.snapshot()).includes(key), 'stored as answered, before the key was configured');
  const unregister = registerSecret(Buffer.from(key));
  const response = optionalPreviewRoutes(true, store).get('/api/artifacts')!(new Request('http://127.0.0.1:3100/api/artifacts'));
  const reader = response.body!.getReader();
  try {
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.ok(!frame.includes(key) && !frame.includes(key.slice(4, 16)), 'the old version reaches the preview without the key or a fragment of it');
    assert.match(frame, /"agent_id":"agent-\[REDACTED\]","role":"Designer \[REDACTED\]","source":"<html><p>Token \[REDACTED\]<\/p><\/html>"/);
  } finally { await reader.cancel(); unregister(); }
});
