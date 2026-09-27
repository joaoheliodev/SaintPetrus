import type { ModelProvider } from './model-id';
export type Dispatch = { sequence: number; provider: ModelProvider; model: string; correlationId: string | null; at: number };
// Requests that left this process for a provider, recorded immediately before transport. A refusal decided
// locally never appears here, which is what lets a hard stop be proven free of upstream calls. Process-local.
export class DispatchLedger {
  private sequence = 0;
  private counts = new Map<ModelProvider, number>();
  private recent: Dispatch[] = [];
  constructor(private readonly capacity = 50, private readonly now: () => number = Date.now) {}
  record(provider: ModelProvider, model: string, correlationId: string | null): Dispatch {
    const dispatch = { sequence: ++this.sequence, provider, model, correlationId, at: this.now() };
    this.counts.set(provider, (this.counts.get(provider) ?? 0) + 1);
    this.recent = [dispatch, ...this.recent].slice(0, this.capacity);
    return { ...dispatch };
  }
  count(provider: ModelProvider) { return this.counts.get(provider) ?? 0; }
  snapshot() {
    return { total: this.sequence, byProvider: Object.fromEntries(this.counts), recent: structuredClone(this.recent), capacity: this.capacity };
  }
}
