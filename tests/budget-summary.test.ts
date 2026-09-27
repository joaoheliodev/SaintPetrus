import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { budgetMeter, budgetStatus, callCount, idle, percent, rowUsage, scopes, usd, type BudgetRow } from '../lib/budget-summary';
import { BudgetMeter, BudgetsView } from '../components/token-panel';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';

const zero = { prompt: 0, completion: 0, total: 0 };
// Fictitious limits for this test only.
const row = (scope: BudgetRow['scope'], id: string, fields: Partial<BudgetRow> = {}): BudgetRow => ({ scope, id, limit: 1000, used: 0, reserved: 0, estimated: 0, conservativeCachedInput: 0, actual: zero, mock: zero, costLimitUsd: 1, costReservedUsd: 0, costAccountedUsd: 0, costUnmeasuredUsd: 0, saved: 0, unverifiable: 0, state: 'available', ...fields });

test('U4 a row is as full as its fuller dimension, counting what is reserved as the server does', () => {
  assert.deepEqual(rowUsage(row('global', 'all', { used: 150, reserved: 60, costAccountedUsd: 0.1 })), { tokens: 0.21, dollars: 0.1, dimension: 'tokens', share: 0.21 });
  assert.equal(rowUsage(row('global', 'all', { used: 10, costAccountedUsd: 0.5, costReservedUsd: 0.25 })).dimension, 'dollars');
  assert.equal(rowUsage(row('global', 'all', { limit: 0 })).share, 1, 'a zero limit admits nothing');
  assert.equal(percent(0.214), 21); assert.equal(percent(50), 999);
});

test('U4 the top meter shows the fullest of global and session, never an agent or model row', () => {
  const rows = [row('global', 'all', { used: 210 }), row('session', 's', { used: 300, state: 'warning' }), row('agent', 'a', { used: 990, state: 'stopped' }), row('model', 'm', { used: 999 })];
  assert.deepEqual(budgetMeter(rows), { percent: 30, scope: 'session', dimension: 'tokens', state: 'warning' });
  assert.equal(budgetMeter([row('global', 'all', { used: 100 }), row('session', 's', { used: 10, state: 'stopped' })])?.state, 'stopped', 'a stopped scope is never hidden behind a fuller one');
  assert.equal(budgetMeter([]), undefined);
});

test('U4 the meter says its number and state in text, and leads to Budgets', () => {
  const snapshot = { rows: [row('global', 'all', { used: 850, state: 'warning' }), row('session', 's')], stopped: false };
  const markup = renderToStaticMarkup(React.createElement(BudgetMeter, { snapshot, open: () => {} }));
  assert.match(markup, /class="budget-meter is-warning"/); assert.match(markup, /<span>Budget 85% · warning<\/span>/); assert.match(markup, /width:85%/);
  assert.match(renderToStaticMarkup(React.createElement(BudgetMeter, { snapshot: { ...snapshot, stopped: true }, open: () => {} })), /Budget · all paused/);
  assert.match(renderToStaticMarkup(React.createElement(BudgetMeter, { snapshot: undefined, open: () => {} })), /Budget …/);
});

test('U5 the status names what is wrong and the way out, worst first', () => {
  const snapshot = (rows: BudgetRow[], extra: Partial<{ stopped: boolean; reservations: { status: 'estimated' | 'unverifiable' }[] }> = {}) => ({ rows, stopped: false, reservations: [], ...extra });
  const name = (item: BudgetRow) => item.id === 'a1' ? 'Writer' : item.id;
  assert.deepEqual(budgetStatus(snapshot([row('global', 'all')]), name), { tone: 'green', text: 'All budgets have room.' });
  assert.match(budgetStatus(snapshot([row('agent', 'a1', { used: 900, state: 'warning' })]), name).text, /^Warning: the agent budget for Writer is above 80%/);
  const blocked = budgetStatus(snapshot([row('global', 'all', { used: 900, state: 'warning' }), row('agent', 'a1', { costAccountedUsd: 1, state: 'stopped' })]), name);
  assert.equal(blocked.tone, 'red'); assert.match(blocked.text, /^Blocked: the agent budget for Writer is full in dollars\. Raise its limit in Details, then use Resume eligible agents\.$/);
  assert.match(budgetStatus(snapshot([row('global', 'all')], { stopped: true }), name).text, /Pause all agents/);
  assert.match(budgetStatus(snapshot([row('global', 'all')], { reservations: [{ status: 'estimated' }] }), name).text, /^1 expired reservation is counted as an estimate/);
  assert.match(budgetStatus(snapshot([row('agent', 'a1', { state: 'stopped' }), row('global', 'all', { unverifiable: 5 })]), name).text, /unverifiable/, 'lost contact comes first');
});

test('U5 unused rows are recognised, money reads plainly and calls are counted from receipts', () => {
  assert.equal(idle(row('model', 'm')), true); assert.equal(idle(row('model', 'm', { estimated: 3 })), false); assert.equal(idle(row('model', 'm', { costReservedUsd: 0.001 })), false);
  assert.deepEqual(scopes.map(item => item.scope), ['global', 'agent', 'model', 'session']);
  assert.equal(usd(0), '$0.00'); assert.equal(usd(0.000123), '$0.000123'); assert.equal(usd(1.5), '$1.50');
  assert.deepEqual(callCount({ receipts: [{ kind: 'call' }, { kind: 'cache' }, { kind: 'call' }], evicted: 0 }), { calls: 2, truncated: false });
  assert.deepEqual(callCount({ receipts: [{ kind: 'call' }], evicted: 4 }), { calls: 1, truncated: true });
  assert.deepEqual(callCount('nope'), { calls: 0, truncated: false });
});

test('U5 Budgets opens with the summary and the used scopes, and keeps every field and action in Details', () => {
  // Fictitious policy and tariff for this test only.
  const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 };
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'other-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
  const prices: Prices = { date: '2026-09-27', currency: 'USD', models: { 'test-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band }, 'other-model': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band } } };
  const service = new TokenService(policy, prices, { ids: () => ['a1', 'a2'], pause: () => {}, pauseAll: () => {} });
  service.setLimit('agent', 'a1', 10);
  const markup = renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: service.snapshot(), error: '', pending: false, priceError: '', command: async () => true }, agents: [{ id: 'a1', name: 'Writer' }, { id: 'a2', name: 'Critic' }] }));
  const summary = markup.slice(markup.indexOf('aria-label="Budget summary"'), markup.indexOf('<details'));
  assert.match(summary, /All budgets have room\./); assert.match(summary, /0 of 1,000 tokens/); assert.match(summary, /0 held or expired reservations/);
  assert.match(markup, /The mock&#x27;s estimated tokens count against the token limits too/);
  assert.equal(markup.match(/>Resume eligible agents</g)?.length, 1, 'one Resume, in the summary');
  assert.ok(!summary.includes('other-model') && !summary.includes('Critic'), 'unused scopes wait behind Show all scopes');
  assert.match(markup, />Show all scopes</);
  const details = markup.slice(markup.indexOf('<details'));
  for (const text of ['Budgets and consumption', 'aria-label="Budget agent:a1"', 'aria-label="USD budget model:other-model"', '>Apply agent<', '>Apply USD<', 'No held or expired reservations.', 'Model allowlist']) assert.ok(details.includes(text), text);
});
