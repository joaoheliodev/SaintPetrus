import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { POST as tokensPost } from '../app/api/tokens/route';
import { runtime } from '../lib/server/runtime';
import { budgetStatus, pauseSentence, pauseSummary, resumable, resumeOutcome, resumeReplyCurrent, type BudgetRow } from '../lib/budget-summary';
import { BudgetsView } from '../components/token-panel';

// Fictitious policy and tariffs for this test only; the mock is free, the keyed model is not. Mocked transport only.
const band = { inputCacheHitPerMillion: 1000, inputCacheMissPerMillion: 1000, outputPerMillion: 1000 };
const tariff = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band };
const free = { ...tariff, offPeak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 }, peak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 } };
const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100,
  models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'fictitious-model': tariff, 'mock-v1': free } };
const signal = () => new AbortController().signal;
const mock: ProviderAdapter = { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'MOCK answer' }) };
const keyed = (complete: ProviderAdapter['complete']): ProviderAdapter => ({ id: 'openai', model: 'fictitious-model', complete });
const answered = keyed(async () => ({ text: 'Answer', billingModel: 'fictitious-model', usage: { prompt: 10, completion: 10, total: 20 } }));
function service(ids = ['root', 'a']) {
  const clock = { now: 1000 };
  const tokens = new TokenService(policy, prices, { ids: () => ids, pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => clock.now);
  return { tokens, clock, ids };
}
const reasonsOf = (tokens: TokenService, agent: string) => tokens.snapshot().pauses.find(pause => pause.agent === agent)?.reasons;
const row = (tokens: TokenService, scope: string, id: string) => tokens.snapshot().rows.find(item => item.scope === scope && item.id === id)!;
const names = (id: string) => ({ root: 'Coordinator', a: 'Writer' })[id] ?? id;

test('R5-4 the snapshot says what holds each paused agent: every full scope, its dimension, and whether the mock fills it', async () => {
  const { tokens } = service();
  await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'a', 'System');
  tokens.setLimit('agent', 'a', row(tokens, 'agent', 'a').used); tokens.setLimit('global', 'all', row(tokens, 'global', 'all').used);
  await assert.rejects(tokens.execute(new ProviderProxy(), mock, 'Again', signal(), 'a', 'System'), /exhausted/);
  assert.deepEqual(reasonsOf(tokens, 'a'), [{ kind: 'budget', scope: 'global', id: 'all', dimensions: ['tokens'], mock: true }, { kind: 'budget', scope: 'agent', id: 'a', dimensions: ['tokens'], mock: true }], 'both full scopes, both filled by the mock');
  const dear = service();
  await dear.tokens.execute(new ProviderProxy(), answered, 'Question', signal(), 'a', 'System');
  dear.tokens.setCostLimit('agent', 'a', row(dear.tokens, 'agent', 'a').costAccountedUsd);
  await assert.rejects(dear.tokens.execute(new ProviderProxy(), answered, 'Again', signal(), 'a', 'System'), /exhausted/);
  assert.deepEqual(reasonsOf(dear.tokens, 'a'), [{ kind: 'budget', scope: 'agent', id: 'a', dimensions: ['dollars'], mock: false }], 'real spend is not the mock');
  dear.tokens.kill();
  assert.deepEqual(reasonsOf(dear.tokens, 'root'), [{ kind: 'pause_all' }], 'Pause all holds everyone');
});

test('R5-4 unverifiable usage says until when; an unpriced served model waits for reconciliation; a removed agent names its reservation', async () => {
  const { tokens, clock, ids } = service(['root', 'a', 'b']);
  await assert.rejects(tokens.execute(new ProviderProxy(), keyed(async () => { throw new ProviderFailure('timeout'); }), 'Question', signal(), 'a', 'System'), /timeout/);
  assert.deepEqual(reasonsOf(tokens, 'a'), [{ kind: 'unverifiable', until: 1100 }]);
  assert.throws(() => tokens.resume(), /^Error: Usage unverifiable: a call lost contact with its provider, so no agent can be resumed until 1970-01-01T00:00:01\.100Z, when its reservation becomes an estimate\. Check the provider billing meanwhile\.$/);
  ids.splice(1, 1);
  assert.deepEqual(tokens.snapshot().pauses.find(pause => pause.agent === 'a'), { agent: 'a', removed: true, reasons: [{ kind: 'unverifiable', until: 1100 }, { kind: 'reservation', reservationId: 'reservation-1', status: 'unverifiable' }] });
  await assert.rejects(tokens.execute(new ProviderProxy(), keyed(async () => ({ text: 'Answer', billingModel: 'unpriced-model', usage: { prompt: 10, completion: 10, total: 20 } })), 'Question', signal(), 'b', 'System'), /no verified price/);
  clock.now += 101;
  assert.deepEqual(reasonsOf(tokens, 'b'), [{ kind: 'reconciliation', reservationId: 'reservation-2' }], 'expired into an estimate that only confirmed usage releases');
  assert.deepEqual(tokens.resume(), [], 'nobody it holds is released');
});

