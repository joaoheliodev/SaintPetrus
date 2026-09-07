import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactStore } from '../lib/preview/store';
import { optionalPreviewRoutes, previewDocument } from '../lib/preview/http';
import { optionalEventRoutes } from '../lib/events/http';
import { EventBus } from '../lib/events/bus';
import { ArtifactFrame } from '../components/artifact-preview';
test('preview disabled registers no artifact route; both client features off leave bus alive', () => {
  assert.equal(optionalPreviewRoutes(false).size, 0);
  const bus = new EventBus(); assert.equal(optionalEventRoutes(false, bus).size, 0);
  bus.publish({ agent_id: 'root', role: 'Coordinator', type: 'agent.created', payload: 'Created' });
  assert.equal(bus.snapshot().events.length, 1);
});
test('isolated wrapper CSP blocks connections, forms, external frames; both sandbox layers omit same-origin', async () => {
  const response = previewDocument(3210); const csp = response.headers.get('Content-Security-Policy')!;
  for (const directive of ["connect-src 'none'", "form-action 'none'", "frame-src 'none'", 'frame-ancestors http://127.0.0.1:3210', 'sandbox allow-scripts']) assert.ok(csp.includes(directive));
  const html = await response.text(); assert.ok(html.includes('sandbox="allow-scripts"')); assert.ok(!html.includes('allow-same-origin'));
  const markup = renderToStaticMarkup(React.createElement(ArtifactFrame, { url: 'http://127.0.0.1:3211/preview', frameRef: React.createRef<HTMLIFrameElement>(), loaded: () => {} }));
  assert.ok(markup.includes('sandbox="allow-scripts"')); assert.ok(!markup.includes('allow-same-origin'));
});
test('artifact writes debounce, retain producer, bound history and preserve prior versions', () => {
  const store = new ArtifactStore(); store.update('a', 'Designer', '```html\n<h1>One</h1>'); store.update('a', 'Designer', '```html\n<h1>Two</h1>'); store.flush();
  assert.equal(store.snapshot().length, 1); assert.ok(store.snapshot()[0].source.includes('Two'));
  for (let i = 0; i < 22; i++) { store.update('a', 'Designer', `<html>${i}</html>`); store.flush(); }
  assert.equal(store.snapshot().length, 20); assert.equal(store.snapshot()[0].role, 'Designer'); assert.notEqual(store.snapshot()[0].source, store.snapshot()[1].source);
});

test('Responses stream publishes partial artifact text and preserves final provider usage across chunk boundaries', async () => {
  const { readResponseStream } = await import('../lib/providers/response-stream');
  const encoder = new TextEncoder(); const events = [
    { type: 'response.output_text.delta', delta: '<html>One' },
    { type: 'response.output_text.delta', delta: '</html>' },
    { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } } },
  ].map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const bytes = encoder.encode(events); let index = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (index === bytes.length) controller.close(); else controller.enqueue(bytes.slice(index, ++index)); } });
  const partials: string[] = []; const result = await readResponseStream(new Response(body), text => partials.push(text));
  assert.deepEqual(partials, ['<html>One', '<html>One</html>']);
  assert.deepEqual(result.usage, { prompt: 3, completion: 5, total: 8 });
});
