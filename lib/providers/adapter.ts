export type Usage = { prompt: number; completion: number; total: number };
export type RequestOptions = { onText?: (text: string) => void; systemPrompt: string; messages: { role: 'user' | 'assistant' | 'system'; content: string }[]; temperature: number; maxTokens: number };
export type Completion = { text: string; usage?: Usage };
export interface ProviderAdapter {
  readonly id: 'mock' | 'openai';
  readonly model: string;
  complete(input: string, signal: AbortSignal, options?: RequestOptions): Promise<Completion>;
}
export class ProviderFailure extends Error {
  constructor(readonly code: 'unconfigured' | 'disabled' | 'invalid_request' | 'upstream' | 'timeout' | 'cancelled' | 'busy') { super(code); }
}
