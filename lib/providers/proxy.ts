import { ProviderFailure, type ProviderAdapter } from './adapter';
import { redactText } from '../security/redact';
export class ProviderProxy {
  private active = false;
  constructor(private readonly timeoutMs = 15000) {}
  async execute(adapter: ProviderAdapter, input: unknown, parentSignal: AbortSignal) {
    if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new ProviderFailure('invalid_request');
    if (this.active) throw new ProviderFailure('busy');
    this.active = true;
    const controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const cancel = () => controller.abort(); parentSignal.addEventListener('abort', cancel, { once: true });
    if (parentSignal.aborted) controller.abort();
    const started = performance.now();
    try {
      controller.signal.throwIfAborted();
      const result = await adapter.complete(redactText(input), controller.signal);
      return { provider: adapter.id, model: adapter.model, mocked: adapter.id === 'mock', text: redactText(result.text), latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      if (timedOut) throw new ProviderFailure('timeout');
      if (controller.signal.aborted) throw new ProviderFailure('cancelled');
      throw error instanceof ProviderFailure ? error : new ProviderFailure('upstream');
    } finally { clearTimeout(timer); parentSignal.removeEventListener('abort', cancel); this.active = false; }
  }
}
