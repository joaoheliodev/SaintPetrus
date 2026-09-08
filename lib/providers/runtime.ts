import { GeminiAdapter } from './gemini';
import { credentials } from '../security/runtime';
import { mockEnabled } from '../server/runtime';
import { MockLLMAdapter } from './mock-provider';
import { OpenAIAdapter } from './openai';
import { ProviderFailure, type ProviderAdapter } from './adapter';
import { ProviderProxy } from './proxy';
const state = globalThis as typeof globalThis & { saintpetrusProxy?: ProviderProxy; saintpetrusSelection?: { provider: string; model: string } };
export const providerProxy = () => state.saintpetrusProxy ??= new ProviderProxy();
export function providerStatus() {
  const selected = state.saintpetrusSelection?.provider ?? process.env.SAINTPETRUS_PROVIDER ?? (mockEnabled() ? 'mock' : 'none');
  if (selected === 'mock') return { provider: 'mock', model: 'mock-v1', connected: mockEnabled(), mocked: true };
  if (selected === 'openai' || selected === 'gemini') { const model = state.saintpetrusSelection?.model ?? process.env.SAINTPETRUS_MODEL ?? ''; return { provider: selected, model, connected: credentials().status(selected).connected && !!model, mocked: false }; }
  return { provider: 'none', model: '', connected: false, mocked: false };
}
export function configuredAdapter(): ProviderAdapter {
  const status = providerStatus();
  if (!status.connected) throw new ProviderFailure('unconfigured');
  if (status.provider === 'mock') return new MockLLMAdapter();
  if (status.provider === 'gemini') return new GeminiAdapter(status.model, credentials());
  if (status.provider === 'openai') return new OpenAIAdapter(status.model, credentials());
  throw new ProviderFailure('disabled');
}

export function validateSelection(provider: unknown, model: unknown) {
  if (provider === 'mock' && mockEnabled() && model === 'mock-v1') return;
  if ((provider !== 'openai' && provider !== 'gemini') || typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new ProviderFailure('invalid_request');
}
export function selectProvider(provider: string, model: string) { validateSelection(provider, model); state.saintpetrusSelection = { provider, model }; }
export function clearSelection() { state.saintpetrusSelection = { provider: 'none', model: '' }; }
