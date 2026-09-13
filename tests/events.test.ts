import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventBus } from '../lib/events/bus';
import { optionalEventRoutes } from '../lib/events/http';
import { registerSecret } from '../lib/security/redact';
import { EventRow, replaceEventWindow } from '../components/event-feed';
const input = { agent_id: 'root', role: 'Coordinator', type: 'agent.message' as const, payload: 'Hello' };
const eventWindowFromFrame = (frame: string) => JSON.parse(frame.split('\ndata: ')[1]!.split('\n\n')[0]!) as import('../lib/events/types').EventWindow;
test('events are sanitized before storage and reach the SSE client redacted, including recognized key fragments', async () => {
  const secret = Buffer.from(randomBytes(32).toString('hex')); const unregister = registerSecret(secret);
  const bus = new EventBus(2);
  const routes = optionalEventRoutes(true, bus);
  const response = routes.get('/api/events')!(new Request('http://127.0.0.1:3100/api/events'));
  const reader = response.body!.getReader();
  try {
    await reader.read();
    bus.publish({ ...input, payload: secret.toString() + ' ' + secret.toString().slice(16, 32) });
    const wire = new TextDecoder().decode((await reader.read()).value);
    assert.ok(wire.includes('[REDACTED]'));
    assert.ok(!wire.includes(secret.toString())); assert.ok(!wire.includes(secret.toString().slice(16, 28)));
    assert.ok(!JSON.stringify(bus.snapshot()).includes(secret.toString().slice(16, 28)));
  } finally { await reader.cancel(); unregister(); secret.fill(0); }
});
test('disabled feed registers no endpoint while internal events continue; history bounded and immutable to consumers', () => {
  const bus = new EventBus(2); assert.equal(optionalEventRoutes(false, bus).size, 0);
  bus.subscribe(event => { event.payload = 'tampered'; throw new Error('Consumer failure'); });
  for (let i = 0; i < 3; i++) bus.publish({ ...input, tokens: { prompt: 2, completion: 1 } });
  const first = bus.snapshot(); assert.deepEqual(first.events.map(e => e.id), [2, 3]);
  assert.equal(first.prompt + first.completion, 9); assert.equal(first.events[0].payload, 'Hello');
  first.events[0].payload = 'changed'; assert.equal(bus.snapshot().events[0].payload, 'Hello');
});
test('the server window owns event order, retention and duplicate identity', () => {
  const bus = new EventBus(2);
  const stale = bus.publish({ ...input, payload: 'Stale reader copy' });
  bus.publish({ ...input, payload: 'Second' });
  bus.publish({ ...input, payload: 'Third' });
  const window = bus.window(stale.id);

  assert.equal(window.authoritative, true);
  assert.equal(window.truncated, false);
  assert.deepEqual(window.events.map(event => event.id), [3, 2]);
  assert.deepEqual(
    replaceEventWindow([{ ...stale, id: 3 }, stale], window).map(event => [event.id, event.payload]),
    [[3, 'Third'], [2, 'Second']],
  );
});
test('a server restart cursor and an expired cursor are reported by the authoritative window', () => {
  const bus = new EventBus(1);
  bus.publish(input); bus.publish(input); bus.publish(input);
  assert.equal(bus.window(1).truncated, true);
  assert.equal(bus.window(99).truncated, true);
});
test('every SSE update replaces the client with the complete server-retained window', async () => {
  const bus = new EventBus(2);
  bus.publish({ ...input, payload: 'First' });
  bus.publish({ ...input, payload: 'Second' });
  const handler = optionalEventRoutes(true, bus).get('/api/events')!;
  const response = handler(new Request('http://127.0.0.1:3100/api/events', { headers: { 'Last-Event-ID': '1' } }));
  const reader = response.body!.getReader();
  try {
    const initial = eventWindowFromFrame(new TextDecoder().decode((await reader.read()).value));
    assert.deepEqual(initial.events.map(event => event.id), [2, 1]);
    bus.publish({ ...input, payload: 'Third' });
    const updated = eventWindowFromFrame(new TextDecoder().decode((await reader.read()).value));
    assert.deepEqual(updated.events.map(event => event.id), [3, 2]);
  } finally { await reader.cancel(); }
});
test('event readers contain no competing order, retention or duplicate policy', () => {
  const feed = readFileSync(new URL('../components/event-feed.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../components/workspace.tsx', import.meta.url), 'utf8');
  const graphPanel = workspace.split('aria-label="Graph events"')[1]!.split('</section>')[0]!;
  const readerPolicy = /new Map|\.sort\(|\.reverse\(|\.slice\(/;

  assert.doesNotMatch(feed, readerPolicy);
  assert.doesNotMatch(graphPanel, readerPolicy);
  assert.doesNotMatch(feed, /\border\s*:/);
  assert.doesNotMatch(graphPanel, /\border\s*:/);
});
test('event HTML is rendered as text, never a live element', () => {
  const bus = new EventBus(); const event = bus.publish({ ...input, payload: '<img src=x onerror=alert(1)>' });
  const markup = renderToStaticMarkup(React.createElement(EventRow, { event, select: () => {} }));
  assert.ok(markup.includes('&lt;img')); assert.ok(!markup.includes('<img'));
});
test('SSE rejects cross-origin requests and replay reports gaps', () => {
  const bus = new EventBus(1); for (let i = 0; i < 3; i++) bus.publish(input);
  assert.equal(bus.snapshot(1).truncated, true);
  const handler = optionalEventRoutes(true, bus).get('/api/events')!;
  assert.equal(handler(new Request('http://127.0.0.1:3100/api/events', { headers: { Origin: 'null' } })).status, 403);
});
