export const eventTypes = ['agent.created', 'agent.message', 'agent.status_changed', 'agent.paused', 'agent.replaced', 'budget.warning', 'budget.refused', 'connection.created', 'connection.removed', 'error'] as const;
export type EventType = typeof eventTypes[number];
export type EventInput = {
  agent_id: string; role: string; type: EventType; severity?: 'info' | 'warning' | 'error';
  source?: string; destination?: string; tokens?: { prompt: number; completion: number };
  status?: { from: string; to: string }; payload: string;
};
export type BusEvent = EventInput & { id: number; timestamp: string; severity: 'info' | 'warning' | 'error' };
export type EventBatch = { events: BusEvent[]; prompt: number; completion: number; cursor: number; truncated: boolean };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isTokens = (value: unknown) => value === undefined || (record(value) && Number.isSafeInteger(value.prompt) && typeof value.prompt === 'number' && value.prompt >= 0 && Number.isSafeInteger(value.completion) && typeof value.completion === 'number' && value.completion >= 0);
const isStatus = (value: unknown) => value === undefined || (record(value) && typeof value.from === 'string' && typeof value.to === 'string');
export function isEventInput(value: unknown): value is EventInput {
  return record(value) && typeof value.agent_id === 'string' && typeof value.role === 'string' && eventTypes.some(type => type === value.type) && (value.severity === undefined || value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') && optionalString(value.source) && optionalString(value.destination) && isTokens(value.tokens) && isStatus(value.status) && typeof value.payload === 'string';
}
