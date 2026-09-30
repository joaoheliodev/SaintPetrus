import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenService } from '../lib/tokens/service';
import { AccountingJournal } from '../lib/tokens/accounting-journal';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { periodClears } from '../lib/budget-summary';
import { askToStartBudgetPeriod, BudgetsView } from '../components/token-panel';

// Fictitious policy and tariffs for this test only; the mock is free, the keyed model is not. Mocked transport only.
const band = { inputCacheHitPerMillion: 1000, inputCacheMissPerMillion: 1000, outputPerMillion: 1000 };
const none = { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 };
const tariff = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band };
const policy: TokenPolicy = { global: 100_000, perAgent: 100_000, perModel: 100_000, perSession: 100_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100,
  models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'fictitious-model': tariff, 'mock-v1': { ...tariff, offPeak: none, peak: none } } };
const signal = () => new AbortController().signal;
const mock: ProviderAdapter = { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'MOCK answer' }) };
const answered: ProviderAdapter = { id: 'openai', model: 'fictitious-model', complete: async () => ({ text: 'Answer', billingModel: 'fictitious-model', usage: { prompt: 10, completion: 10, total: 20 } }) };

test('R5-6 a new budget period clears real consumption only, and its question and Details say what stays', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-period-'));
  try {
    const tokens = new TokenService(policy, prices, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} });
    tokens.restore(new AccountingJournal(directory));
    await tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'a', 'System');
    await tokens.execute(new ProviderProxy(), answered, 'Question', signal(), 'a', 'System');
    const before = tokens.snapshot().rows;
    const global = before.find(row => row.scope === 'global')!;
    assert.ok(global.actual.total > 0 && global.mock.total > 0 && global.costAccountedUsd > 0, 'real and mock usage both recorded');
    tokens.startBudgetPeriod();
    const after = tokens.snapshot().rows;
    for (const row of after.filter(item => item.scope !== 'session')) {
      const was = before.find(item => item.scope === row.scope && item.id === row.id)!;
      assert.deepEqual([row.actual.total, row.costAccountedUsd], [0, 0], `${row.scope} ${row.id}: real consumption from zero`);
      assert.deepEqual([row.used, row.mock.total], [was.mock.total, was.mock.total], `${row.scope} ${row.id}: the mock's estimated tokens stay`);
    }
    assert.deepEqual(after.find(row => row.scope === 'session'), before.find(row => row.scope === 'session'), 'the session budget stays as it was');
    // The words match what the service just did, in the question and in Details alike.
    assert.match(periodClears, /^Real consumption in the global, agent and model budgets starts again from zero\. /);
    assert.match(periodClears, /The mock's estimated tokens from this server run and the session budget stay until the server restarts\.$/);
    let asked = '';
    assert.equal(await askToStartBudgetPeriod(async () => true, async ({ message }) => { asked = message; return false; }), false);
    assert.ok(asked.startsWith(`Start a new budget period? ${periodClears} `), asked);
    const markup = renderToStaticMarkup(React.createElement(BudgetsView, { tokens: { data: tokens.snapshot(), error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply: undefined }, agents: [] }));
    const details = markup.slice(markup.indexOf('<details'));
    assert.match(details, />Start a new budget period</);
    assert.ok(details.includes(`${periodClears.replaceAll("'", '&#x27;')} The journal keeps the history.`), 'Details says the same');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
