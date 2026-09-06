export type Completion = { text: string };
export interface ProviderAdapter {
  readonly id: 'mock' | 'openai';
  readonly model: string;
  complete(input: string, signal: AbortSignal): Promise<Completion>;
}
export class ProviderFailure extends Error {
  constructor(readonly code: 'unconfigured' | 'disabled' | 'invalid_request' | 'upstream' | 'timeout' | 'cancelled' | 'busy') { super(code); }
}
