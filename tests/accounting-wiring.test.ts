import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as tokensPost, GET as tokensGet } from '../app/api/tokens/route';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import { AccountingJournal } from '../lib/tokens/accounting-journal';
import { openAccountingJournal, tokenService } from '../lib/tokens/runtime';
import { journalWarning, periodNotice } from '../lib/budget-summary';
import { askToStartBudgetPeriod, BudgetsView } from '../components/token-panel';
import type { Prices, TokenPolicy } from '../lib/tokens/config';

// Fictitious policy and tariff for this test only.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 2, outputPerMillion: 4 };
const policy: TokenPolicy = { global: 1_000_000, perAgent: 1_000_000, perModel: 1_000_000, perSession: 1_000_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-28', currency: 'USD', models: { 'fictitious-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band, provider: 'openai' } } };
const origin = 'http://127.0.0.1:3000';
const newPeriod = () => tokensPost(new Request(`${origin}/api/tokens`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"action":"new-period"}' }));
const lost: ProviderAdapter = { id: 'openai', model: 'fictitious-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); throw new Error('lost'); } };

async function withGlobals(run: (directory: string) => Promise<void>) {
  const keys = ['saintpetrusTokens', 'saintpetrusAccounting'];
  const previous = keys.map(key => Reflect.get(globalThis, key));
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-accounting-'));
  try { keys.forEach(key => Reflect.deleteProperty(globalThis, key)); await run(directory); }
  finally { keys.forEach((key, index) => Reflect.set(globalThis, key, previous[index])); await rm(directory, { recursive: true, force: true }); }
}

test('R-02 the tokens route starts a new budget period, and says why when it refuses', () => withGlobals(async directory => {
  let now = 1000;
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, undefined, () => now);
  service.restore(new AccountingJournal(directory));
  Reflect.set(globalThis, 'saintpetrusTokens', service);
  await assert.rejects(service.execute(new ProviderProxy(), lost, 'Question', new AbortController().signal, 'a', 'System'));
  const refused = await newPeriod();
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'Reconcile or wait for every open reservation before starting a new budget period.' });
  now += policy.reservationTtlMs;
  const [estimate] = service.snapshot().reservations;
  service.reconcileReservation(estimate.id, 10, 10, 0.001);
  const accepted = await newPeriod();
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.deepEqual(body.accounting, { journal: 'recorded' });
  assert.equal(body.rows.find((row: { scope: string }) => row.scope === 'global').used, 0);
  assert.match(await readFile(join(directory, 'accounting.jsonl'), 'utf8'), /"kind":"period","at":\d+,"reason":"operator"/);
}));

test('R-02 the server\'s reading of the journal reaches the routes: set aside blocks until a new period, unopenable until a restart', () => withGlobals(async directory => {
  await writeFile(join(directory, 'accounting.jsonl'), 'not a journal\n');
  const opened = openAccountingJournal(directory);
  assert.match(opened?.rejectedAs ?? '', /accounting-rejected-/);
  const snapshot = await (await tokensGet(new Request(`${origin}/api/tokens`))).json();
  assert.equal(snapshot.accounting.journal, 'blocked'); assert.equal(snapshot.accounting.reason, 'journal_unreadable');
  assert.equal((await newPeriod()).status, 200);
  assert.deepEqual(tokenService().accountingStatus(), { journal: 'recorded' });

  Reflect.deleteProperty(globalThis, 'saintpetrusTokens');
  const unopenable = join(directory, 'unopenable');
  await mkdir(join(unopenable, 'accounting.jsonl'), { recursive: true });
  assert.throws(() => openAccountingJournal(unopenable));
  assert.deepEqual(tokenService().accountingStatus(), { journal: 'blocked', reason: 'journal_unopenable' });
  const refused = await newPeriod();
  assert.equal(refused.status, 409); assert.match((await refused.json()).error, /cannot be opened/);
}));

test('R-02 Budgets warns when the journal blocks real calls, and offers the way out it has', () => {
  assert.equal(journalWarning({ journal: 'recorded' }), undefined); assert.equal(journalWarning({ journal: 'memory' }), undefined);
  assert.deepEqual(journalWarning({ journal: 'blocked', reason: 'journal_unopenable' })?.canStartPeriod, false);
  assert.match(journalWarning({ journal: 'blocked', reason: 'journal_unreadable', rejectedAs: 'accounting-rejected-x.jsonl' })?.text ?? '', /set aside as accounting-rejected-x\.jsonl\. Nothing restarted from zero/);
  assert.match(journalWarning({ journal: 'blocked', reason: 'journal_write_failed' })?.text ?? '', /could not be written/);
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  const render = () => renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: service.snapshot(), error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined }, agents: [] }));
  assert.doesNotMatch(render(), /Start a new budget period|role="alert"/, 'nothing to offer without a journal');
  service.journalUnopenable();
  assert.match(render(), /role="alert" class="journal-warning"><p>Real calls are blocked: the accounting journal cannot be opened/);
  assert.doesNotMatch(render(), />Start a new budget period</, 'a new period cannot fix a file it cannot open');
  assert.match(render(), /tone-red">Budgets have room, but real calls are blocked by the accounting journal/); assert.doesNotMatch(render(), /All budgets have room/, 'a blocked server is not called fine');
});

test('R-02 a journaled service offers a new period in Details, and a recovered call is named in the summary', () => withGlobals(async directory => {
  const first = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  first.restore(new AccountingJournal(directory));
  void first.execute(new ProviderProxy(), { ...lost, complete: async () => new Promise(() => {}) }, 'Question', new AbortController().signal, 'a', 'System');
  await new Promise(resolve => setImmediate(resolve));
  const second = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
  second.restore(new AccountingJournal(directory));
  const markup = renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: second.snapshot(), error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined }, agents: [] }));
  assert.match(markup, /1 provider call was in flight when the server stopped\. It came back unverifiable and its agent is paused\./);
  assert.match(markup.slice(markup.indexOf('<details')), />Start a new budget period</);
  assert.doesNotMatch(markup, /role="alert"/);
}));

test('R3-2 after a new budget period, paused agents are said to stay paused, with the way out', () => {
  assert.equal(periodNotice({ paused: [], stopped: false }), 'A new budget period has started.');
  assert.equal(periodNotice({ paused: ['a'], stopped: false }), 'A new budget period has started. 1 agent is still paused: a new period resumes no one. Use Resume eligible agents.');
  assert.match(periodNotice({ paused: ['a', 'b'], stopped: false }), /2 agents are still paused.*Resume eligible agents/);
  assert.match(periodNotice({ paused: ['a'], stopped: true }), /Pause all agents is still on.*Resume eligible agents/);
});

test('R3-2 the notice waits for the server: a cancelled or refused period reports nothing started', async () => {
  const sent: object[] = [];
  const command = async (body: object) => { sent.push(body); return sent.length > 1; };
  assert.equal(await askToStartBudgetPeriod(command, async () => false), false, 'cancelled');
  assert.deepEqual(sent, [], 'nothing sent when cancelled');
  assert.equal(await askToStartBudgetPeriod(command, async () => true), false, 'refused by the server');
  assert.equal(await askToStartBudgetPeriod(command, async () => true), true, 'started');
  assert.deepEqual(sent, [{ action: 'new-period' }, { action: 'new-period' }]);
});
