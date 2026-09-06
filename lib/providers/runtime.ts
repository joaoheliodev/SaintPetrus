import { credentials } from '../security/runtime';
import { mockEnabled } from '../server/runtime';
import { MockLLMAdapter } from './mock-provider';
import { OpenAIAdapter } from './openai';
import { ProviderFailure, type ProviderAdapter } from './adapter';
import { ProviderProxy } from './proxy';
const state = globalThis as typeof globalThis & { saintpetrusProxy?: ProviderProxy };
export const providerProxy = () => state.saintpetrusProxy ??= new ProviderProxy();
export function providerStatus() {
  const selected = process.env.SAINTPETRUS_PROVIDER ?? (mockEnabled() ? 'mock' : 'none');
  if (selected === 'mock') return { provider: 'mock', model: 'mock-v1', connected: mockEnabled(), mocked: true };
  if (selected === 'openai') return { provider: 'openai', model: process.env.SAINTPETRUS_MODEL ?? '', connected: credentials().status('openai').connected && !!process.env.SAINTPETRUS_MODEL, mocked: false };
  return { provider: 'none', model: '', connected: false, mocked: false };
}
export function configuredAdapter(): ProviderAdapter {
  const status = providerStatus();
  if (!status.connected) throw new ProviderFailure('unconfigured');
  if (status.provider === 'mock') return new MockLLMAdapter();
  if (status.provider === 'openai') return new OpenAIAdapter(status.model, credentials());
  throw new ProviderFailure('disabled');
}
