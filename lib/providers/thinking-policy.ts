import type { ThinkingControl } from './adapter';
import type { ModelProvider } from './model-id';
export type ThinkingEffort = Extract<ThinkingControl, { mode: 'enabled' }>['effort'];
// What each provider can express, in one table instead of a literal per adapter.
// `policyMustDeclare`: the local model policy has to state the mode, so no model runs on whatever
// the provider happens to default to. `callMustDeclare`: the adapter refuses a request that does
// not state it, because the provider reasons by default and would spend the whole output budget
// before returning any content. `efforts` is empty when only an explicit disable is expressible.
// `canDisable` is whether the wire protocol has an off switch at all. Omitting a reasoning field is
// not an off switch: it hands the choice back to the provider default, which is what this avoids.
export type ThinkingSupport = { policyMustDeclare: boolean; callMustDeclare: boolean; canDisable: boolean; efforts: readonly ThinkingEffort[] };
export const thinkingSupport: Record<ModelProvider, ThinkingSupport> = {
  mock: { canDisable: false, policyMustDeclare: false, callMustDeclare: false, efforts: [] },
  openai: { canDisable: false, policyMustDeclare: false, callMustDeclare: false, efforts: ['minimal', 'low', 'high', 'max'] },
  gemini: { canDisable: true, policyMustDeclare: true, callMustDeclare: false, efforts: [] },
  deepseek: { canDisable: true, policyMustDeclare: true, callMustDeclare: true, efforts: ['low', 'high', 'max'] },
};
const expressible = (provider: ModelProvider, thinking: ThinkingControl) => thinking.mode === 'disabled' || thinkingSupport[provider].efforts.includes(thinking.effort);
export function thinkingPolicyValid(provider: ModelProvider, thinking: ThinkingControl | undefined) {
  return thinking === undefined ? !thinkingSupport[provider].policyMustDeclare : expressible(provider, thinking);
}
export function thinkingCallValid(provider: ModelProvider, thinking: ThinkingControl | undefined) {
  return thinking === undefined ? !thinkingSupport[provider].callMustDeclare : expressible(provider, thinking);
}
// A connection probe only has to prove the credential works. Where reasoning can be switched off it
// is switched off, so the probe cannot spend its whole output budget thinking and return no text.
// Where it cannot, the policy stands: omitting the field would fall back to a costlier default.
export const verificationThinking = (provider: ModelProvider, policy: ThinkingControl | undefined) =>
  thinkingSupport[provider].canDisable ? { mode: 'disabled' } as const : policy;
