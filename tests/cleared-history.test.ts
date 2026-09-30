import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { GraphService } from '../lib/server/graph-service';
import { registerSecret } from '../lib/security/redact';
import { EventBus } from '../lib/events/bus';
import { createGraph, type Graph, type GraphEvent } from '../lib/orchestrator';
import { useProjection, type ReceivedEvent } from '../lib/store';
import { graphLine } from '../lib/activity-log';
import { activityLimit, hiddenAfterWindow, hiddenWhenCleared, historyAfter, historyWithExchange, shownFeedLines, type ReceivedHistory } from '../lib/cleared-history';
import type { RunExchange } from '../lib/run-exchange';
import { FeedLines, feedAfterWindow, followClearings, type FeedState } from '../components/event-feed';

// Fictitious and generated at runtime.
const fictitiousKey = () => randomBytes(16).toString('hex');
const exchange = (text: string): RunExchange => ({ message: text, text, model: 'mock', mocked: true, tokens: 1, latencyMs: 1 });
const line = (id: number, type = 'agent.updated', message = 'Agent updated.'): ReceivedEvent => ({ id, type, message, at: 0 });
const redacted = (id: number) => line(id, 'graph.redacted', 'A configured key was removed from the graph.');

test('R4-6 a configured key discards every Activity line and Run exchange received before it, and its line says why', () => {
  const key = fictitiousKey();
  const held: ReceivedHistory = { events: [line(2, 'agent.updated', `Renamed to ${key}`), line(1)], exchanges: { root: exchange(`Use ${key}`) }, clearings: 0 };
  const after = historyAfter(held, redacted(3));
  assert.deepEqual(after, { events: [redacted(3)], exchanges: {}, clearings: 1 });
  assert.ok(!JSON.stringify(after).includes(key), 'nothing received before the event is kept');
  assert.equal(graphLine(redacted(3), 0).title, 'Earlier activity cleared because a key was configured');
  const next = historyAfter(after, line(4));
  assert.deepEqual([next.events.map(event => event.id), next.clearings], [[4, 3], 1], 'the log goes on from the clearing');
});

test('R4-6 any other event keeps what the panel holds; a reset restarts only the log', () => {
  const held: ReceivedHistory = { events: [line(1)], exchanges: { root: exchange('Hello') }, clearings: 2 };
  assert.deepEqual(historyAfter(held, line(2)), { events: [line(2), line(1)], exchanges: held.exchanges, clearings: 2 });
  const reset = line(2, 'graph.reset', 'Graph reset.');
  assert.deepEqual(historyAfter(held, reset), { events: [reset], exchanges: held.exchanges, clearings: 2 });
  const full = { ...held, events: Array.from({ length: activityLimit }, (_, index) => line(activityLimit - index)) };
  assert.equal(historyAfter(full, line(activityLimit + 1)).events.length, activityLimit, 'the log stays bounded');
});

test('R4-6 an answer to a message sent before the clearing is dropped when it arrives', () => {
  const held: ReceivedHistory = { events: [], exchanges: {}, clearings: 1 };
  assert.equal(historyWithExchange(held, 'root', exchange('Sent before'), 0), held);
  assert.deepEqual(historyWithExchange(held, 'root', exchange('Sent after'), 1).exchanges, { root: exchange('Sent after') });
});

test('R4-6 the feed hides the lines it had received when history was cleared, and shows the server window after them', () => {
  const key = fictitiousKey(); const bus = new EventBus(10);
  const publish = (payload: string) => bus.publish({ agent_id: 'root', role: 'Lead', type: 'agent.message', payload });
  publish(`Answer with ${key}`); publish('Second');
  const received = bus.window().events; const through = hiddenWhenCleared(received);
  assert.equal(through, 2); assert.deepEqual(shownFeedLines(received, through), []);
  publish('After');
  const window = bus.window();
  assert.equal(hiddenAfterWindow(through, window.cursor), through, 'the same server keeps them hidden');
  assert.deepEqual(shownFeedLines(window.events, through).map(event => event.payload), ['After']);
  assert.equal(hiddenAfterWindow(through, 1), 0, 'a restarted server holds none of them, so nothing stays hidden');
  assert.equal(hiddenWhenCleared([]), 0, 'an empty feed hides nothing');
});

