import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderProxy } from '../lib/providers/proxy';
import type { ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import { AccountingJournal, type JournalRecord } from '../lib/tokens/accounting-journal';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';

// Fictitious policy, tariffs and usage for this test only. The mock gets a non-zero price so its exclusion shows.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 2, outputPerMillion: 4 };
const price = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band };
const policy: TokenPolicy = { global: 1_000_000, perAgent: 1_000_000, perModel: 1_000_000, perSession: 1_000_000, costLimitsUsd: { global: 10, perAgent: 10, perModel: 10, perSession: 10 }, cacheTtlMs: 0, reservationTtlMs: 100,
  models: { 'fictitious-model': { provider: 'openai', max_tokens: 64, temperature: 0 }, 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-28', currency: 'USD', models: { 'fictitious-model': { ...price, provider: 'openai' }, 'mock-v1': { ...price, provider: 'mock' } } };
const signal = () => new AbortController().signal;
const keyed = (complete: ProviderAdapter['complete'] = async (_input, _signal, _options, onDispatch) => { onDispatch?.(); return { text: 'Answer', usage: { prompt: 30, completion: 10, total: 40 }, billingModel: 'fictitious-model' }; }): ProviderAdapter => ({ id: 'openai', model: 'fictitious-model', complete });
const mock: ProviderAdapter = { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'MOCK answer' }) };

function service(clock = { now: 1000 }) {
  const paused = new Set<string>();
  const tokens = new TokenService(policy, prices, { ids: () => ['a', 'b'], pause: id => { paused.add(id); }, pauseAll: () => {} }, fixedRatioTokenCounter(4), () => clock.now);
  return { tokens, paused, clock };
}
const row = (tokens: TokenService, scope: string, id?: string) => tokens.snapshot().rows.find(item => item.scope === scope && (id === undefined || item.id === id))!;
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-accounting-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('R-02 consumption, cost, limits and receipts survive a restart; the session scope and the mock do not', () => withDirectory(async directory => {
  const first = service();
  assert.deepEqual(first.tokens.restore(new AccountingJournal(directory)), { journal: 'recorded' });
  first.tokens.setLimit('agent', 'a', 5000); first.tokens.setCostLimit('global', 'all', 3);
  await first.tokens.execute(new ProviderProxy(), keyed(), 'Question', signal(), 'a', 'System');
  await first.tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'b', 'System');
  const before = { global: row(first.tokens, 'global'), agent: row(first.tokens, 'agent', 'a'), model: row(first.tokens, 'model', 'fictitious-model') };
  assert.ok(before.global.mock.total > 0 && before.global.costAccountedUsd > before.agent.costAccountedUsd, 'the mock counts while the process runs');
  const receipts = first.tokens.receiptSnapshot().receipts;

  const second = service({ now: 5000 });
  assert.deepEqual(second.tokens.restore(new AccountingJournal(directory)), { journal: 'recorded' });
  const global = row(second.tokens, 'global');
  assert.equal(global.used, before.global.used - before.global.mock.total, 'mock usage is not journaled');
  assert.deepEqual(global.actual, before.global.actual); assert.deepEqual(global.mock, { prompt: 0, completion: 0, total: 0 });
  assert.equal(global.costAccountedUsd, before.agent.costAccountedUsd, 'nor its cost');
  const scoped: [string, string, typeof before.agent][] = [['agent', 'a', before.agent], ['model', 'fictitious-model', before.model]];
  for (const [scope, id, expected] of scoped) {
    const restored = row(second.tokens, scope, id);
    assert.deepEqual([restored.used, restored.costAccountedUsd, restored.actual], [expected.used, expected.costAccountedUsd, expected.actual], scope);
  }
  assert.equal(row(second.tokens, 'agent', 'a').limit, 5000, 'a limit set in Budgets is reapplied'); assert.equal(global.costLimitUsd, 3);
  assert.equal(row(second.tokens, 'agent', 'b').limit, policy.perAgent, 'an untouched limit follows the policy');
  const session = row(second.tokens, 'session');
  assert.equal(session.id, second.tokens.sessionId); assert.equal(session.used, 0, 'the session scope starts empty');
  const restoredReceipts = second.tokens.receiptSnapshot().receipts;
  assert.deepEqual(restoredReceipts, receipts.filter(receipt => receipt.provider !== 'mock'), 'receipts come back, the mock\'s do not');
  await second.tokens.execute(new ProviderProxy(), keyed(), 'Question', signal(), 'a', 'System');
  assert.equal(second.tokens.receiptSnapshot().receipts[0].id, restoredReceipts[0].id + 1, 'numbering continues after the last journaled receipt');
  assert.equal(second.tokens.snapshot().reservations.length, 0);
  const text = await readFile(join(directory, 'accounting.jsonl'), 'utf8');
  assert.ok(!/Question|System|Answer/.test(text), 'no prompt, instruction or answer is journaled');
}));

