export const eventTypes = ['agent.created', 'agent.message', 'agent.status_changed', 'agent.paused', 'agent.replaced', 'budget.warning', 'budget.refused', 'connection.created', 'connection.removed', 'error'] as const;
export type EventType = typeof eventTypes[number];
export type EventInput = {
  agent_id: string; role: string; type: EventType; severity?: 'info' | 'warning' | 'error';
  source?: string; destination?: string; tokens?: { prompt: number; completion: number };
  status?: { from: string; to: string }; payload: string;
};
export type BusEvent = EventInput & { id: number; timestamp: string; severity: 'info' | 'warning' | 'error' };
export type EventBatch = { events: BusEvent[]; prompt: number; completion: number; cursor: number; truncated: boolean };
