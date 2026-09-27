import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { budgetMeter, percent, rowUsage, type BudgetRow } from '../lib/budget-summary';
import { BudgetMeter } from '../components/token-panel';

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
