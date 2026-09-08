import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export type ModelPolicy = { provider: 'mock' | 'openai' | 'gemini'; max_tokens: number; temperature: number };
export type TokenPolicy = { global: number; perAgent: number; perModel: number; perSession: number; cacheTtlMs: number; models: Record<string, ModelPolicy> };
export type Prices = { date: string; currency: 'USD'; models: Record<string, { inputPerMillion: number; outputPerMillion: number }> };
export const validLimit = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
export function validateConfig(policy: TokenPolicy, prices: Prices) {
  if (![policy.global, policy.perAgent, policy.perModel, policy.perSession, policy.cacheTtlMs].every(validLimit) || !/^\d{4}-\d{2}-\d{2}$/.test(prices.date) || prices.currency !== 'USD') throw new Error('Invalid local token configuration.');
  for (const [model, item] of Object.entries(policy.models)) {
    const price = prices.models[model];
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model) || !['mock', 'openai', 'gemini'].includes(item.provider) || !validLimit(item.max_tokens) || item.max_tokens < 1 || item.max_tokens > 32768 || !Number.isFinite(item.temperature) || item.temperature < 0 || item.temperature > 2 || !price || ![price.inputPerMillion, price.outputPerMillion].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid local model policy or price.');
  }
}
export function loadConfig() {
  const policy = JSON.parse(readFileSync(join(process.cwd(), 'config/token-policy.json'), 'utf8')) as TokenPolicy;
  const prices = JSON.parse(readFileSync(join(process.cwd(), 'config/prices.json'), 'utf8')) as Prices;
  validateConfig(policy, prices); return { policy, prices };
}
