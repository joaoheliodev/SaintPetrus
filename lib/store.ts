'use client';
import { create } from 'zustand';
import { createGraph, type Graph, type GraphEvent } from './orchestrator';
import { historyAfter, historyWithExchange, type ReceivedHistory } from './cleared-history';
import type { RunExchange } from './run-exchange';
// A logged event: the server's own fields, snapshot left out. The server's id keeps the order.
export type ReceivedEvent = Omit<GraphEvent, 'snapshot'>;
// A command response is logged as a placeholder under its revision; the server's event for that same revision,
// which names who and when, replaces the placeholder's log line. The graph itself is never taken from it.
const placeholder = (entry: ReceivedEvent | undefined) => !!entry && entry.type.startsWith('command.');
type Projection = ReceivedHistory & { graph: Graph; selectedId: string; notice: string; select: (id: string) => void; apply: (event: GraphEvent) => Graph; hydrate: (graph: Graph) => void; recordExchange: (agent: string, exchange: RunExchange, sentAt: number) => void };
export const useProjection = create<Projection>((set) => ({
  graph: createGraph(), events: [], exchanges: {}, clearings: 0, selectedId: 'root', notice: '',
  select: selectedId => set({ selectedId }),
  hydrate: graph => set({ graph, events: [], selectedId: 'root', notice: '' }),
  // Each agent's last Run once, in memory only: never sent back, saved or put in browser storage.
  recordExchange: (agent, exchange, sentAt) => set(state => historyWithExchange(state, agent, exchange, sentAt)),
  apply: event => {
    let projection = event.snapshot;
    set(state => {
      const { snapshot, ...entry } = event;
      if (event.id === state.graph.revision && !placeholder(entry) && placeholder(state.events.find(item => item.id === event.id))) {
        projection = state.graph; return { events: state.events.map(item => item.id === event.id ? entry : item) };
      }
      // The revision guard keeps the graph from a stale event, but a configured key still clears what the panel holds.
      if (event.id <= state.graph.revision) { projection = state.graph; return entry.type === 'graph.redacted' ? historyAfter(state, entry) : state; }
      return { graph: snapshot,
        selectedId: snapshot.agents.some(a => a.id === state.selectedId) ? state.selectedId : 'root',
        ...historyAfter(state, entry),
      };
    });
    return projection;
  },
}));
