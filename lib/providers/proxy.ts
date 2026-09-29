import { ProviderFailure, type ProviderAdapter, type RequestOptions } from './adapter';
import { heuristicTokenCounter, type TokenCounter } from '../core/token-estimate';
import { redactText } from '../security/redact';
import { DispatchLedger, type Dispatch } from './dispatch-ledger';
// `correlationId` ties an upstream dispatch to the caller's record (the reservation) without carrying any payload.
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;
export type DispatchTrace = { correlationId?: string; onDispatch?: (dispatch: Dispatch) => void };
export class ProviderProxy {
  private active = false;
  private controller?: AbortController;
  readonly dispatches = new DispatchLedger();
  cancel() { this.controller?.abort(); }
  constructor(readonly timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, private readonly tokenCounter: TokenCounter = heuristicTokenCounter) {}
  async execute(adapter: ProviderAdapter, input: unknown, parentSignal: AbortSignal, options?: RequestOptions, trace?: DispatchTrace) {
    if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new ProviderFailure('invalid_request');
    if (this.active) throw new ProviderFailure('busy');
    this.active = true;
    const controller = new AbortController(); this.controller = controller; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const cancel = () => controller.abort(); parentSignal.addEventListener('abort', cancel, { once: true });
    if (parentSignal.aborted) controller.abort();
    const started = performance.now();
    try {
      controller.signal.throwIfAborted();
      const sanitized = redactText(input);
      const preflight = { tokens: this.tokenCounter.count(sanitized), approximate: this.tokenCounter.approximate, counterName: this.tokenCounter.name };
      const result = await adapter.complete(sanitized, controller.signal, options, () => {
        const dispatch = this.dispatches.record(adapter.id, adapter.model, trace?.correlationId ?? null);
        trace?.onDispatch?.(dispatch);
      });
      controller.signal.throwIfAborted();
      return { usage: result.usage, preflight, provider: adapter.id, model: adapter.model, billingModel: result.billingModel ?? (adapter.id === 'mock' ? adapter.model : undefined), mocked: adapter.id === 'mock', text: redactText(result.text), latencyMs: Math.round(performance.now() - started), ...(result.outcome ? { outcome: result.outcome } : {}) };
    } catch (error) {
      if (timedOut) throw new ProviderFailure('timeout');
      if (controller.signal.aborted) throw new ProviderFailure('cancelled');
      throw ProviderFailure.is(error) ? error : new ProviderFailure('upstream');
    } finally { clearTimeout(timer); parentSignal.removeEventListener('abort', cancel); this.active = false; this.controller = undefined; }
  }
}