test('R5-4 resume answers whom it released beside what still holds the others, and a refusal is the server sentence', async () => {
  const previous = Reflect.get(globalThis, 'saintpetrusTokens');
  runtime().mock.reset(); const graph = runtime().graph;
  const writer = graph.add({ name: 'Writer', provider: 'Unconfigured', context: { objective: 'Write.', summary: '', artifacts: [] } });
  const clock = { now: 1000 };
  const tokens = new TokenService(policy, prices, { ids: () => graph.snapshot().agents.map(agent => agent.id), pause: id => graph.setAgentStatus(id, 'paused'), pauseAll: () => graph.pauseAll() }, fixedRatioTokenCounter(1000), () => clock.now);
  Reflect.set(globalThis, 'saintpetrusTokens', tokens);
  const post = (body: unknown) => tokensPost(new Request('http://127.0.0.1:3000/api/tokens', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  try {
    await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), writer, 'System');
    tokens.setLimit('agent', writer, row(tokens, 'agent', writer).used);
    await post({ action: 'kill' });
    const response = await post({ action: 'resume' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual([body.resumed, body.pauses], [['root'], [{ agent: writer, removed: false, reasons: [{ kind: 'budget', scope: 'agent', id: writer, dimensions: ['tokens'], mock: true }] }]]);
    await assert.rejects(tokens.execute(new ProviderProxy(), keyed(async () => { throw new ProviderFailure('timeout'); }), 'Question', signal(), 'root', 'System'), /timeout/);
    const refused = await post({ action: 'resume' });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /^Usage unverifiable: .* until 1970-01-01T00:00:01\.100Z/);
  } finally { Reflect.set(globalThis, 'saintpetrusTokens', previous); runtime().mock.reset(); }
});

test('R5-4 the panel words every hold and the way out, from the server reasons alone', () => {
  const pause = (agent: string, reasons: Parameters<typeof pauseSentence>[0]['reasons'], removed = false) => ({ agent, removed, reasons });
  assert.equal(pauseSentence(pause('a', [{ kind: 'budget', scope: 'global', id: 'all', dimensions: ['tokens'], mock: true }, { kind: 'budget', scope: 'agent', id: 'a', dimensions: ['tokens', 'dollars'], mock: false }]), names),
    "Writer is paused: the global budget is full in tokens, filled by the mock's estimated tokens and the agent budget for Writer is full in tokens and dollars. Raise their limits in Details or restart the server, which clears the mock's estimated tokens (a new budget period keeps them), then use Resume eligible agents.");
  assert.equal(pauseSentence(pause('a', [{ kind: 'budget', scope: 'session', id: 's', dimensions: ['tokens'], mock: false }]), names), 'Writer is paused: the session budget is full in tokens. Raise its limit in Details or restart the server, which starts a new session budget, then use Resume eligible agents.');
  assert.equal(pauseSentence(pause('a', [{ kind: 'unverifiable', until: Date.UTC(2026, 8, 30, 12, 5) }]), names), 'Writer is paused: a call lost contact with its provider, so usage is unverifiable until 12:05 UTC. Check the provider billing and wait until then, then use Resume eligible agents.');
  assert.equal(pauseSentence(pause('a', [{ kind: 'reconciliation', reservationId: 'reservation-2' }]), names), 'Writer is paused: its expired estimate reservation-2 waits for the provider-confirmed usage. Apply the confirmed usage to reservation-2 in Details, then use Resume eligible agents.');
  assert.equal(pauseSentence(pause('3e835e66-5413', [{ kind: 'reservation', reservationId: 'reservation-1', status: 'estimated' }], true), names), 'A removed agent (3e835e66) is paused: its reservation reservation-1 is an expired estimate. Settle reservation-1 in Details; the pause goes with it then.');
  assert.equal(pauseSentence(pause('a', []), names), 'Writer is paused, and nothing holds it now: use Resume eligible agents.');
  const everyone = pauseSummary({ stopped: true, pauses: [pause('root', [{ kind: 'pause_all' }]), pause('a', [{ kind: 'pause_all' }, { kind: 'budget', scope: 'agent', id: 'a', dimensions: ['tokens'], mock: false }])] }, names);
  assert.deepEqual(everyone, { headline: 'Pause all agents is on, so every agent is paused. Use Resume eligible agents to run them again.', details: ['These stay paused after that:', 'Writer is paused: the agent budget for Writer is full in tokens. Raise its limit in Details, then use Resume eligible agents.'] });
  assert.equal(pauseSummary({ stopped: false, pauses: [] }, names), undefined);
  assert.equal(pauseSummary({ stopped: false, pauses: [pause('a', [])] }, names)?.headline, '1 agent is paused.');
  assert.deepEqual([resumable(undefined), resumable({ stopped: false, pauses: [] }), resumable({ stopped: true, pauses: [] }), resumable({ stopped: false, pauses: [pause('a', [])] })], [false, false, true, true]);
  assert.deepEqual([resumeOutcome({ resumed: ['root', 'a'] }, names), resumeOutcome({ resumed: [] }, names), resumeOutcome({ error: 'Usage unverifiable: wait.' }, names), resumeOutcome('noise', names)], ['Resumed Coordinator and Writer.', 'No agent was resumed.', 'Usage unverifiable: wait.', undefined]);
  assert.deepEqual([resumeReplyCurrent({ resumed: [], paused: ['a'] }, { paused: ['a'] }), resumeReplyCurrent({ resumed: [], paused: ['a'] }, { paused: [] }), resumeReplyCurrent({ error: 'No.' }, { paused: ['a'] }), resumeReplyCurrent({ error: 'No.' }, { paused: [] })], [true, false, true, false], 'an answer is dropped once the pauses change');
});

test('R5-4 the status names every full scope, and a removed agent row blocks nothing', () => {
  const zero = { prompt: 0, completion: 0, total: 0 };
  const line = (scope: BudgetRow['scope'], id: string, fields: Partial<BudgetRow> = {}): BudgetRow => ({ scope, id, limit: 1000, used: 0, reserved: 0, estimated: 0, conservativeCachedInput: 0, actual: zero, mock: zero, costLimitUsd: 1, costReservedUsd: 0, costAccountedUsd: 0, costUnmeasuredUsd: 0, saved: 0, unverifiable: 0, state: 'available', ...fields });
  const name = (item: BudgetRow) => item.id === 'a1' ? 'Writer' : item.id;
  const snapshot = (rows: BudgetRow[]) => ({ rows, stopped: false, reservations: [] });
  assert.equal(budgetStatus(snapshot([line('global', 'all', { used: 1000, state: 'stopped' }), line('agent', 'a1', { used: 1000, costAccountedUsd: 1, state: 'stopped' })]), name).text,
    'Blocked: the global budget is full in tokens and the agent budget for Writer is full in tokens and dollars. Raise their limits in Details, then use Resume eligible agents.');
  const removed = { ...line('agent', 'gone', { used: 1000, state: 'stopped' }), removed: true };
  assert.equal(budgetStatus(snapshot([line('global', 'all'), removed]), name).text, 'All budgets have room.');
});

test('R5-4 Budgets says, beside Resume eligible agents, what it did and what still holds each agent', async () => {
  const { tokens } = service();
  await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'a', 'System');
  tokens.setLimit('agent', 'a', row(tokens, 'agent', 'a').used);
  await assert.rejects(tokens.execute(new ProviderProxy(), mock, 'Again', signal(), 'a', 'System'), /exhausted/);
  const data = tokens.snapshot();
  const render = (resumeReply: unknown) => renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data, error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply }, agents: [{ id: 'root', name: 'Coordinator' }, { id: 'a', name: 'Writer' }] }));
  const markup = render({ resumed: [], paused: data.paused });
  const reasons = markup.slice(markup.indexOf('class="pause-reasons"'), markup.indexOf('</section>', markup.indexOf('class="pause-reasons"')));
  assert.match(reasons, /No agent was resumed\./); assert.match(reasons, /1 agent is paused\./);
  assert.match(reasons, /Writer is paused: the agent budget for Writer is full in tokens, filled by the mock&#x27;s estimated tokens\. Raise its limit in Details or restart the server/);
  assert.doesNotMatch(render({ resumed: ['a'], paused: [] }), /Resumed/, 'an answer about other pauses is not shown');
});

test('R5-4 a removed agent row offers no limit to change, since the server refuses one', async () => {
  const { tokens, ids } = service();
  await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'a', 'System');
  ids.splice(1, 1);
  const markup = renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: tokens.snapshot(), error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined }, agents: [{ id: 'root', name: 'Coordinator' }] }));
  const removedRow = markup.slice(markup.indexOf('<small>a · removed agent</small>'), markup.indexOf('</tr>', markup.indexOf('<small>a · removed agent</small>')));
  assert.equal(removedRow.match(/<button[^>]*disabled=""[^>]*title="A removed agent makes no calls; its row stays as history and has no limit to change\."/g)?.length, 2, 'both limits are off, and say why');
  assert.throws(() => tokens.setLimit('agent', 'a', 5000), /Unknown budget scope/, 'as the server refuses them');
});
