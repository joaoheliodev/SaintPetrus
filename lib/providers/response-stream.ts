import { ProviderFailure, type Completion } from './adapter';
import { redactText } from '../security/redact';
// Responses SSE decoding; provider metadata/errors never become artifact text.
export async function readResponseStream(response: Response, onText: (text: string) => void): Promise<Completion> {
  const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure('upstream');
  let pending = ''; let text = ''; let bytes = 0; let completion: Completion | undefined;
  const decoder = new TextDecoder();
  function frame(value: string) {
    const data = value.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { text += event.delta; onText(redactText(text)); }
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new ProviderFailure('upstream');
    if (event.type === 'response.completed') {
      const raw = event.response?.usage;
      completion = { text: redactText(text), ...(raw ? { usage: { prompt: raw.input_tokens, completion: raw.output_tokens, total: raw.total_tokens } } : {}) };
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 262144) throw new ProviderFailure('upstream');
      pending += decoder.decode(value, { stream: true });
      // Normalize complete CRLF sequences without losing a CR split between chunks.
      pending = pending.replace(/\r\n/g, '\n');
      let index: number;
      while ((index = pending.indexOf('\n\n')) >= 0) { frame(pending.slice(0, index)); pending = pending.slice(index + 2); }
    }
    pending += decoder.decode(); if (pending.trim()) frame(pending);
    if (!completion || !completion.text) throw new ProviderFailure('upstream');
    return completion;
  } finally { await reader.cancel(); }
}
