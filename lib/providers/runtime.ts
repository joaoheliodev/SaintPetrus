import { GeminiAdapter } from './gemini';
import { credentials } from '../security/runtime';
import { mockEnabled } from '../server/runtime';
import { MockLLMAdapter } from './mock-provider';
import { OpenAIAdapter } from './openai';
import { ProviderFailure, type ProviderAdapter } from './adapter';
import { ProviderProxy } from './proxy';
import { ModelIdError, normalizeModelId, type ModelProvider } from './model-id';
type ModelAllowlist = Readonly<Record<string, { provider: ModelProvider }>>;
export type ValidatedSelection = { provider: ModelProvider; model: string };
// A verification is a fact about one (provider, model) pair that was proved by a real call.
// It is never inferred from the presence of a credential and never survives a credential change.
type Verification = { provider: string; model: string; ok: boolean; at: number; code?: string };
const state = globalThis as typeof globalThis & { saintpetrusProxy?: ProviderProxy; saintpetrusSelection?: { provider: string; model: string }; saintpetrusVerification?: Verification };
export const providerProxy = () => state.saintpetrusProxy ??= new ProviderProxy();
export function clearVerification() { state.saintpetrusVerification = undefined; }
export function recordVerification(ok: boolean, code?: string) {
  const { provider, model } = providerStatus();
  state.saintpetrusVerification = { provider, model, ok, at: Date.now(), code };
}
export function providerStatus() {
  const selected = state.saintpetrusSelection?.provider ?? process.env.SAINTPETRUS_PROVIDER ?? (mockEnabled() ? 'mock' : 'none');
  const base = (() => {
    if (selected === 'mock') return { provider: 'mock', model: 'mock-v1', connected: mockEnabled(), mocked: true };
    if (selected === 'openai' || selected === 'gemini') { const model = state.saintpetrusSelection?.model ?? process.env.SAINTPETRUS_MODEL ?? ''; return { provider: selected, model, connected: credentials().status(selected).connected && !!model, mocked: false }; }
    return { provider: 'none', model: '', connected: false, mocked: false };
  })();
  // A stale verification must never be shown as current: it only counts for the exact pair it proved.
  const proof = state.saintpetrusVerification;
  const current = proof && proof.provider === base.provider && proof.model === base.model ? proof : undefined;
  const state_ = !base.connected ? 'disconnected' : current?.code === 'output_limit' ? 'incomplete' : current?.ok ? 'verified' : current ? 'rejected' : 'configured';
  return { ...base, verified: current?.ok === true, verifiedAt: current?.ok ? current.at : undefined, failureCode: current && !current.ok ? current.code : undefined, state: state_ };
}
export function configuredAdapter(): ProviderAdapter {
  const status = providerStatus();
  if (!status.connected) throw new ProviderFailure('unconfigured');
  if (status.provider === 'mock') return new MockLLMAdapter();
  if (status.provider === 'gemini') return new GeminiAdapter(status.model, credentials());
  if (status.provider === 'openai') return new OpenAIAdapter(status.model, credentials());
  throw new ProviderFailure('disabled');
}

export function validateSelection(provider: unknown, model: unknown, models: ModelAllowlist): ValidatedSelection {
  if (provider === 'mock' && mockEnabled() && model === 'mock-v1') return { provider, model };
  if (provider !== 'openai' && provider !== 'gemini') throw new ProviderFailure('invalid_request');
  let normalized: string;
  try { normalized = normalizeModelId(provider, model); }
  catch (error) { if (error instanceof ModelIdError) throw new ProviderFailure('invalid_model_format'); throw error; }
  const configured = models[normalized];
  if (!configured || configured.provider !== provider) throw new ProviderFailure('model_not_allowlisted');
  return { provider, model: normalized };
}
export function selectProvider(selection: ValidatedSelection) { clearVerification(); state.saintpetrusSelection = selection; }
export function clearSelection() { clearVerification(); state.saintpetrusSelection = { provider: 'none', model: '' }; }
