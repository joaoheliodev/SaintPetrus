import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountedCost, exchangeFacts, exchangeFromResponse } from '../lib/run-exchange';
import { AgentInspector, runsWith } from '../components/agent-inspector';
import { createGraph } from '../lib/orchestrator';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';

const mock: ProviderStatusSnapshot = { provider: 'mock', model: 'mock-v1', connected: true, mocked: true, mockAvailable: true, verified: true, state: 'verified', mode: 'mock' };

test('U3 an exchange is read from the server response, never priced in the browser', () => {
  const exchange = exchangeFromResponse('Hello', { text: 'MOCK: hi', billingModel: 'mock-v1', model: 'mock-v1', mocked: true, latencyMs: 3, usage: { prompt: 38, completion: 15, total: 53 } });
  assert.deepEqual(exchange, { message: 'Hello', text: 'MOCK: hi', model: 'mock-v1', mocked: true, tokens: 53, latencyMs: 3 });
  assert.equal(exchangeFromResponse('x', { usage: { prompt: 4, completion: 6, total: 0 } }).tokens, 10, 'a zero total falls back to its parts');
  assert.equal(exchangeFromResponse('x', { model: 'requested', billingModel: 'served' }).model, 'served', 'the served model names the answer');
  assert.deepEqual(exchangeFromResponse('x', 'not an object'), { message: 'x', text: '', model: 'unknown model', mocked: false, tokens: 0, latencyMs: 0 });
});

test('U3 the cost is the newest call receipt of that agent, as the server accounted it', () => {
  const receipts = { receipts: [
    { kind: 'cache', agent: 'a', savedTokens: 9 },
    { kind: 'call', agent: 'b', costUsd: 0.5 },
    { kind: 'call', agent: 'a', costUsd: 0.000123 },
    { kind: 'call', agent: 'a', costUsd: 9 },
  ] };
  assert.equal(accountedCost(receipts, 'a'), 0.000123);
  assert.equal(accountedCost({ receipts: [{ kind: 'call', agent: 'a', costUsd: null }] }, 'a'), null, 'not priced yet');
  assert.equal(accountedCost({ receipts: [] }, 'a'), undefined);
  assert.equal(accountedCost(null, 'a'), undefined);
  const base = exchangeFromResponse('m', { text: 't', model: 'x', latencyMs: 12, usage: { total: 40 } });
  assert.deepEqual(exchangeFacts({ ...base, costUsd: 0.000123 }), ['40 tokens', '12 ms', '$0.000123']);
  assert.deepEqual(exchangeFacts({ ...base, mocked: true, costUsd: 0 }), ['40 tokens (estimated)', '12 ms', '$0.000000 (mock)']);
  assert.equal(exchangeFacts({ ...base, costUsd: null })[2], 'cost not accounted yet');
  assert.equal(exchangeFacts({ ...base, costPending: true, costUsd: 1 })[2], 'reading cost…');
  assert.equal(exchangeFacts(base)[2], 'cost not reported');
});

test('U3 the panel header says which model and mode Run once uses, and where the agent sits', () => {
  assert.equal(runsWith(mock), 'mock-v1 · MOCK');
  assert.equal(runsWith({ ...mock, provider: 'gemini', model: 'fictitious-model', mocked: false, mode: 'real' }), 'gemini · fictitious-model · REAL');
  assert.equal(runsWith({ ...mock, state: 'disconnected', connected: false }), 'No connection · MOCK');
  assert.equal(runsWith(undefined), 'Connection loading');
});

test('U3 Run is the default tab: message, send and the last exchange together; Details names what is sent', async () => {
  const graph = createGraph();
  const agent = { ...graph.agents[0], context: { objective: 'Plan <b>it</b>', summary: 'Manually configured agent.', artifacts: [] } };
  const exchange = { ...exchangeFromResponse('What <i>now</i>?', { text: 'Answer <script>x</script>', billingModel: 'mock-v1', mocked: true, latencyMs: 0, usage: { total: 52 } }), costUsd: 0 };
  const markup = renderToStaticMarkup(React.createElement(AgentInspector, { agent, agents: [agent], pending: false, command: async () => null, connect: async () => {}, connection: mock, exchange }));
  assert.match(markup, /mock-v1 · MOCK/); assert.match(markup, /Coordinator · level 0/); assert.match(markup, />Ready<\/span>/);
  const run = markup.slice(markup.indexOf('aria-label="Run this agent"'), markup.indexOf('Instruction sent with Run once'));
  assert.ok(run.indexOf('Send (1 call)') < run.indexOf('aria-label="Last exchange"'), 'the answer sits right under the send button');
  assert.ok(run.includes('What &lt;i&gt;now&lt;/i&gt;?') && run.includes('Answer &lt;script&gt;x&lt;/script&gt;'), 'message and answer are plain text');
  assert.match(run, /52 tokens \(estimated\) · 0 ms · \$0\.000000 \(mock\)/);
  assert.match(markup, /<h3>Instruction sent with Run once<\/h3><pre class="instruction">Manually configured agent\.<\/pre>/);
  assert.match(markup, /Plan &lt;b&gt;it&lt;\/b&gt;<\/p><p class="helper">Shown on the card, not sent to the model\.<\/p>/);
  assert.match(markup, /role="tab"[^>]*aria-selected="true"[^>]*>Run</, 'Run opens first');
  const source = await readFile('components/agent-inspector.tsx', 'utf8');
  assert.doesNotMatch(source, /PerMillion|preflightCost|tokens\/pricing/, 'no cost is computed in the browser');
});
