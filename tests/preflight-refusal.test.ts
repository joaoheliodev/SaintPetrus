import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { POST as providerPost } from '../app/api/provider/route';
import { GET as tokensGet, POST as tokensPost } from '../app/api/tokens/route';
import { runtime } from '../lib/server/runtime';
import { resumable } from '../lib/budget-summary';
import { PauseNotice, ResumeEligibleButton, type TokenSource } from '../components/token-panel';

// Fictitious policy and tariff for this test only. Mocked transport only; the route test runs in MOCK.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 };
const policy: TokenPolicy = { global: 100_000, perAgent: 100_000, perModel: 100_000, perSession: 100_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100,
  models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'fictitious-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band } } };
const signal = () => new AbortController().signal;
let sent = 0;
const adapter: ProviderAdapter = { id: 'openai', model: 'fictitious-model', complete: async () => { sent++; return { text: 'Answer', billingModel: 'fictitious-model', usage: { prompt: 10, completion: 10, total: 20 } }; } };
const service = () => { const paused: string[] = []; return { paused, tokens: new TokenService(policy, prices, { ids: () => ['a'], pause: id => { paused.push(id); }, pauseAll: () => {} }) }; };
const long = `Please answer this. ${'word '.repeat(300)}`;
const row = (tokens: TokenService, scope: string) => tokens.snapshot().rows.find(item => item.scope === scope)!;

test('R5-13 a preflight refusal pauses no one, and a smaller call from the same agent goes through right after', async () => {
  const { tokens, paused } = service();
  const small = tokens.quote(adapter, 'Hi', 'a', 'System').reservedTokens;
  assert.ok(tokens.quote(adapter, long, 'a', 'System').reservedTokens > small, 'the long question reserves more');
  // Room for the small call's worst case and no more: the scope is not full, and the long call does not fit.
  tokens.setLimit('agent', 'a', small);
  sent = 0;
  await assert.rejects(tokens.execute(new ProviderProxy(), adapter, long, signal(), 'a', 'System'), /^Error: Preflight reservation exceeds token or monetary budget\.$/);
  assert.equal(sent, 0, 'nothing was sent');
  assert.deepEqual([paused, tokens.snapshot().paused, tokens.snapshot().pauses], [[], [], []], 'and nobody is paused');
  assert.equal(resumable(tokens.snapshot()), false, 'so nothing offers Resume eligible agents');
  const answer = await tokens.execute(new ProviderProxy(), adapter, 'Hi', signal(), 'a', 'System');
  assert.deepEqual([answer.text, sent, row(tokens, 'agent').used], ['Answer', 1, 20]);
});

test('R5-13 a scope exactly full still refuses and pauses; a quote pauses no one either way', async () => {
  const { tokens, paused } = service();
  await tokens.execute(new ProviderProxy(), adapter, 'Hi', signal(), 'a', 'System');
  tokens.setLimit('agent', 'a', row(tokens, 'agent').used + 1);
  assert.throws(() => tokens.quote(adapter, 'Hi', 'a', 'System'), /^Error: Preflight reservation exceeds token or monetary budget\.$/);
  tokens.setLimit('agent', 'a', row(tokens, 'agent').used);
  assert.throws(() => tokens.quote(adapter, 'Hi', 'a', 'System'), /^Error: Token or monetary budget exhausted\.$/);
  assert.deepEqual([paused, tokens.snapshot().paused], [[], []], 'quotes pause no one');
  await assert.rejects(tokens.execute(new ProviderProxy(), adapter, 'Hi', signal(), 'a', 'System'), /^Error: Token or monetary budget exhausted\.$/);
  assert.deepEqual(tokens.snapshot().pauses, [{ agent: 'a', removed: false, reasons: [{ kind: 'budget', scope: 'agent', id: 'a', dimensions: ['tokens'], mock: false }] }], 'a full scope pauses, and says so');
});

test('R5-13 over the routes, a Run once refused at preflight answers 409 with the sentence and leaves its agent Ready, with no pause on screen', async () => {
  runtime().mock.reset();
  const post = (path: string, body: unknown) => new Request(`http://127.0.0.1:3000/api/${path}`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const writer = runtime().graph.add({ name: 'Writer', provider: 'Unconfigured', context: { objective: 'Write.', summary: '', artifacts: [] } });
  try {
    assert.equal((await tokensPost(post('tokens', { action: 'limit', scope: 'agent', id: writer, limit: 1 }))).status, 200);
    for (const action of ['quote', 'complete']) {
      const refused = await providerPost(post('provider', { action, input: 'Question', agentId: writer }));
      assert.deepEqual([action, refused.status, (await refused.json()).error], [action, 409, 'Preflight reservation exceeds token or monetary budget.']);
    }
    const snapshot = await (await tokensGet(new Request('http://127.0.0.1:3000/api/tokens'))).json();
    assert.deepEqual([snapshot.paused, snapshot.pauses], [[], []]);
    assert.equal(runtime().graph.snapshot().agents.find(agent => agent.id === writer)?.status, 'ready');
    const tokens: TokenSource = { data: snapshot, error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined };
    const agents = runtime().graph.snapshot().agents;
    assert.equal(renderToStaticMarkup(React.createElement(PauseNotice, { tokens, agents, open: () => {} })), '', 'no notice speaks of a pause');
    assert.equal(renderToStaticMarkup(React.createElement(ResumeEligibleButton, { tokens })), '', 'and no Resume is offered');
  } finally { await tokensPost(post('tokens', { action: 'limit', scope: 'agent', id: writer, limit: 100000 })); runtime().mock.reset(); }
});