test('R4-6 the panel discards what it holds when the graph announces a configured key, even behind the revision guard', () => {
  const key = fictitiousKey(); const graph = new GraphService(); const received: GraphEvent[] = [];
  graph.subscribe(event => { received.push(event); }); const stopFollowing = graph.followSecrets();
  useProjection.getState().hydrate(createGraph()); useProjection.setState({ exchanges: {}, clearings: 0 });
  const id = graph.add({ name: `Agent ${key}`, provider: 'Unconfigured', context: { objective: 'Plan.', summary: '', artifacts: [] } });
  for (const event of received) useProjection.getState().apply(event);
  useProjection.getState().recordExchange(id, exchange(`Echo ${key}`), useProjection.getState().clearings);
  assert.ok(JSON.stringify(useProjection.getState().events).includes(key), 'the Activity line names the agent as it was');
  received.length = 0;
  const unregister = registerSecret(Buffer.from(key));
  try {
    assert.deepEqual(received.map(event => event.type), ['graph.redacted']);
    useProjection.getState().apply(received[0]);
    const { events, exchanges } = useProjection.getState();
    assert.deepEqual([events.map(event => event.type), exchanges], [['graph.redacted'], {}]);
    assert.ok(!JSON.stringify({ events, exchanges }).includes(key));
  } finally { unregister(); stopFollowing(); }
  // A command's response can reach the panel before the stream's event: the graph keeps the newer revision, and the
  // history is cleared all the same.
  useProjection.getState().recordExchange('root', exchange('Later'), useProjection.getState().clearings);
  const ahead: Graph = { ...useProjection.getState().graph, revision: 10 }; const blocked: Graph['status'] = 'blocked';
  useProjection.getState().apply({ id: 10, type: 'command.update', message: 'Server accepted command.', snapshot: ahead });
  useProjection.getState().apply({ ...redacted(9), snapshot: { ...ahead, revision: 9, status: blocked } });
  const state = useProjection.getState();
  assert.deepEqual([state.graph.revision, state.graph.status], [10, ahead.status], 'the graph stays the one the guard accepted');
  assert.deepEqual([state.events.map(event => event.type), state.exchanges, state.clearings], [['graph.redacted'], {}, 2]);
});

test('R4-6 the live feed follows the projection: a clearing hides what it had received, a later window shows what is newer', () => {
  const key = fictitiousKey(); const bus = new EventBus(10);
  const publish = (payload: string) => bus.publish({ agent_id: 'root', role: 'Lead', type: 'agent.message', payload });
  const at = (revision: number): Graph => ({ ...createGraph(), revision });
  publish(`Answer with ${key}`);
  let feed: FeedState = feedAfterWindow({ events: [], hiddenThrough: 0 }, bus.window());
  useProjection.getState().hydrate(createGraph()); useProjection.setState({ exchanges: {}, clearings: 0 });
  const stop = followClearings(next => { feed = next(feed); });
  try {
    useProjection.getState().apply({ ...line(1), snapshot: at(1) });
    assert.equal(feed.hiddenThrough, 0, 'another event hides nothing');
    useProjection.getState().apply({ ...redacted(2), snapshot: at(2) });
    assert.equal(feed.hiddenThrough, 1);
    publish('After'); feed = feedAfterWindow(feed, bus.window());
    assert.deepEqual(shownFeedLines(feed.events, feed.hiddenThrough).map(event => event.payload), ['After']);
    assert.equal(feed.events.length, 2, 'the mirror stays the server window as delivered');
  } finally { stop(); }
  publish('Later'); useProjection.getState().apply({ ...redacted(3), snapshot: at(3) });
  assert.equal(feed.hiddenThrough, 1, 'once stopped, the feed follows no more clearings');
});

test('R4-6 the feed list leaves the hidden lines out, and says why while nothing newer has arrived', async () => {
  const React = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');
  const key = fictitiousKey(); const bus = new EventBus(10);
  const publish = (payload: string) => bus.publish({ agent_id: 'root', role: 'Lead', type: 'agent.message', payload });
  const render = (feed: FeedState, matches = () => true) => renderToStaticMarkup(React.createElement(FeedLines, { feed, matches, select: () => {} }));
  publish(`Answer with ${key}`); const held = bus.window().events;
  assert.ok(render({ events: held, hiddenThrough: 0 }).includes(key), 'shown as received before the clearing');
  const cleared = render({ events: held, hiddenThrough: hiddenWhenCleared(held) });
  assert.ok(!cleared.includes(key)); assert.match(cleared, /No events since a key was configured\./);
  publish('After'); const after = render({ events: bus.window().events, hiddenThrough: 1 });
  assert.ok(!after.includes(key)); assert.match(after, /After/);
  assert.match(render({ events: bus.window().events, hiddenThrough: 1 }, () => false), /No events match these filters\./);
});