test('R-02 a crash with a call in flight rebuilds it as unverifiable with the agent paused, and never refunds it', () => withDirectory(async directory => {
  const first = service();
  first.tokens.restore(new AccountingJournal(directory));
  let dispatched = false;
  // The process dies while the provider holds the request: the call never settles and nothing closes the reservation.
  void first.tokens.execute(new ProviderProxy(), keyed(async (_input, _signal, _options, onDispatch) => { onDispatch?.(); dispatched = true; return new Promise(() => {}); }), 'Question', signal(), 'a', 'System');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(dispatched);
  const records = new AccountingJournal(directory).open().records;
  const last = records.at(-1);
  assert.ok(last?.kind === 'state' && last.state.reservations[0]?.status === 'inflight', 'the reservation was on disk before the request left');
  const held = last.state.reservations[0];

  const second = service({ now: 7000 });
  const status = second.tokens.restore(new AccountingJournal(directory));
  assert.deepEqual(status, { journal: 'recorded', recoveredReservations: 1 });
  const [reservation] = second.tokens.snapshot().reservations;
  assert.deepEqual([reservation.id, reservation.status, reservation.tokens, reservation.costUsd, reservation.expiresAt], [held.id, 'unverifiable', held.tokens, held.costUsd, 7000 + policy.reservationTtlMs]);
  assert.ok(second.paused.has('a') && second.tokens.snapshot().paused.includes('a'), 'the agent is paused');
  assert.throws(() => second.tokens.resume('a'), /Usage unverifiable/);
  for (const scope of ['global', 'agent', 'model']) assert.deepEqual([row(second.tokens, scope, scope === 'agent' ? 'a' : undefined).reserved, row(second.tokens, scope, scope === 'agent' ? 'a' : undefined).unverifiable], [held.tokens, 1], scope);
  assert.equal(row(second.tokens, 'session').reserved, 0);
  await assert.rejects(second.tokens.execute(new ProviderProxy(), keyed(), 'Question', signal(), 'a', 'System'), /paused/);
  second.clock.now = 7000 + policy.reservationTtlMs;
  assert.equal(row(second.tokens, 'global').used, held.tokens, 'expiry converts it to conservative usage');
  assert.ok(row(second.tokens, 'global').costAccountedUsd >= held.costUsd);

  const third = service({ now: 9000 });
  third.tokens.restore(new AccountingJournal(directory));
  assert.equal(third.tokens.snapshot().reservations[0].status, 'estimated', 'the conversion was journaled');
  assert.equal(row(third.tokens, 'global').used, held.tokens); assert.equal(row(third.tokens, 'global').unverifiable, 0);
  assert.ok(third.paused.has('a'));
  assert.deepEqual(third.tokens.receiptSnapshot().receipts.map(receipt => receipt.kind), ['expiry']);
}));

