import type { ModelProvider } from '../providers/model-id';
export type JournalInterval = { models: string[]; from: number; to: number };
export type ReceiptUsage = { prompt: number; completion: number; total: number; cacheHit: number; cacheMiss: number; reasoning?: number };
type Identity = { id: number; at: number; agent: string; provider: ModelProvider; requestedModel: string; servedModel: string | null };
// One settled call: what was held, what came back and how it was priced. Numbers, identities and codes only.
export type CallReceipt = Identity & { kind: 'call'; reservationId: string; verdict: 'billed' | 'unbilled' | 'unverifiable'; outcome: string; mocked: boolean;
  requestedAt: number; priceVersionId: string; servedPriceVersionId: string | null; dispatch: { sequence: number; at: number } | null;
  reserved: { tokens: number; inputTokens: number; maxOutputTokens: number; costUsd: number };
  // Usage as reported (estimated for the mock) even when it could not be priced; cost, band and journal only once accounted.
  reportedUsage: ReceiptUsage | null; band: 'peak' | 'offPeak' | null; costUsd: number | null; journal: JournalInterval | null };
export type CacheReceipt = Identity & { kind: 'cache'; savedTokens: number };
export type ExpiryReceipt = Identity & { kind: 'expiry'; reservationId: string; tokens: number; heldCostUsd: number; costUsd: number };
export type ManualReceipt = Identity & { kind: 'manual'; reservationId: string; usage: { prompt: number; completion: number; total: number }; replacedCostUsd: number; costUsd: number; journal: JournalInterval | null };
export type Receipt = CallReceipt | CacheReceipt | ExpiryReceipt | ManualReceipt;
type Draft<T> = T extends unknown ? Omit<T, 'id'> : never;
// Bounded and append-only: the oldest receipt is evicted, never edited, and the eviction count is reported.
export class ReceiptJournal {
  private entries: Receipt[] = [];
  private sequence = 0;
  constructor(readonly capacity = 200) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid receipt capacity.');
  }
  append(draft: Draft<Receipt>): Receipt {
    const receipt: Receipt = { ...structuredClone(draft), id: ++this.sequence };
    this.entries = [receipt, ...this.entries].slice(0, this.capacity);
    return structuredClone(receipt);
  }
  // Rebuilds from journaled receipts in the order they were written; numbering continues after the highest one kept.
  restore(receipts: readonly Receipt[]) {
    this.entries = structuredClone(receipts.slice(-this.capacity)).reverse();
    this.sequence = Math.max(this.sequence, ...receipts.map(receipt => receipt.id));
  }
  snapshot() {
    return { capacity: this.capacity, total: this.sequence, evicted: this.sequence - this.entries.length, receipts: structuredClone(this.entries) };
  }
}
