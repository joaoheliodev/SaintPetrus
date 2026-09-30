import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenService, type TokenSnapshot } from '../lib/tokens/service';
import { AccountingJournal } from '../lib/tokens/accounting-journal';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { periodClears } from '../lib/budget-summary';
import { askToStartBudgetPeriod, BudgetsView } from '../components/token-panel';
import { POST as tokensPost } from '../app/api/tokens/route';
import { runtime } from '../lib/server/runtime';

// Fictitious policy and tariffs for this test only. The mock gets a fictitious price too, so its share of a row's cost is
// not zero and the period has something to subtract. Mocked transport only.
const band = { inputCacheHitPerMillion: 1000, inputCacheMissPerMillion: 1000, outputPerMillion: 1000 };
const tariff = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band };
const policy: TokenPolicy = { global: 100_000, perAgent: 100_000, perModel: 100_000, perSession: 100_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100,
  models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'fictitious-model': tariff, 'mock-v1': tariff } };
const signal = () => new AbortController().signal;
const mock: ProviderAdapter = { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'MOCK answer' }) };
const answered: ProviderAdapter = { id: 'openai', model: 'fictitious-model', complete: async () => ({ text: 'Answer', billingModel: 'fictitious-model', usage: { prompt: 10, completion: 10, total: 20 } }) };
const service = () => new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
const find = (rows: TokenSnapshot['rows'], scope: string, id?: string) => rows.find(row => row.scope === scope && (id === undefined || row.id === id))!;
// A row as the budget sees it, without the session id that differs between two server runs.
const comparable = (row: TokenSnapshot['rows'][number]) => ({ ...row, id: row.scope === 'session' ? 'session' : row.id });

test('R5-11 a new budget period clears the mock\'s estimated tokens in every row and keeps the session row\'s real spend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-period-'));
  try {
    const tokens = service(); tokens.restore(new AccountingJournal(directory));
    tokens.setLimit('model', 'fictitious-model', 9000);
    await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'a', 'System');
    await tokens.execute(new ProviderProxy(), answered, 'Question', signal(), 'a', 'System');
    tokens.kill();
    const before = tokens.snapshot();
    const session = find(before.rows, 'session');
    assert.ok(session.mock.total > 0 && session.actual.total === 20 && session.used === session.mock.total + 20, 'the session row holds the mock and the real call');
    const mockCost = session.costAccountedUsd - find(before.rows, 'model', 'fictitious-model').costAccountedUsd;
    assert.ok(mockCost > 0, 'the fictitious mock price left a cost to subtract');
    tokens.startBudgetPeriod();
    const after = tokens.snapshot();
    for (const row of after.rows.filter(item => item.scope !== 'session')) {
      assert.deepEqual([row.used, row.mock.total, row.actual.total, row.costAccountedUsd], [0, 0, 0, 0], `${row.scope} ${row.id} starts again from zero`);
      assert.equal(row.limit, find(before.rows, row.scope, row.id).limit, `${row.scope} ${row.id} keeps its limit`);
    }
    const kept = find(after.rows, 'session');
    assert.deepEqual([kept.mock.total, kept.used, kept.actual.total, kept.costAccountedUsd], [0, session.used - session.mock.total, 20, Number((session.costAccountedUsd - mockCost).toFixed(12))], 'the session row loses exactly the mock part');
    assert.deepEqual([kept.limit, kept.reserved, kept.costReservedUsd, kept.estimated, kept.saved, kept.unverifiable], [session.limit, session.reserved, session.costReservedUsd, session.estimated, session.saved, session.unverifiable], 'and keeps the rest');
    assert.deepEqual([after.stopped, after.paused], [before.stopped, before.paused], 'pauses and Pause all stay');
    // A server run that made only the real call ends the period with the same session row.
    const twin = service();
    await twin.execute(new ProviderProxy(), answered, 'Question', signal(), 'a', 'System');
    twin.startBudgetPeriod();
    assert.deepEqual(comparable(find(twin.snapshot().rows, 'session')), comparable(kept), 'the session row is what real calls alone would leave');
    // The journal's replica after a restart: the durable rows at zero, never below, their limits kept.
    const replica = service(); replica.restore(new AccountingJournal(directory));
    for (const row of replica.snapshot().rows.filter(item => item.scope !== 'session')) assert.deepEqual([row.used, row.actual.total, row.costAccountedUsd, row.estimated], [0, 0, 0, 0], `replica ${row.scope} ${row.id}`);
    assert.equal(find(replica.snapshot().rows, 'model', 'fictitious-model').limit, 9000);
    // The question and Details carry the one sentence, and it says both halves.
    assert.match(periodClears, /^Consumption in the global, agent and model budgets starts again from zero\. The mock's estimated tokens are cleared everywhere/);
    assert.match(periodClears, /the session budget keeps only what real calls spent since the server started\.$/);
    let asked = '';
    assert.equal(await askToStartBudgetPeriod(async () => true, async ({ message }) => { asked = message; return false; }), false);
    assert.ok(asked.startsWith(`Start a new budget period? ${periodClears} `), asked);
    const markup = renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: tokens.snapshot(), error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined }, agents: [] }));
    const details = markup.slice(markup.indexOf('<details'));
    assert.match(details, />Start a new budget period</);
    assert.ok(details.includes(`${periodClears.replaceAll("'", '&#x27;')} The journal keeps the history.`), 'Details says the same');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('R5-11 a scope the mock filled is free after a new budget period, and the next Resume eligible agents releases its agent', async () => {
  const previous = Reflect.get(globalThis, 'saintpetrusTokens');
  runtime().mock.reset(); const graph = runtime().graph;
  const writer = graph.add({ name: 'Writer', provider: 'Unconfigured', context: { objective: 'Write.', summary: '', artifacts: [] } });
  const tokens = new TokenService(policy, prices, { ids: () => graph.snapshot().agents.map(agent => agent.id), pause: id => graph.setAgentStatus(id, 'paused'), pauseAll: () => graph.pauseAll() });
  Reflect.set(globalThis, 'saintpetrusTokens', tokens);
  const post = async (body: unknown) => { const response = await tokensPost(new Request('http://127.0.0.1:3000/api/tokens', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: response.status, body: await response.json() }; };
  try {
    await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), writer, 'System');
    tokens.setLimit('agent', writer, find(tokens.snapshot().rows, 'agent', writer).used);
    await assert.rejects(tokens.execute(new ProviderProxy(), mock, 'Again', signal(), writer, 'System'), /exhausted/);
    assert.deepEqual(tokens.snapshot().pauses, [{ agent: writer, removed: false, reasons: [{ kind: 'budget', scope: 'agent', id: writer, dimensions: ['tokens'], mock: true }] }], 'held by a scope the mock filled');
    assert.equal((await post({ action: 'new-period' })).status, 200);
    assert.deepEqual(tokens.snapshot().pauses, [{ agent: writer, removed: false, reasons: [] }], 'nothing holds it once the period cleared the mock');
    const resumed = await post({ action: 'resume' });
    assert.deepEqual([resumed.status, resumed.body.resumed, resumed.body.pauses], [200, [writer], []]);
    assert.equal(graph.snapshot().agents.find(agent => agent.id === writer)?.status, 'ready');
  } finally { Reflect.set(globalThis, 'saintpetrusTokens', previous); runtime().mock.reset(); }
});
