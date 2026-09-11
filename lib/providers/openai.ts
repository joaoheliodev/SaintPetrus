import { readResponseStream } from './response-stream';
import type { Credentials } from '../security/credentials';
import { redactText } from '../security/redact';
import { ProviderFailure, type ProviderAdapter, type RequestOptions } from './adapter';
import { ModelIdError, normalizeModelId } from './model-id';
const endpoint = 'https://api.openai.com/v1/responses';
export function openAIErrorCode(status: number): ProviderFailure['code'] {
  if (status === 400 || status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}
export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai' as const;
  readonly model: string;
  constructor(model: string, private readonly credentials: Credentials, private readonly transport: typeof fetch = fetch) {
    try { this.model = normalizeModelId('openai', model); }
    catch (error) { if (error instanceof ModelIdError) throw new ProviderFailure('invalid_model_format'); throw error; }
  }
  async complete(input: string, signal: AbortSignal, options?: RequestOptions) {
    return this.credentials.use('openai', async key => {
      try {
        const generation = options?.thinking?.mode === 'enabled' ? { reasoning: { effort: options.thinking.effort } } : options ? { temperature: options.temperature } : {};
        const response = await this.transport(endpoint, { method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.toString('utf8')}` },
          body: JSON.stringify({ model: this.model, input: options?.messages ?? redactText(input), ...(options ? { instructions: options.systemPrompt } : {}), ...generation, max_output_tokens: options?.maxTokens ?? 64, store: false, stream: !!options?.onText }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new ProviderFailure(openAIErrorCode(response.status)); }
        if (response.headers.get('content-type')?.includes('text/event-stream') && options?.onText) return await readResponseStream(response, options.onText);
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
