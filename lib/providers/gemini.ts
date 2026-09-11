import type { Credentials } from '../security/credentials';
import { redactText } from '../security/redact';
import { ProviderFailure, type Completion, type ProviderAdapter, type RequestOptions, type Usage } from './adapter';
import { ModelIdError, normalizeModelId } from './model-id';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function geminiErrorCode(status: number): ProviderFailure['code'] {
  if (status === 400 || status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}
export function geminiUsage(value: unknown): Usage {
  if (!value || typeof value !== 'object') throw new ProviderFailure('upstream');
  const raw = value as Record<string, unknown>;
  const prompt = raw.promptTokenCount; const candidates = raw.candidatesTokenCount ?? 0; const thoughts = raw.thoughtsTokenCount ?? 0; const cached = raw.cachedContentTokenCount ?? 0;
  const total = raw.totalTokenCount;
  if (!integer(prompt) || !integer(candidates) || !integer(thoughts) || !integer(cached) || !integer(total) || cached > prompt) throw new ProviderFailure('upstream');
  // Google: total = prompt + thoughts + candidates. Thinking is billed at the output rate.
  // Cached tokens are already included in promptTokenCount; never add them again.
  // Cached prompt tokens use the full input rate as a conservative estimate. Tool pricing is
  // still unsupported and therefore fails closed instead of being silently mispriced.
  if ((raw.toolUsePromptTokenCount ?? 0) !== 0) throw new ProviderFailure('upstream');
  const completion = candidates + thoughts;
  if (!Number.isSafeInteger(completion) || prompt + completion !== total) throw new ProviderFailure('upstream');
  return { prompt, completion, total, ...(cached > 0 ? { cachedPromptFullRate: cached, inputBreakdown: { cacheHit: cached, cacheMiss: prompt - cached } } : {}) };
}
export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const;
  readonly model: string;
  constructor(model: string, private readonly credentials: Credentials, private readonly transport: typeof fetch = fetch) {
    try { this.model = normalizeModelId('gemini', model); }
    catch (error) { if (error instanceof ModelIdError) throw new ProviderFailure('invalid_model_format'); throw error; }
  }
  async complete(input: string, signal: AbortSignal, options?: RequestOptions) {
    if (options?.thinking?.mode === 'enabled') throw new ProviderFailure('invalid_request');
    return this.credentials.use('gemini', async key => {
      try {
        const messages = options?.messages ?? [{ role: 'user' as const, content: input }];
        const system = [options?.systemPrompt ?? '', ...messages.filter(m => m.role === 'system').map(m => m.content)].filter(Boolean).join('\n');
        const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: redactText(m.content) }] }));
        const response = await this.transport(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.toString('utf8') },
          body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: redactText(system) }] } } : {}), generationConfig: {
            candidateCount: 1, maxOutputTokens: options?.maxTokens ?? 64, temperature: options?.temperature ?? 0,
            ...(options?.thinking?.mode === 'disabled' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          } }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure(geminiErrorCode(response.status)); }
        const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure('upstream');
        let body = ''; let bytes = 0; const decoder = new TextDecoder();
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 262144) throw new ProviderFailure('upstream'); body += decoder.decode(value, { stream: true }); }
        } finally { await reader.cancel(); }
        const payload = JSON.parse(body + decoder.decode()); const usage = geminiUsage(payload.usageMetadata);
        const candidate = payload.candidates?.[0];
        if (payload.candidates && (!Array.isArray(payload.candidates) || payload.candidates.length > 1)) throw new ProviderFailure('upstream');
        const parts = candidate?.content?.parts ?? [];
        if (!Array.isArray(parts)) throw new ProviderFailure('upstream');
        const text = redactText(parts.filter((p: { thought?: boolean; text?: unknown }) => !p.thought && typeof p.text === 'string').map((p: { text: string }) => p.text).join(''));
        // A max-output response was billed and must reconcile, but it is not a successful probe.
        const outcome: Completion['outcome'] = text === '' && candidate?.finishReason === 'MAX_TOKENS' ? 'output_limit' : undefined;
        return { text, usage, ...(outcome ? { outcome } : {}) };
      } catch (error) {
        if (signal.aborted) throw new ProviderFailure('cancelled');
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('upstream');
      }
    });
  }
}
