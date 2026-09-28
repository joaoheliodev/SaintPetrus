// The accounting journal (Round 3, R-02): one JSON record per line, appended and synced to disk before the change it
// records can have any effect, in the user data directory beside the graph. No complete record is ever rewritten.
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { validDurableState, type DurableState } from './accounting-state';
import type { Receipt } from './receipts';

export type PeriodReason = 'operator' | 'journal_unreadable';
export type JournalRecord =
  | { v: 1; kind: 'state'; at: number; state: DurableState }
  | { v: 1; kind: 'receipt'; at: number; receipt: Receipt }
  | { v: 1; kind: 'period'; at: number; reason: PeriodReason };
export type JournalOpen = { records: JournalRecord[]; rejectedAs?: string; droppedTornTail: boolean };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const receiptKinds = ['call', 'cache', 'expiry', 'manual'];
// Receipts are the server's own evidence records; the shape is checked for identity, time and kind.
const validReceipt = (value: unknown) => record(value) && receiptKinds.includes(String(value.kind)) && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0 && time(value.at) && typeof value.agent === 'string' && typeof value.requestedModel === 'string';
export function validJournalRecord(value: unknown): value is JournalRecord {
  if (!record(value) || value.v !== 1 || !time(value.at)) return false;
  const fields = Object.keys(value).sort().join(',');
  if (value.kind === 'state') return fields === 'at,kind,state,v' && validDurableState(value.state);
  if (value.kind === 'receipt') return fields === 'at,kind,receipt,v' && validReceipt(value.receipt);
  if (value.kind === 'period') return fields === 'at,kind,reason,v' && (value.reason === 'operator' || value.reason === 'journal_unreadable');
  return false;
}

export class AccountingJournal {
  constructor(readonly directory: string) {}
  get file() { return join(this.directory, 'accounting.jsonl'); }
  // Reads every record. A final line without its newline was being written when the process stopped: its change never took
  // effect, because nothing happens before the record is synced, so it is dropped. Anything else unreadable is kept aside
  // under a new name and the journal starts empty; the caller must then block real calls until the operator acts.
  open(now = new Date()): JournalOpen {
    if (!existsSync(this.file)) return { records: [], droppedTornTail: false };
    const text = readFileSync(this.file, 'utf8');
    const lines = text.split('\n');
    const tail = lines.pop() ?? '';
    const records: JournalRecord[] = [];
    let valid = true;
    for (const line of lines) {
      let value: unknown;
      try { value = JSON.parse(line); } catch { valid = false; break; }
      if (!validJournalRecord(value)) { valid = false; break; }
      records.push(value);
    }
    if (!valid) {
      const rejectedAs = join(this.directory, `accounting-rejected-${now.toISOString().replace(/[:.]/g, '-')}.jsonl`);
      renameSync(this.file, rejectedAs);
      return { records: [], rejectedAs, droppedTornTail: false };
    }
    // The torn bytes were never a complete record; cutting them keeps the next append on a line of its own.
    if (tail !== '') truncateSync(this.file, Buffer.byteLength(text, 'utf8') - Buffer.byteLength(tail, 'utf8'));
    return { records, droppedTornTail: tail !== '' };
  }
  append(entry: JournalRecord) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700);
    const fd = openSync(this.file, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify(entry)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    chmodSync(this.file, 0o600);
  }
}
