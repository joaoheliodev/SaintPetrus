import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectionChip, ConnectionView } from '../components/provider-status';
import { BudgetsView, PricesView, type TokenSource } from '../components/token-panel';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';

const status: ProviderStatusSnapshot = { provider: 'mock', model: 'mock-v1', connected: true, mocked: true, mockAvailable: true, verified: true, state: 'verified', mode: 'mock' };
const source = { status, unavailable: false, refresh: async () => {} };
const tokens: TokenSource = { data: undefined, error: '', pending: false, priceError: '', command: async () => true };

test('U4 the sidebar reaches every view, and Budgets, Prices and Connection are views rather than dialogs', async () => {
  const workspace = await readFile('components/workspace.tsx', 'utf8');
  for (const [id, label] of [['workspace', 'Workspace'], ['activity', 'Activity'], ['budgets', 'Budgets'], ['prices', 'Prices'], ['connection', 'Connection']]) assert.ok(workspace.includes(`{ id: '${id}', label: '${label}'`), label);
  assert.match(workspace, /aria-current=\{view === item\.id \? 'page' : undefined\}/, 'the current view is announced');
  assert.match(workspace, /<ConnectionChip source=\{connection\} open=\{\(\) => setView\('connection'\)\} \/>/, 'the chip leads to Connection');
  const [panel, status] = await Promise.all(['components/token-panel.tsx', 'components/provider-status.tsx'].map(path => readFile(path, 'utf8')));
  assert.doesNotMatch(panel + status, /DialogContent|DialogTrigger/);
  // Only the workspace holds the two readers; every view receives the same snapshot.
  assert.equal(workspace.match(/useProviderStatus\(\)/g)?.length, 1); assert.equal(workspace.match(/useTokenSnapshot\(\)/g)?.length, 1);
});

test('U4 the canvas stays laid out, but out of reach, while another view is open', async () => {
  const workspace = await readFile('components/workspace.tsx', 'utf8');
  assert.match(workspace, /<div className=\{cn\('workspace-view', view !== 'workspace' && 'is-away'\)\} inert=\{view !== 'workspace'\}>/);
  const css = await readFile('app/globals.css', 'utf8');
  assert.match(css, /\.workspace-view\.is-away \{ visibility: hidden; \}/, 'hidden without losing its size, which React Flow needs');
});

test('U4 the connection chip is a button that says where it leads, and the view keeps the key field transient', () => {
  const chip = renderToStaticMarkup(React.createElement(ConnectionChip, { source, open: () => {} }));
  assert.match(chip, /^<button type="button" class="provider-badge is-verified" title="Open Connection"><span role="status">● Connected · mock-v1<\/span><\/button>$/);
  const view = renderToStaticMarkup(React.createElement(ConnectionView, { source: { ...source, status: { ...status, mode: 'real', mocked: false, mockAvailable: false, provider: 'gemini', model: 'fictitious-model' } } }, React.createElement('p', null, 'Optional features here')));
  assert.match(view, /<h1 id="connection-title">Connection<\/h1>/); assert.match(view, /Optional features here/);
  assert.match(view, /<input type="password" autoComplete="off" spellCheck="false" maxLength="4096"\/>/, 'no value attribute: the key never enters React state');
  assert.match(view, /Leaving this view or submitting clears this field\./);
});

test('U4 Budgets and Prices render from the shared snapshot and say when it is loading', () => {
  assert.match(renderToStaticMarkup(React.createElement(BudgetsView, { tokens })), /Loading server token state…/);
  assert.match(renderToStaticMarkup(React.createElement(PricesView, { tokens })), /Loading server prices…/);
});

test('U10 the Next.js development badge is off, so it no longer covers panel text', async () => {
  assert.match(await readFile('next.config.ts', 'utf8'), /devIndicators: false/);
});