test('R-02 an unreadable journal is set aside and blocks real calls, across restarts, until a new budget period', () => withDirectory(async directory => {
  await writeFile(join(directory, 'accounting.jsonl'), '{"v":1,"kind":"state","at":1,"state":{"rows":"edited by hand"}}\n');
  const first = service();
  const status = first.tokens.restore(new AccountingJournal(directory));
  assert.equal(status.journal, 'blocked'); assert.equal(status.reason, 'journal_unreadable'); assert.match(status.rejectedAs ?? '', /^accounting-rejected-.+\.jsonl$/);
  assert.match(await readFile(join(directory, status.rejectedAs ?? ''), 'utf8'), /edited by hand/, 'kept aside, never overwritten');
  let called = false;
  await assert.rejects(first.tokens.execute(new ProviderProxy(), keyed(async () => { called = true; return { text: '', usage: { prompt: 1, completion: 1, total: 2 }, billingModel: 'fictitious-model' }; }), 'Question', signal(), 'a', 'System'), /could not be read/);
  assert.throws(() => first.tokens.quote(keyed(), 'Question', 'a', 'System'), /could not be read/, 'the quote refuses what the call refuses');
  assert.equal(called, false);
  await first.tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'b', 'System');

  const second = service();
  assert.deepEqual(second.tokens.restore(new AccountingJournal(directory)), { journal: 'blocked', reason: 'journal_unreadable' }, 'a restart does not lift the block');
  assert.deepEqual(second.tokens.startBudgetPeriod(), { journal: 'recorded' });
  await second.tokens.execute(new ProviderProxy(), keyed(), 'Question', signal(), 'a', 'System');
  const third = service();
  assert.deepEqual(third.tokens.restore(new AccountingJournal(directory)), { journal: 'recorded' });
  assert.equal(row(third.tokens, 'global').actual.total, 40);
  assert.equal((await readdir(directory)).filter(name => name.startsWith('accounting-rejected-')).length, 1);
}));

test('R-02 a new budget period is journaled, keeps history and limits, and waits for open reservations', () => withDirectory(async directory => {
  const first = service();
  first.tokens.restore(new AccountingJournal(directory));
  first.tokens.setLimit('model', 'fictitious-model', 9000);
  await assert.rejects(first.tokens.execute(new ProviderProxy(), keyed(async (_input, _signal, _options, onDispatch) => { onDispatch?.(); throw new Error('lost'); }), 'Question', signal(), 'a', 'System'));
  assert.throws(() => first.tokens.startBudgetPeriod(), /open reservation/);
  const [open] = first.tokens.snapshot().reservations;
  first.clock.now += policy.reservationTtlMs;
  assert.throws(() => first.tokens.startBudgetPeriod(), /open reservation/, 'an estimate is still unresolved');
  first.tokens.reconcileReservation(open.id, 30, 10, 0.001);
  first.tokens.startBudgetPeriod();
  assert.deepEqual([row(first.tokens, 'global').used, row(first.tokens, 'global').costAccountedUsd], [0, 0]);
  const second = service();
  second.tokens.restore(new AccountingJournal(directory));
  assert.deepEqual([row(second.tokens, 'global').used, row(second.tokens, 'global').costAccountedUsd, row(second.tokens, 'model', 'fictitious-model').limit], [0, 0, 9000]);
  assert.deepEqual(second.tokens.receiptSnapshot().receipts.map(receipt => receipt.kind), ['manual', 'expiry', 'call'], 'the receipts stay');
  const kinds = new AccountingJournal(directory).open().records.map(item => item.kind);
  assert.ok(kinds.includes('period') && kinds.indexOf('period') > kinds.indexOf('receipt'), 'history is appended to, not deleted');
}));

test('R-02 a journal write that fails before provider I/O refuses the call, releases the hold and blocks real calls', () => withDirectory(async directory => {
  const first = service();
  const journal = new AccountingJournal(directory);
  first.tokens.restore(journal);
  const failing: JournalRecord[] = [];
  journal.append = entry => { failing.push(entry); throw new Error('disk full'); };
  let called = false;
  await assert.rejects(first.tokens.execute(new ProviderProxy(), keyed(async () => { called = true; return { text: '', usage: { prompt: 1, completion: 1, total: 2 }, billingModel: 'fictitious-model' }; }), 'Question', signal(), 'a', 'System'), /could not be written/);
  assert.equal(called, false, 'nothing left the process');
  assert.equal(failing.length, 1);
  assert.deepEqual([row(first.tokens, 'global').reserved, row(first.tokens, 'global').costReservedUsd, first.tokens.snapshot().reservations.length], [0, 0, 0]);
  assert.deepEqual(first.tokens.accountingStatus(), { journal: 'blocked', reason: 'journal_write_failed' });
  await first.tokens.execute(new ProviderProxy(), mock, 'Question', signal(), 'b', 'System');
  assert.throws(() => first.tokens.startBudgetPeriod(), /could not be written/);
}));
