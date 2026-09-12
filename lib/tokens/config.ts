import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isModelProvider, normalizeModelId, type ModelProvider } from '../providers/model-id';
import { thinkingPolicyValid } from '../providers/thinking-policy';
import type { ThinkingControl } from '../providers/adapter';
import { validateModelPrice, type ModelPrice } from './pricing';
export type ThinkingPolicy = ThinkingControl;
export type ModelPolicy = { provider: ModelProvider; max_tokens: number; temperature: number; thinking?: ThinkingPolicy };
export type CostLimitsUsd = { global: number; perAgent: number; perModel: number; perSession: number };
export type TokenPolicy = { global: number; perAgent: number; perModel: number; perSession: number; costLimitsUsd: CostLimitsUsd; cacheTtlMs: number; reservationTtlMs: number; models: Record<string, ModelPolicy> };
export type Prices = { date: string; currency: 'USD'; models: Record<string, ModelPrice> };
export const validLimit = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
export const validCostLimit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validThinkingControl = (value: unknown): value is ThinkingPolicy => record(value) && (value.mode === 'disabled' ? Object.keys(value).length === 1 : value.mode === 'enabled' && Object.keys(value).length === 2 && ['minimal', 'low', 'high', 'max'].includes(String(value.effort)));
export function validateConfig(policy: TokenPolicy, prices: Prices) {
  if (!record(policy) || !record(prices) || !record(policy.costLimitsUsd) || !record(policy.models) || !record(prices.models)
    || ![policy.global, policy.perAgent, policy.perModel, policy.perSession, policy.cacheTtlMs, policy.reservationTtlMs].every(validLimit)
    || ![policy.costLimitsUsd.global, policy.costLimitsUsd.perAgent, policy.costLimitsUsd.perModel, policy.costLimitsUsd.perSession].every(validCostLimit)
    || policy.reservationTtlMs < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(prices.date) || prices.currency !== 'USD') throw new Error('Invalid local token configuration.');
  if (Object.values(prices.models).some(price => !validateModelPrice(price))) throw new Error('Invalid local price configuration.');
  for (const [model, item] of Object.entries(policy.models)) {
    let canonicalModel = false;
    try { canonicalModel = normalizeModelId(item.provider, model) === model; } catch { /* Invalid config is rejected below. */ }
    const thinking = item.thinking;
    const validThinking = (thinking === undefined || validThinkingControl(thinking)) && isModelProvider(item.provider) && thinkingPolicyValid(item.provider, thinking);
    if (!canonicalModel || !isModelProvider(item.provider) || !validLimit(item.max_tokens) || item.max_tokens < 1 || item.max_tokens > 32768 || !Number.isFinite(item.temperature) || item.temperature < 0 || item.temperature > 2 || !validThinking) throw new Error('Invalid local model policy.');
  }
}
export function loadConfig() {
  const policy = JSON.parse(readFileSync(join(process.cwd(), 'config/token-policy.json'), 'utf8')) as TokenPolicy;
  const prices = JSON.parse(readFileSync(join(process.cwd(), 'config/prices.json'), 'utf8')) as Prices;
  validateConfig(policy, prices); return { policy, prices };
}
