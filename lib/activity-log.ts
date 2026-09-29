// How activity reads on screen: one line per action and its detail under it. The server publishes and orders the
// events; this only names them, hides the noisy kinds on request and says how long ago the panel received them.

// Graph events (the canvas stream) name what changed but not which agent: the server does not send one.
const graphTitles: Record<string, string> = {
  'agent.created': 'Agent created', 'agent.updated': 'Agent updated', 'agent.moved': 'Card moved', 'agent.removed': 'Agent removed',
  'agent.output': 'Run once answered', 'edge.created': 'Connection created', 'edge.removed': 'Connection deleted',
  'graph.reset': 'Graph reset', 'graph.imported': 'Graph imported', 'graph.restored': 'Graph restored',
  'budget.updated': 'Graph limits changed', 'budget.exhausted': 'Demo cost limit reached', 'agents.paused': 'All agents paused',
  'run.updated': 'Demo status changed', 'mock.delta': 'Demo output',
};
// Bus events (the optional live feed) carry the agent's name and their own type vocabulary.
const busTitles: Record<string, string> = {
  'agent.created': 'Agent created', 'agent.message': 'Message', 'agent.status_changed': 'Status changed', 'agent.paused': 'Paused',
  'agent.replaced': 'Agent replaced', 'agent.removed': 'Agent removed', 'graph.replaced': 'Graph replaced', 'budget.warning': 'Budget warning',
  'budget.refused': 'Budget refused', 'provider.rerouted': 'Provider rerouted', 'provider.unpriced': 'Served model unpriced',
  'provider.usage_unparsed': 'Usage unreadable', 'connection.created': 'Connection created', 'connection.removed': 'Connection deleted', error: 'Error',
};
export const graphTitle = (type: string) => graphTitles[type] ?? (type.startsWith('command.') ? 'Your change applied' : type);
export const busTitle = (type: string) => busTitles[type] ?? type;

// Hidden unless asked for: a line per drag step or per demo character buries everything else.
export const noisyTypes: readonly string[] = ['agent.moved', 'mock.delta'];
export const isNoise = (type: string) => noisyTypes.includes(type);

export function relativeTime(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export type ActivityLine = { key: string; title: string; detail: string; time: string; agent?: string };
type Party = { id: string; name: string };
// Names and times come from the server event: who it concerned when it happened, and the server's clock.
export function graphLine(event: { id: number; type: string; message: string; at?: number; agent?: Party; source?: Party; target?: Party }, now: number): ActivityLine {
  const route = event.source && event.target ? `${event.source.name} → ${event.target.name} · ` : '';
  return { key: `graph-${event.id}`, title: graphTitle(event.type), ...(event.agent ? { agent: event.agent.name } : {}), detail: `${route}${event.message}`, time: event.at === undefined ? '' : relativeTime(event.at, now) };
}
export function busLine(event: { id: number; type: string; role: string; payload: string; timestamp: string; source?: string; destination?: string }, now: number): ActivityLine {
  const at = Date.parse(event.timestamp);
  const route = event.source ? `${event.source} → ${event.destination ?? ''} · ` : '';
  return { key: `bus-${event.id}`, title: busTitle(event.type), agent: event.role, detail: `${route}${event.payload}`, time: Number.isFinite(at) ? relativeTime(at, now) : '' };
}
