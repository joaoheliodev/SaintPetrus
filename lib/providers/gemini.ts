import type { Credentials } from '../security/credentials';
import { redactText } from '../security/redact';
import { ProviderFailure, upstreamCode, type ProviderAdapter, type RequestOptions, type Usage } from './adapter';
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function geminiUsage(value: unknown): Usage {
  if (!value || typeof value !== 'object') throw new ProviderFailure('upstream');
  const raw = value as Record<string, unknown>;
  const prompt = raw.promptTokenCount; const candidates = raw.candidatesTokenCount ?? 0; const thoughts = raw.thoughtsTokenCount ?? 0;
  const total = raw.totalTokenCount;
  if (!integer(prompt) || !integer(candidates) || !integer(thoughts) || !integer(total)) throw new ProviderFailure('upstream');
  // Google: total = prompt + thoughts + candidates. Thinking is billed at the output rate.
  // Cached tokens are already included in promptTokenCount; never add them again.
  // The existing price contract cannot price caching/tools: reject unsupported accounting, never silently misprice it.
  if ((raw.cachedContentTokenCount ?? 0) !== 0 || (raw.toolUsePromptTokenCount ?? 0) !== 0) throw new ProviderFailure('upstream');
  const completion = candidates + thoughts;
  if (!Number.isSafeInteger(completion) || prompt + completion !== total) throw new ProviderFailure('upstream');
  return { prompt, completion, total };
}
export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const;
  constructor(readonly model: string, private readonly credentials: Credentials, private readonly transport: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new ProviderFailure('unconfigured');
  }
  async complete(input: string, signal: AbortSignal, options?: RequestOptions) {
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
            ...(this.model === 'gemini-2.5-flash-lite' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          } }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure(upstreamCode(response.status)); }
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
        // Preserve valid usage even when safety filtering/max-output yields no visible text.
        return { text, usage };
      } catch (error) {
        if (signal.aborted) throw new ProviderFailure('cancelled');
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('upstream');
      }
    });
  }
}
