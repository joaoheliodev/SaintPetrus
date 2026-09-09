export type Usage = { prompt: number; completion: number; total: number };
export type RequestOptions = { onText?: (text: string) => void; systemPrompt: string; messages: { role: 'user' | 'assistant' | 'system'; content: string }[]; temperature: number; maxTokens: number };
export type Completion = { text: string; usage?: Usage };
export interface ProviderAdapter {
  readonly id: 'mock' | 'openai' | 'gemini';
  readonly model: string;
  complete(input: string, signal: AbortSignal, options?: RequestOptions): Promise<Completion>;
}
export class ProviderFailure extends Error {
  // 'unauthorized'/'not_found'/'rate_limited' are derived from the HTTP status class only.
  // No provider error body is ever read, echoed or logged.
  constructor(readonly code: 'unconfigured' | 'disabled' | 'invalid_request' | 'unauthorized' | 'not_found' | 'rate_limited' | 'upstream' | 'timeout' | 'cancelled' | 'busy') { super(code); }
}
// Maps only the status class. A rejected credential must be distinguishable from an outage,
// otherwise the UI cannot tell "your key is wrong" from "Google is down".
export function upstreamCode(status: number): 'unauthorized' | 'not_found' | 'rate_limited' | 'upstream' {
  if (status === 400 || status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}
