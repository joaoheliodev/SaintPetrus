import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { graphRoutes, graphStream } from '../lib/server/graph-http';
import { GraphService } from '../lib/server/graph-service';
import { optionalEventRoutes } from '../lib/events/http';
import { registerSecret } from '../lib/security/redact';
import { startGraphSync, type GraphEventSource } from '../lib/graph-sync';
import { createGraph, type Graph, type GraphEvent } from '../lib/orchestrator';
import { useProjection } from '../lib/store';

const readFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const result = await Promise.race([reader.read(), delay(1000).then(() => { throw new Error('Timed out waiting for graph SSE.'); })]);
  return new TextDecoder().decode(result.value);
};
const graphAt = (revision: number, objective: string): Graph => {
  const graph = createGraph(); graph.revision = revision; graph.agents[0].context.objective = objective; return graph;
};

test('graph mutation reaches its always-on SSE route without polling and is redacted on the wire', async () => {
  const graph = new GraphService(); const routes = graphRoutes(graph);
  assert.ok(routes.has('/api/graph/stream')); assert.equal(optionalEventRoutes(false).size, 0);
  assert.equal(graphStream(new Request('http://127.0.0.1:3100/api/graph/stream', { headers: { Origin: 'null' } }), graph).status, 403);
  const response = routes.get('/api/graph/stream')!(new Request('http://127.0.0.1:3100/api/graph/stream'));
  const reader = response.body!.getReader(); const secret = Buffer.from(randomBytes(32).toString('hex')); const unregister = registerSecret(secret);
  try {
    await readFrame(reader);
    graph.reset(secret.toString());
    const wire = await readFrame(reader);
    assert.match(wire, /graph\.reset/); assert.match(wire, /\[REDACTED\]/); assert.ok(!wire.includes(secret.toString().slice(0, 12)));
  } finally { await reader.cancel(); unregister(); secret.fill(0); }
});

test('graph subscribers are isolated from mutation and listener failures', () => {
  const graph = new GraphService(); let received: GraphEvent | undefined;
  graph.subscribe(event => { event.snapshot.agents[0].name = 'Tampered'; throw new Error('Listener failed'); });
  graph.subscribe(event => { received = event; });
  assert.doesNotThrow(() => graph.move('root', { x: 10, y: 20 }));
  assert.equal(received?.snapshot.agents[0].name, 'Coordinator'); assert.equal(graph.snapshot().agents[0].name, 'Coordinator');
});

class FakeEventSource implements GraphEventSource {
  onopen: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  closed = false;
  open() { this.onopen?.(new Event('open')); }
  fail() { this.onerror?.(new Event('error')); }
  emit(event: GraphEvent) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) })); }
  emitRaw(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
  close() { this.closed = true; }
}

test('graph stream is primary; stream failure polls and the revision guard rejects delayed snapshots', async () => {
  const source = new FakeEventSource(); let polls = 0; let unavailable = false;
  useProjection.getState().hydrate(graphAt(0, 'initial'));
  const stop = startGraphSync({
    createSource: () => source,
    fetchSnapshot: async () => { polls++; return graphAt(3, 'fallback'); },
    apply: event => useProjection.getState().apply(event),
    unavailable: value => { unavailable = value; },
    pollMs: 1,
  });
  try {
    source.open(); await delay(5); assert.equal(polls, 0);
    source.emit({ id: 1, type: 'graph.updated', message: 'stream', snapshot: graphAt(1, 'stream') });
    assert.equal(useProjection.getState().graph.agents[0].context.objective, 'stream');
    source.fail();
    for (let i = 0; i < 20 && polls === 0; i++) await delay(1);
    assert.ok(polls > 0); assert.equal(useProjection.getState().graph.agents[0].context.objective, 'fallback');
    source.emit({ id: 2, type: 'graph.updated', message: 'delayed', snapshot: graphAt(2, 'delayed') });
    source.emit({ id: 3, type: 'graph.updated', message: 'equal', snapshot: graphAt(3, 'equal') });
    assert.equal(useProjection.getState().graph.agents[0].context.objective, 'fallback');
    source.open(); await delay(3); const afterOpen = polls; await delay(5);
    assert.equal(polls, afterOpen); assert.equal(unavailable, false);
  } finally { stop(); }
  assert.equal(source.closed, true);
});

test('graph sync rejects malformed stream events and fallback snapshots before projection', async () => {
  const source = new FakeEventSource(); let polls = 0; let unavailable = false;
  useProjection.getState().hydrate(graphAt(5, 'safe'));
  const stop = startGraphSync({
    createSource: () => source,
    fetchSnapshot: async () => { polls++; return { revision: 99, agents: [] }; },
    apply: event => useProjection.getState().apply(event),
    unavailable: value => { unavailable = value; },
    pollMs: 1,
  });
  try {
    source.open();
    source.emitRaw(JSON.stringify({ id: 99, type: 'graph.updated', message: 'malformed', snapshot: { revision: 99, agents: [] } }));
    for (let i = 0; i < 20 && polls === 0; i++) await delay(1);
    assert.ok(polls > 0); assert.equal(unavailable, true);
    assert.equal(useProjection.getState().graph.revision, 5);
    assert.equal(useProjection.getState().graph.agents[0].context.objective, 'safe');
  } finally { stop(); }
});
