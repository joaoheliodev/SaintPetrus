import type { Credentials } from '../security/credentials';
import { redactText } from '../security/redact';
import { ProviderFailure, type Completion, type ProviderAdapter, type RequestOptions, type Usage } from './adapter';
import { ModelIdError, normalizeModelId } from './model-id';
import { thinkingCallValid } from './thinking-policy';
const endpoint = 'https://api.deepseek.com/chat/completions';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
// DeepSeek's 400 is a malformed request of ours, not a bad credential, and 402 means the account ran
// out of balance while the service is up and the key is valid. Neither may be reported as the other.
export function deepseekErrorCode(status: number): ProviderFailure['code'] {
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'insufficient_balance';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}
export function deepseekUsage(value: unknown): Usage {
  if (!record(value)) throw new ProviderFailure('upstream');
  const prompt = value.prompt_tokens, completion = value.completion_tokens, total = value.total_tokens;
  const cacheHit = value.prompt_cache_hit_tokens, cacheMiss = value.prompt_cache_miss_tokens;
  // The two input bands differ by orders of magnitude, so a missing split is never assumed to be
  // zero hits: an unrecognized shape stays unpriced and unresolved instead of being guessed.
  if (!integer(prompt) || !integer(completion) || !integer(total) || !integer(cacheHit) || !integer(cacheMiss)) throw new ProviderFailure('upstream');
  if (prompt + completion !== total || cacheHit + cacheMiss !== prompt) throw new ProviderFailure('upstream');
  // This schema is documented but unverified against a live account. Optional detail objects are
  // accepted only in the one shape we can reconcile, and contradicting counts fail closed.
  const completionDetails = value.completion_tokens_details;
  if (completionDetails !== undefined) {
    if (!record(completionDetails)) throw new ProviderFailure('upstream');
    const reasoning = completionDetails.reasoning_tokens;
    if (reasoning !== undefined && (!integer(reasoning) || reasoning > completion)) throw new ProviderFailure('upstream');
  }
  const promptDetails = value.prompt_tokens_details;
  if (promptDetails !== undefined) {
    if (!record(promptDetails)) throw new ProviderFailure('upstream');
    const cached = promptDetails.cached_tokens;
    if (cached !== undefined && (!integer(cached) || cached !== cacheHit)) throw new ProviderFailure('upstream');
  }
  return { prompt, completion, total, inputBreakdown: { cacheHit, cacheMiss } };
}
export class DeepSeekAdapter implements ProviderAdapter {
  readonly id = 'deepseek' as const;
  readonly model: string;
  constructor(model: string, private readonly credentials: Credentials, private readonly transport: typeof fetch = fetch) {
    try { this.model = normalizeModelId('deepseek', model); }
    catch (error) { if (error instanceof ModelIdError) throw new ProviderFailure('invalid_model_format'); throw error; }
  }
  async complete(input: string, signal: AbortSignal, options?: RequestOptions): Promise<Completion> {
    // Reasoning is on by default at high effort upstream, so an unstated thinking mode is refused
    // here rather than silently spending the whole output budget on a chain of thought.
    if (!options || !thinkingCallValid(this.id, options.thinking) || !options.thinking) throw new ProviderFailure('invalid_request');
    const thinking = options.thinking;
    return this.credentials.use('deepseek', async key => {
      try {
        const system = [options.systemPrompt, ...options.messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean).join('\n');
        const messages = [...(system ? [{ role: 'system', content: redactText(system) }] : []), ...options.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: redactText(m.content) }))];
        const response = await this.transport(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.toString('utf8')}` },
          body: JSON.stringify({ model: this.model, messages, max_tokens: options.maxTokens, temperature: options.temperature, stream: false,
            ...(thinking.mode === 'disabled' ? { thinking: { type: 'disabled' } } : { reasoning_effort: thinking.effort }) }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure(deepseekErrorCode(response.status)); }
        const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure('upstream');
        let body = ''; let bytes = 0; const decoder = new TextDecoder();
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 262144) throw new ProviderFailure('upstream'); body += decoder.decode(value, { stream: true }); }
        } finally { await reader.cancel(); }
        const payload: unknown = JSON.parse(body + decoder.decode());
        if (!record(payload)) throw new ProviderFailure('upstream');
        const usage = deepseekUsage(payload.usage);
        if (!Array.isArray(payload.choices) || payload.choices.length !== 1 || !record(payload.choices[0])) throw new ProviderFailure('upstream');
        const choice = payload.choices[0];
        if (!record(choice.message)) throw new ProviderFailure('upstream');
        // `message.reasoning_content` is deliberately never read: the chain of thought can restate
        // the whole prompt and must not reach text, events, artifacts or the cache.
        const content = choice.message.content;
        if (content !== null && content !== undefined && typeof content !== 'string') throw new ProviderFailure('upstream');
        const text = redactText(content ?? '');
        let billingModel: string;
        try { billingModel = normalizeModelId(this.id, payload.model); }
        catch { throw new ProviderFailure('upstream'); }
        // A response that spent the output budget was billed and must reconcile, but it proves nothing.
        const outcome: Completion['outcome'] = text === '' && choice.finish_reason === 'length' ? 'output_limit' : undefined;
        return { text, usage, billingModel, ...(outcome ? { outcome } : {}) };
      } catch (error) {
        if (signal.aborted) throw new ProviderFailure('cancelled');
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('upstream');
      }
    });
  }
}
