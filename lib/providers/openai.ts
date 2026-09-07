import type { Credentials } from '../security/credentials';
import { redactText } from '../security/redact';
import { ProviderFailure, type ProviderAdapter, type RequestOptions } from './adapter';
const endpoint = 'https://api.openai.com/v1/responses';
export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai' as const;
  constructor(readonly model: string, private readonly credentials: Credentials, private readonly transport: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new ProviderFailure('unconfigured');
  }
  async complete(input: string, signal: AbortSignal, options?: RequestOptions) {
    return this.credentials.use('openai', async key => {
      try {
        const response = await this.transport(endpoint, { method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.toString('utf8')}` },
          // GPT-5 nano rejects temperature; minimal reasoning keeps the connection probe small.
          // Other models retain their configured sampling policy. Availability needs a live test.
          body: JSON.stringify({ model: this.model, input: options?.messages ?? redactText(input), ...(options ? { instructions: options.systemPrompt } : {}), ...(this.model === 'gpt-5-nano' ? { reasoning: { effort: 'minimal' } } : options ? { temperature: options.temperature } : {}), max_output_tokens: options?.maxTokens ?? 64, store: false, stream: false }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure('upstream'); }
        // Bounded response reader. No SDK logging or raw provider error passthrough.
        const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure('upstream');
        let body = ''; let bytes = 0; const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 262144) { await reader.cancel(); throw new ProviderFailure('upstream'); }
          body += decoder.decode(value, { stream: true });
        }
        const payload = JSON.parse(body + decoder.decode());
        if (!Array.isArray(payload.output)) throw new ProviderFailure('upstream');
        const texts: string[] = [];
        for (const item of payload.output) {
          if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
          for (const part of item.content) if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
        }
        if (!texts.length) throw new ProviderFailure('upstream');
        const raw = payload.usage;
        const usage = raw ? { prompt: raw.input_tokens, completion: raw.output_tokens, total: raw.total_tokens } : undefined;
        return { text: redactText(texts.join('\n')), usage };
      } catch (error) {
        if (signal.aborted) throw new ProviderFailure('cancelled');
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('upstream');
      }
    });
  }
}
