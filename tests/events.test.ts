import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventBus } from '../lib/events/bus';
import { optionalEventRoutes } from '../lib/events/http';
import { registerSecret } from '../lib/security/redact';
import { EventRow } from '../components/event-feed';
const input = { agent_id: 'root', role: 'Coordinator', type: 'agent.message' as const, payload: 'Hello' };
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
