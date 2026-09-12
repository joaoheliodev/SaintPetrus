export const modelProviders = ['mock', 'openai', 'gemini', 'deepseek'] as const;
export type ModelProvider = typeof modelProviders[number];
export const isModelProvider = (value: unknown): value is ModelProvider => modelProviders.some(provider => provider === value);
const MODEL_ID = /^[A-Za-z0-9._-]{1,100}$/;

export class ModelIdError extends Error {}

export function normalizeModelId(provider: ModelProvider, value: unknown): string {
  if (typeof value !== 'string') throw new ModelIdError('invalid_model_format');
  const normalized = provider === 'gemini' && value.startsWith('models/') ? value.slice(7) : value;
  if (!MODEL_ID.test(normalized)) throw new ModelIdError('invalid_model_format');
  return normalized;
}
