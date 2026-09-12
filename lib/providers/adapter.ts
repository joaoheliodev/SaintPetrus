import type { ModelProvider } from './model-id';
export type InputBreakdown = { cacheHit: number; cacheMiss: number };
export type Usage = { prompt: number; completion: number; total: number; cachedPromptFullRate?: number; inputBreakdown?: InputBreakdown };
export type ThinkingControl = { mode: 'disabled' } | { mode: 'enabled'; effort: 'minimal' | 'low' | 'high' | 'max' };
export type RequestOptions = { onText?: (text: string) => void; systemPrompt: string; messages: { role: 'user' | 'assistant' | 'system'; content: string }[]; temperature: number; maxTokens: number; thinking?: ThinkingControl };
// `billingModel` is what the provider says it served. It is the pricing key, because a provider
// may reroute a request to another model and bill at that model's rate.
export type Completion = { text: string; usage?: Usage; outcome?: 'output_limit'; billingModel?: string };
export interface ProviderAdapter {
  readonly id: ModelProvider;
  readonly model: string;
  complete(input: string, signal: AbortSignal, options?: RequestOptions): Promise<Completion>;
}
export class ProviderFailure extends Error {
  // Adapters translate their own HTTP semantics into this shared vocabulary. Provider error
  // bodies are never read, echoed or logged.
  constructor(readonly code: 'unconfigured' | 'disabled' | 'invalid_request' | 'invalid_model_format' | 'model_not_allowlisted' | 'unauthorized' | 'insufficient_balance' | 'not_found' | 'rate_limited' | 'upstream' | 'timeout' | 'cancelled' | 'busy') { super(code); }
}
