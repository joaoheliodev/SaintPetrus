import { ProviderFailure, type ProviderAdapter, type RequestOptions } from './adapter';
import { heuristicTokenCounter, type TokenCounter } from '../core/token-estimate';
import { redactText } from '../security/redact';
export class ProviderProxy {
  private active = false;
  private controller?: AbortController;
  cancel() { this.controller?.abort(); }
  constructor(private readonly timeoutMs = 15000, private readonly tokenCounter: TokenCounter = heuristicTokenCounter) {}
  async execute(adapter: ProviderAdapter, input: unknown, parentSignal: AbortSignal, options?: RequestOptions) {
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
      const result = await adapter.complete(sanitized, controller.signal, options);
      controller.signal.throwIfAborted();
      return { usage: result.usage, preflight, provider: adapter.id, model: adapter.model, mocked: adapter.id === 'mock', text: redactText(result.text), latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      if (timedOut) throw new ProviderFailure('timeout');
      if (controller.signal.aborted) throw new ProviderFailure('cancelled');
      throw error instanceof ProviderFailure ? error : new ProviderFailure('upstream');
    } finally { clearTimeout(timer); parentSignal.removeEventListener('abort', cancel); this.active = false; this.controller = undefined; }
  }
}
