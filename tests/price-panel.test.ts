import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricePanel } from '../components/price-panel';
import type { ModelPrice } from '../lib/tokens/pricing';
import type { TokenSnapshot } from '../lib/tokens/service';

const model = 'synthetic-price-panel';
const price = (effectiveAt: string, label: string): ModelPrice => ({
  provider: 'mock', effectiveAt, verifiedAt: effectiveAt, sourceUrl: `https://example.invalid/${label}`,
  offPeak: { inputCacheHitPerMillion: 1_000_000, inputCacheMissPerMillion: 2_000_000, outputPerMillion: 3_000_000 },
  peak: { inputCacheHitPerMillion: 4_000_000, inputCacheMissPerMillion: 5_000_000, outputPerMillion: 6_000_000 },
  peakWindowsUtc: [],
});
const catalog = (): TokenSnapshot['catalog'] => ({
  at: Date.parse('2099-06-01T00:00:00Z'),
  models: [{ model, current: { id: 'server-current', price: price('2099-01-01', 'current-source') }, versions: [
    { id: 'older-first', price: price('2000-01-01', 'older-source'), state: 'past' },
    { id: 'newer-second', price: price('2100-01-01', 'newer-source'), state: 'future' },
    { id: 'server-current', price: price('2099-01-01', 'current-source'), state: 'current' },
  ] }],
});
const render = (state: TokenSnapshot['catalog'] | undefined = catalog(), pending = false, error = '') =>
  renderToStaticMarkup(React.createElement(PricePanel, { catalog: state, pending, error, onAppend: async () => true }));

test('price panel renders the server current tariff instead of choosing from dates or history', () => {
  const markup = render();
  const beforeHistory = markup.split('<details>')[0];
  assert.match(beforeHistory, /data-current-price="server-current"/);
  assert.match(beforeHistory, /https:\/\/example\.invalid\/current-source/);
  assert.match(beforeHistory, /Verified: 2099-01-01/);
  assert.doesNotMatch(beforeHistory, /older-source|newer-source/);
  assert.equal(markup.match(/data-current-price=/g)?.length, 1);
});

test('price history starts collapsed and preserves the server order without duplicating the current tariff', () => {
  const markup = render();
  assert.match(markup, /<details><summary>View history<\/summary>/);
  assert.doesNotMatch(markup, /<details[^>]*\bopen\b/);
  const history = markup.split('<details>')[1].split('</details>')[0];
  assert.ok(history.indexOf('data-price-version="older-first"') < history.indexOf('data-price-version="newer-second"'));
  assert.match(history, /older-source/);
  assert.match(history, /newer-source/);
  assert.doesNotMatch(history, /data-price-version="server-current"/);
});

test('missing current price refuses execution visibly even when historical and scheduled tariffs exist', () => {
  const snapshot = catalog();
  delete snapshot.models[0].current;
  const markup = render(snapshot);
  assert.match(markup, /No current price — execution refused\./);
  assert.doesNotMatch(markup, /data-current-price=/);
  assert.match(markup, /data-price-version="older-first"/);
  assert.match(markup, /data-price-version="newer-second"/);
});

test('server price errors appear unchanged as escaped text', () => {
  const error = '<script>Price validity overlaps & must be refused.</script>';
  const markup = render(catalog(), false, error);
  assert.match(markup, /role="alert">&lt;script&gt;Price validity overlaps &amp; must be refused\.&lt;\/script&gt;<\/p>/);
  assert.doesNotMatch(markup, /<script>/);
});

test('price drafts start blank and writes stay disabled while loading or saving', () => {
  const ready = render();
  const inputs = [...ready.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
  assert.equal(inputs.length, 11);
  for (const input of inputs) assert.doesNotMatch(input, /\bvalue="[^"]+"/);
  assert.match(ready, /<option value="" disabled="" selected="">Select provider<\/option>/);
  assert.match(ready, /<fieldset><legend>Add price validity<\/legend>/);
  for (const markup of [render(catalog(), true), renderToStaticMarkup(React.createElement(PricePanel, {
    catalog: undefined, pending: false, error: '', onAppend: async () => true,
  }))]) assert.match(markup, /<fieldset disabled=""><legend>Add price validity<\/legend>/);
});

test('price readers retain one server snapshot owner and no independent selection or ordering', () => {
  const panel = readFileSync(new URL('../components/price-panel.tsx', import.meta.url), 'utf8');
  const parent = readFileSync(new URL('../components/token-panel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /\bfetch\s*\(|\.sort\s*\(|\.reverse\s*\(|Date\.(?:now|parse)\s*\(|new Date\s*\(/);
  assert.doesNotMatch(panel, /useState[^\n]*(?:catalog|current|versions)/);
  assert.equal(parent.match(/\bsetData\s*\(/g)?.length, 1);
  assert.match(parent, /setData\(value\)/);
  assert.match(parent, /catalog=\{data\?\.catalog\}/);
});
