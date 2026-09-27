// The last Run once of an agent as the Run tab shows it: what was sent, what came back and what it cost.
// Everything here comes from server responses; nothing is priced or estimated in the browser.
export type RunExchange = { message: string; text: string; model: string; mocked: boolean; tokens: number; latencyMs: number; costUsd?: number | null; costPending?: boolean };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

// Reads a successful POST /api/provider { action: 'complete' } body; the message is the one the user sent.
export function exchangeFromResponse(message: string, data: unknown): RunExchange {
  const body = record(data) ? data : {};
  const usage = record(body.usage) ? body.usage : {};
  return {
    message,
    text: typeof body.text === 'string' ? body.text : '',
    model: typeof body.billingModel === 'string' ? body.billingModel : typeof body.model === 'string' ? body.model : 'unknown model',
    mocked: body.mocked === true,
    tokens: count(usage.total) || count(usage.prompt) + count(usage.completion),
    latencyMs: count(body.latencyMs),
  };
}

// The cost the server accounted for the agent's newest call receipt (GET /api/receipts lists newest first).
// null means the server has not priced it (unverifiable or unpriced); undefined means there is no receipt to read.
export function accountedCost(receipts: unknown, agent: string): number | null | undefined {
  const list = record(receipts) && Array.isArray(receipts.receipts) ? receipts.receipts : [];
  const call = list.find(item => record(item) && item.kind === 'call' && item.agent === agent);
  if (!record(call)) return undefined;
  return typeof call.costUsd === 'number' && Number.isFinite(call.costUsd) ? call.costUsd : null;
}

export function exchangeFacts(exchange: RunExchange): string[] {
  const cost = exchange.costPending ? 'reading cost…' : exchange.costUsd === undefined ? 'cost not reported' : exchange.costUsd === null ? 'cost not accounted yet' : exchange.mocked ? `$${exchange.costUsd.toFixed(6)} (mock)` : `$${exchange.costUsd.toFixed(6)}`;
  return [`${exchange.tokens} tokens${exchange.mocked ? ' (estimated)' : ''}`, `${exchange.latencyMs} ms`, cost];
}
