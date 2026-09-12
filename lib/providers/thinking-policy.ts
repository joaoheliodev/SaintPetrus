import type { ThinkingControl } from './adapter';
import type { ModelProvider } from './model-id';
export type ThinkingEffort = Extract<ThinkingControl, { mode: 'enabled' }>['effort'];
// What each provider can express, in one table instead of a literal per adapter.
// `policyMustDeclare`: the local model policy has to state the mode, so no model runs on whatever
// the provider happens to default to. `callMustDeclare`: the adapter refuses a request that does
// not state it, because the provider reasons by default and would spend the whole output budget
// before returning any content. `efforts` is empty when only an explicit disable is expressible.
export type ThinkingSupport = { policyMustDeclare: boolean; callMustDeclare: boolean; efforts: readonly ThinkingEffort[] };
export const thinkingSupport: Record<ModelProvider, ThinkingSupport> = {
  mock: { policyMustDeclare: false, callMustDeclare: false, efforts: [] },
  openai: { policyMustDeclare: false, callMustDeclare: false, efforts: ['minimal', 'low', 'high', 'max'] },
  gemini: { policyMustDeclare: true, callMustDeclare: false, efforts: [] },
  deepseek: { policyMustDeclare: true, callMustDeclare: true, efforts: ['low', 'high', 'max'] },
};
const expressible = (provider: ModelProvider, thinking: ThinkingControl) => thinking.mode === 'disabled' || thinkingSupport[provider].efforts.includes(thinking.effort);
export function thinkingPolicyValid(provider: ModelProvider, thinking: ThinkingControl | undefined) {
  return thinking === undefined ? !thinkingSupport[provider].policyMustDeclare : expressible(provider, thinking);
}
export function thinkingCallValid(provider: ModelProvider, thinking: ThinkingControl | undefined) {
  return thinking === undefined ? !thinkingSupport[provider].callMustDeclare : expressible(provider, thinking);
}
