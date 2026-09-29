// What of the accounting survives a restart (Round 3, R-02): IDs, counts, amounts, price versions, verdicts and times.
// Never a key, a prompt or an answer. The session scope and the mock's usage are the process's own and stay out.
import { isModelProvider, type ModelProvider } from '../providers/model-id';
import { validateModelPrice, type ModelPrice } from './pricing';
import { validCostLimit, validLimit } from './config';

export type DurableTotals = { prompt: number; completion: number; total: number };
export type DurableRow = { scope: 'global' | 'agent' | 'model'; id: string; limit?: number; costLimitUsd?: number; used: number; estimated: number; conservativeCachedInput: number; actual: DurableTotals; costAccountedUsd: number; costUnmeasuredUsd: number };
export type DurableReservation = { id: string; agent: string; model: string; provider: ModelProvider; priceVersionId: string; priceVersions: Record<string, { id: string; price: ModelPrice }>; billingModel?: string; tokens: number; costUsd: number; inputTokens: number; maxOutputTokens: number; createdAt: number; expiresAt: number | null; status: 'inflight' | 'unverifiable' | 'estimated'; reported?: { prompt: number; completion: number; reasoning?: number } };
export type DurableState = { rows: DurableRow[]; reservations: DurableReservation[]; paused: string[]; stopped: boolean; agentModels: Record<string, string[]>; reservationSequence: number };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const totals = (value: unknown) => record(value) && keys(value, ['prompt', 'completion', 'total']) && validLimit(value.prompt) && validLimit(value.completion) && validLimit(value.total);
// Amounts can go below zero transiently only by rounding; anything else is not a journal we wrote.
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;

function validRow(value: unknown) {
  return record(value) && keys(value, ['scope', 'id', 'used', 'estimated', 'conservativeCachedInput', 'actual', 'costAccountedUsd', 'costUnmeasuredUsd'], ['limit', 'costLimitUsd'])
    && (value.scope === 'global' || value.scope === 'agent' || value.scope === 'model') && id(value.id)
    && (value.limit === undefined || validLimit(value.limit)) && (value.costLimitUsd === undefined || validCostLimit(value.costLimitUsd))
    && validLimit(value.used) && validLimit(value.estimated) && validLimit(value.conservativeCachedInput) && totals(value.actual)
    && amount(value.costAccountedUsd) && amount(value.costUnmeasuredUsd);
}
function validReservation(value: unknown) {
  if (!record(value) || !keys(value, ['id', 'agent', 'model', 'provider', 'priceVersionId', 'priceVersions', 'tokens', 'costUsd', 'inputTokens', 'maxOutputTokens', 'createdAt', 'expiresAt', 'status'], ['billingModel', 'reported'])) return false;
  const versions = value.priceVersions;
  const reported = value.reported;
  return id(value.id) && id(value.agent) && id(value.model) && isModelProvider(value.provider) && id(value.priceVersionId)
    && record(versions) && Object.entries(versions).every(([model, version]) => id(model) && record(version) && keys(version, ['id', 'price']) && id(version.id) && validateModelPrice(version.price))
    && (value.billingModel === undefined || id(value.billingModel))
    && validLimit(value.tokens) && validCostLimit(value.costUsd) && validLimit(value.inputTokens) && validLimit(value.maxOutputTokens)
    && time(value.createdAt) && (value.expiresAt === null || time(value.expiresAt))
    && (value.status === 'inflight' || value.status === 'unverifiable' || value.status === 'estimated')
    && (reported === undefined || (record(reported) && keys(reported, ['prompt', 'completion'], ['reasoning']) && validLimit(reported.prompt) && validLimit(reported.completion) && (reported.reasoning === undefined || validLimit(reported.reasoning))));
}
export function validDurableState(value: unknown): value is DurableState {
  return record(value) && keys(value, ['rows', 'reservations', 'paused', 'stopped', 'agentModels', 'reservationSequence'])
    && Array.isArray(value.rows) && value.rows.every(validRow)
    && Array.isArray(value.reservations) && value.reservations.every(validReservation)
    && Array.isArray(value.paused) && value.paused.every(id) && typeof value.stopped === 'boolean'
    && record(value.agentModels) && Object.entries(value.agentModels).every(([agent, models]) => id(agent) && Array.isArray(models) && models.every(id))
    && time(value.reservationSequence);
}
// A new budget period starts every durable counter from zero. Limits the operator set, pauses and the kill switch carry over;
// the journal keeps everything written before, and the caller refuses the change while any reservation is unresolved.
export function startPeriod(state: DurableState): DurableState {
  return { ...structuredClone(state), rows: state.rows.map(row => ({ scope: row.scope, id: row.id, ...(row.limit === undefined ? {} : { limit: row.limit }), ...(row.costLimitUsd === undefined ? {} : { costLimitUsd: row.costLimitUsd }), used: 0, estimated: 0, conservativeCachedInput: 0, actual: { prompt: 0, completion: 0, total: 0 }, costAccountedUsd: 0, costUnmeasuredUsd: 0 })) };
}
