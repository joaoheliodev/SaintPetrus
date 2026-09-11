import { redact } from '../security/redact';
import { eventTypes, isEventInput, type EventInput, type BusEvent, type EventBatch } from './types';
// Process-local, append-only sequence. Eviction removes old entries, never edits them.
export class EventBus {
  private entries: BusEvent[] = [];
  private cursor = 0;
  private prompt = 0;
  private completion = 0;
  private listeners = new Set<(event: BusEvent) => void>();
  constructor(readonly capacity = 500) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new Error('Invalid event capacity.');
  }
  publish(input: EventInput) {
    if (!eventTypes.includes(input.type)) throw new Error('Invalid event type.');
    if (input.tokens && ![input.tokens.prompt, input.tokens.completion].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid event tokens.');
    // Redact BEFORE truncation and storage: truncation must not turn a full key into a leaking fragment.
    const clean = redact(input, isEventInput);
    const event: BusEvent = { ...clean, payload: clean.payload.slice(0, 500), role: clean.role.slice(0, 100), id: ++this.cursor, timestamp: new Date().toISOString(), severity: clean.severity ?? 'info' };
    this.entries[(event.id - 1) % this.capacity] = structuredClone(event);
    this.prompt += event.tokens?.prompt ?? 0; this.completion += event.tokens?.completion ?? 0;
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* One consumer cannot interrupt producers or other consumers. */ }
    }
    return structuredClone(event);
  }
  snapshot(after = 0): EventBatch {
    return { events: structuredClone(this.entries.filter(event => event.id > after).sort((a, b) => a.id - b.id)), cursor: this.cursor, prompt: this.prompt, completion: this.completion, truncated: after > 0 && after < Math.max(1, this.cursor - this.capacity + 1) - 1 };
  }
  subscribe(listener: (event: BusEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
const state = globalThis as typeof globalThis & { saintpetrusEvents?: EventBus };
export const eventBus = () => state.saintpetrusEvents ??= new EventBus(Number(process.env.SAINTPETRUS_EVENT_CAPACITY ?? 500));
