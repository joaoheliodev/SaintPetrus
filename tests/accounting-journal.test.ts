import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountingJournal, validJournalRecord, type JournalRecord } from '../lib/tokens/accounting-journal';
import { validDurableState, type DurableState } from '../lib/tokens/accounting-state';
import type { ModelPrice } from '../lib/tokens/pricing';

// Fictitious tariff and amounts for this test only.
const band = { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 2, outputPerMillion: 4 };
const price: ModelPrice = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band, provider: 'gemini' };
const state: DurableState = {
  rows: [{ scope: 'global', id: 'all', used: 120, estimated: 0, conservativeCachedInput: 0, actual: { prompt: 80, completion: 40, total: 120 }, costAccountedUsd: 0.0002, costUnmeasuredUsd: 0 }, { scope: 'agent', id: 'a', limit: 5000, used: 120, estimated: 0, conservativeCachedInput: 0, actual: { prompt: 80, completion: 40, total: 120 }, costAccountedUsd: 0.0002, costUnmeasuredUsd: 0 }],
  reservations: [{ id: 'reservation-3', agent: 'a', model: 'fictitious-model', provider: 'gemini', priceVersionId: 'v', priceVersions: { 'fictitious-model': { id: 'v', price } }, tokens: 90, costUsd: 0.0003, inputTokens: 26, maxOutputTokens: 64, createdAt: 1000, expiresAt: null, status: 'inflight' }],
  paused: [], stopped: false, agentModels: { a: ['fictitious-model'] }, reservationSequence: 3,
};

test('R-02 journal records are strict: known kinds and fields, a well-formed accounting state, no free text', () => {
  assert.ok(validDurableState(state));
  const good: JournalRecord[] = [{ v: 1, kind: 'state', at: 1, state }, { v: 1, kind: 'period', at: 2, reason: 'operator' }];
  for (const item of good) assert.ok(validJournalRecord(item), item.kind);
  for (const [label, item] of [
    ['unknown kind', { v: 1, kind: 'prompt', at: 1 }], ['unknown field', { v: 1, kind: 'period', at: 1, reason: 'operator', text: 'hi' }],
    ['version', { v: 2, kind: 'period', at: 1, reason: 'operator' }], ['negative count', { v: 1, kind: 'state', at: 1, state: { ...state, rows: [{ ...state.rows[0], used: -1 }] } }],
    ['session row', { v: 1, kind: 'state', at: 1, state: { ...state, rows: [{ ...state.rows[0], scope: 'session' }] } }],
    ['extra reservation field', { v: 1, kind: 'state', at: 1, state: { ...state, reservations: [{ ...state.reservations[0], prompt: 'secret' }] } }],
    ['bad price', { v: 1, kind: 'state', at: 1, state: { ...state, reservations: [{ ...state.reservations[0], priceVersions: { m: { id: 'v', price: { rate: 1 } } } }] } }],
  ] satisfies [string, unknown][]) assert.equal(validJournalRecord(item), false, label);
});

test('R-02 the journal appends one synced line per record, privately, and reads them back in order', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'saintpetrus-journal-')), 'data');
  try {
    const journal = new AccountingJournal(directory);
    assert.deepEqual(journal.open(), { records: [], droppedTornTail: false });
    journal.append({ v: 1, kind: 'state', at: 1, state }); journal.append({ v: 1, kind: 'period', at: 2, reason: 'operator' });
    const lines = (await readFile(journal.file, 'utf8')).split('\n');
    assert.equal(lines.length, 3); assert.equal(lines[2], '');
    if (process.platform !== 'win32') { assert.equal((await stat(directory)).mode & 0o777, 0o700); assert.equal((await stat(journal.file)).mode & 0o777, 0o600); }
    assert.deepEqual(new AccountingJournal(directory).open().records.map(item => item.kind), ['state', 'period']);
  } finally { await rm(join(directory, '..'), { recursive: true, force: true }); }
});

test('R-02 a record torn by a crash is dropped and cut; anything else unreadable is set aside, never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-journal-'));
  try {
    const journal = new AccountingJournal(directory);
    journal.append({ v: 1, kind: 'state', at: 1, state });
    await appendFile(journal.file, '{"v":1,"kind":"per');
    const torn = journal.open();
    assert.equal(torn.droppedTornTail, true); assert.equal(torn.records.length, 1);
    journal.append({ v: 1, kind: 'period', at: 3, reason: 'operator' });
    assert.deepEqual(new AccountingJournal(directory).open().records.map(item => item.kind), ['state', 'period'], 'the next record sits on its own line');
    const before = await readFile(journal.file, 'utf8');
    await writeFile(journal.file, `${before}{"v":1,"kind":"state","at":4,"state":{"rows":"edited by hand"}}\n`);
    const bad = journal.open(new Date('2026-09-28T01:02:03.004Z'));
    assert.deepEqual(bad.records, []); assert.equal(bad.rejectedAs, join(directory, 'accounting-rejected-2026-09-28T01-02-03-004Z.jsonl'));
    assert.deepEqual(await readdir(directory), ['accounting-rejected-2026-09-28T01-02-03-004Z.jsonl'], 'kept aside, and no new file until something is written');
    assert.match(await readFile(bad.rejectedAs!, 'utf8'), /edited by hand/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
