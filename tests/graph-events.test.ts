import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { graphStream } from '../lib/server/graph-http';
import { GraphService } from '../lib/server/graph-service';
import { registerSecret } from '../lib/security/redact';
import { createGraph, isGraphEvent, type Graph, type GraphEvent } from '../lib/orchestrator';
import { useProjection } from '../lib/store';
import { graphLine } from '../lib/activity-log';

const context = (objective: string) => ({ objective, summary: 'Summary', artifacts: [] });

test('Q-U2 graph events say who they concern, as named then, and carry the server clock', () => {
  const graph = new GraphService(); const events: GraphEvent[] = [];
  graph.subscribe(event => { events.push(event); });
  const before = Date.now();
  const lead = graph.add({ name: 'Lead', provider: 'Unconfigured', context: context('Lead') });
  const helper = graph.add({ name: 'Helper', provider: 'Unconfigured', context: context('Help') }, { parentId: lead });
  const other = graph.add({ name: 'Other', provider: 'Unconfigured', context: context('Other') });
  graph.connect(other, lead);
  graph.update(helper, { name: 'Renamed helper', objective: 'Help' });
  graph.remove(helper);
  const edge = graph.snapshot().edges[0];
  graph.disconnect(edge.id);
  const brief = events.map(event => [event.type, event.agent?.name, event.source?.name, event.target?.name]);
  assert.deepEqual(brief, [
    ['agent.created', 'Lead', undefined, undefined],
    ['agent.created', 'Helper', 'Lead', 'Helper'],
    ['agent.created', 'Other', undefined, undefined],
    ['edge.created', undefined, 'Other', 'Lead'],
    ['agent.updated', 'Renamed helper', undefined, undefined],
    ['agent.removed', 'Renamed helper', undefined, undefined],
    ['edge.removed', undefined, 'Other', 'Lead'],
  ]);
  const removed = events.find(event => event.type === 'agent.removed')!;
  assert.equal(removed.agent?.id, helper); assert.ok(!removed.snapshot.agents.some(agent => agent.id === helper), 'the removed agent is named although it left the snapshot');
  assert.equal(events[1].agent?.name, 'Helper', 'an earlier event keeps the name the agent had then');
  for (const event of events) { assert.ok(typeof event.at === 'number' && event.at >= before && event.at <= Date.now()); assert.ok(isGraphEvent(event), event.type); }
});

test('Q-U2 the client accepts only the event contract: known keys, server time, well-formed parties', () => {
  const snapshot = createGraph();
  const valid = { id: 0, type: 'agent.created', message: 'Agent created.', snapshot, at: 1, agent: { id: 'root', name: 'Coordinator' } };
  assert.ok(isGraphEvent(valid));
  assert.ok(isGraphEvent({ ...valid, source: { id: 'a', name: 'A' }, target: { id: 'b', name: 'B' } }));
  const { at: _at, ...noTime } = valid; void _at;
  for (const [label, candidate] of [
    ['no server time', noTime], ['negative time', { ...valid, at: -1 }], ['fractional time', { ...valid, at: 1.5 }],
    ['unknown key', { ...valid, extra: true }], ['party with an extra key', { ...valid, agent: { id: 'root', name: 'x', role: 'y' } }],
    ['party without a name', { ...valid, agent: { id: 'root' } }], ['oversized id', { ...valid, target: { id: 'x'.repeat(101), name: 'x' } }],
    ['revision mismatch', { ...valid, id: 4 }],
  ] satisfies [string, unknown][]) assert.equal(isGraphEvent(candidate), false, label);
});

test('Q-U2 names on the stream are redacted like everything else', async () => {
  const graph = new GraphService();
  const secret = randomBytes(12).toString('hex');
  const id = graph.add({ name: `Agent ${secret}`, provider: 'Unconfigured', context: context('x') });
  const unregister = registerSecret(Buffer.from(secret));
  const reader = graphStream(new Request('http://127.0.0.1:3100/api/graph/stream'), graph).body!.getReader();
  const read = async () => new TextDecoder().decode((await Promise.race([reader.read(), delay(1000).then(() => { throw new Error('timeout'); })])).value);
  try {
    await read();
    graph.move(id, { x: 1, y: 2 });
    const wire = await read();
    assert.match(wire, /"agent":\{"id":"[^"]+","name":"Agent \[REDACTED\]"\}/); assert.ok(!wire.includes(secret));
  } finally { await reader.cancel(); unregister(); }
});

test('Q-U2 the server event replaces the log line of a command placeholder, never the graph', () => {
  const snapshot = createGraph(); snapshot.revision = 5; const blocked: Graph['status'] = 'blocked';
  useProjection.getState().hydrate(createGraph());
  useProjection.getState().apply({ id: 5, type: 'command.connect', message: 'Server accepted command.', snapshot });
  const server = { id: 5, type: 'edge.created', message: 'Connection created.', at: 1000, source: { id: 'a', name: 'Reader' }, target: { id: 'b', name: 'Writer' }, snapshot: { ...snapshot, status: blocked } };
  useProjection.getState().apply(server);
  const state = useProjection.getState();
  assert.deepEqual(state.events.map(event => event.type), ['edge.created'], 'one line for the revision, now the server one');
  assert.equal(state.graph.status, 'idle', 'the graph stays the one the revision guard accepted');
  useProjection.getState().apply({ ...server, id: 4, type: 'agent.moved' });
  assert.deepEqual(useProjection.getState().events.map(event => event.type), ['edge.created'], 'an older event is still ignored');
  assert.deepEqual(graphLine(state.events[0], 61_000), { key: 'graph-5', title: 'Connection created', detail: 'Reader → Writer · Connection created.', time: '1m' });
  assert.equal(graphLine({ id: 6, type: 'agent.output', message: 'Answer recorded.', at: 0, agent: { id: 'w', name: 'Writer' } }, 0).agent, 'Writer');
});
