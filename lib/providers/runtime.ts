import { GeminiAdapter } from './gemini';
import { DeepSeekAdapter } from './deepseek';
import { credentials } from '../security/runtime';
import { mockEnabled } from '../server/runtime';
import { MockLLMAdapter } from './mock-provider';
import { OpenAIAdapter } from './openai';
import { ProviderFailure, type ProviderAdapter } from './adapter';
import { DEFAULT_PROVIDER_TIMEOUT_MS, ProviderProxy } from './proxy';
import { isModelProvider, ModelIdError, normalizeModelId, type ModelProvider } from './model-id';
import type { Credentials } from '../security/credentials';
// Every provider except the synthetic one authenticates with a stored credential.
export type KeyedProvider = Exclude<ModelProvider, 'mock'>;
export type ConnectionState = 'disconnected' | 'configured' | 'verified' | 'rejected' | 'incomplete';
export type ProviderStatusSnapshot = { provider: string; model: string; connected: boolean; mocked: boolean; mockAvailable: boolean; verified: boolean; verifiedAt?: number; failureCode?: string; state: ConnectionState; validationTimeoutMs?: number; remembered?: boolean };
const keyedProvider = (value: unknown): value is KeyedProvider => isModelProvider(value) && value !== 'mock';
const adapters: Record<KeyedProvider, new (model: string, credentials: Credentials) => ProviderAdapter> = { gemini: GeminiAdapter, openai: OpenAIAdapter, deepseek: DeepSeekAdapter };
type ModelAllowlist = Readonly<Record<string, { provider: ModelProvider }>>;
export type ValidatedSelection = { provider: ModelProvider; model: string };
// A verification is a fact about one (provider, model) pair that was proved by a real call.
// It is never inferred from the presence of a credential and never survives a credential change.
type Verification = { provider: string; model: string; ok: boolean; at: number; code?: string };
const state = globalThis as typeof globalThis & { saintpetrusProxy?: ProviderProxy; saintpetrusTimeoutPin?: { ms: number | undefined }; saintpetrusSelection?: { provider: string; model: string }; saintpetrusVerification?: Verification };
// Startup-only validation aid: a shorter proxy timeout forces the lost-contact path against a real provider. It is
// never read from a request, and it applies inside the proxy, after preflight has already reserved the call.
export function validationTimeoutMs(value = process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) >= DEFAULT_PROVIDER_TIMEOUT_MS) throw new Error(`SAINTPETRUS_VALIDATION_TIMEOUT_MS must be an integer from 1 to ${DEFAULT_PROVIDER_TIMEOUT_MS - 1}.`);
  return Number(value);
}
// Read once per process. The custom server pins it at startup as plain data and never builds the proxy: it runs its own
// copy of these modules, and a proxy built there would reach the routes with classes from the wrong copy.
export function pinnedValidationTimeoutMs() { return (state.saintpetrusTimeoutPin ??= { ms: validationTimeoutMs() }).ms; }
export const providerProxy = () => state.saintpetrusProxy ??= new ProviderProxy(pinnedValidationTimeoutMs() ?? DEFAULT_PROVIDER_TIMEOUT_MS);
export function clearVerification() { state.saintpetrusVerification = undefined; }
export function recordVerification(ok: boolean, code?: string) {
  const { provider, model } = providerStatus();
  state.saintpetrusVerification = { provider, model, ok, at: Date.now(), code };
}
export function providerStatus(): ProviderStatusSnapshot {
  const mockAvailable = mockEnabled();
  const selected = state.saintpetrusSelection?.provider ?? process.env.SAINTPETRUS_PROVIDER ?? (mockAvailable ? 'mock' : 'none');
  const base = (() => {
    if (selected === 'mock') return { provider: 'mock', model: 'mock-v1', connected: mockAvailable, mocked: true };
    if (keyedProvider(selected)) { const model = state.saintpetrusSelection?.model ?? process.env.SAINTPETRUS_MODEL ?? ''; const stored = credentials().status(selected); return { provider: selected, model, connected: stored.connected && !!model, mocked: false, remembered: stored.remembered }; }
    return { provider: 'none', model: '', connected: false, mocked: false };
  })();
  // A stale verification must never be shown as current: it only counts for the exact pair it proved.
  const proof = state.saintpetrusVerification;
  const current = proof && proof.provider === base.provider && proof.model === base.model ? proof : undefined;
  // Billed but without usable output: the provider answered, yet nothing was proved.
  const incomplete = current?.code === 'output_limit' || current?.code === 'empty_output';
  const state_: ConnectionState = !base.connected ? 'disconnected' : incomplete ? 'incomplete' : current?.ok ? 'verified' : current ? 'rejected' : 'configured';
  const { timeoutMs } = providerProxy();
  return { ...base, mockAvailable, verified: current?.ok === true, verifiedAt: current?.ok ? current.at : undefined, failureCode: current && !current.ok ? current.code : undefined, state: state_, ...(timeoutMs === DEFAULT_PROVIDER_TIMEOUT_MS ? {} : { validationTimeoutMs: timeoutMs }) };
}
export function configuredAdapter(): ProviderAdapter {
  const status = providerStatus();
  if (!status.connected) throw new ProviderFailure('unconfigured');
  if (status.provider === 'mock') return new MockLLMAdapter();
  if (keyedProvider(status.provider)) return new adapters[status.provider](status.model, credentials());
  throw new ProviderFailure('disabled');
}

export function validateSelection(provider: unknown, model: unknown, models: ModelAllowlist): ValidatedSelection {
  if (provider === 'mock' && mockEnabled() && model === 'mock-v1') return { provider, model };
  if (!keyedProvider(provider)) throw new ProviderFailure('invalid_request');
  let normalized: string;
  try { normalized = normalizeModelId(provider, model); }
  catch (error) { if (error instanceof ModelIdError) throw new ProviderFailure('invalid_model_format'); throw error; }
  const configured = models[normalized];
  if (!configured || configured.provider !== provider) throw new ProviderFailure('model_not_allowlisted');
  return { provider, model: normalized };
}
export function selectProvider(selection: ValidatedSelection) { clearVerification(); state.saintpetrusSelection = selection; }
export function clearSelection() { clearVerification(); state.saintpetrusSelection = { provider: 'none', model: '' }; }
