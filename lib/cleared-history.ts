// A configured key leaves the graph as one `graph.redacted` event (Round 4, R4-5). The panel never knows the key, so it
// cannot redact what it received before that event; it discards it instead (R4-6): the Activity lines, the Run
// exchanges and the live feed lines. Presentation state only: the server's own records are redacted as they are sent.
import type { RunExchange } from './run-exchange';
import type { ReceivedEvent } from './store';

export const activityLimit = 100;
export type ReceivedHistory = { events: ReceivedEvent[]; exchanges: Record<string, RunExchange>; clearings: number };

// What the panel keeps once a graph event arrives. A reset starts the log again; a configured key also drops the Run
// exchanges and counts a clearing, and the event's own line says why the log starts there.
export function historyAfter(history: ReceivedHistory, entry: ReceivedEvent): ReceivedHistory {
  if (entry.type === 'graph.redacted') return { events: [entry], exchanges: {}, clearings: history.clearings + 1 };
  return { events: entry.type === 'graph.reset' ? [entry] : [entry, ...history.events].slice(0, activityLimit), exchanges: history.exchanges, clearings: history.clearings };
}

// An answer to a message sent before a clearing was held before it too, so it is dropped when it arrives.
export function historyWithExchange(history: ReceivedHistory, agent: string, exchange: RunExchange, sentAt: number): ReceivedHistory {
  return sentAt === history.clearings ? { ...history, exchanges: { ...history.exchanges, [agent]: exchange } } : history;
}

// The feed keeps the server's window as delivered and hides, by id, every line it had received when history was
// cleared. A window whose cursor is behind that mark comes from a restarted server, which holds none of those lines.
export const hiddenWhenCleared = (events: readonly { id: number }[]) => events.reduce((newest, event) => Math.max(newest, event.id), 0);
export const hiddenAfterWindow = (through: number, cursor: number) => cursor < through ? 0 : through;
export const shownFeedLines = <T extends { id: number }>(events: readonly T[], through: number) => events.filter(event => event.id > through);
