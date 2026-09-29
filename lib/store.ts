'use client';
import { create } from 'zustand';
import { createGraph, type Graph, type GraphEvent } from './orchestrator';
// A logged event: the server's own fields, snapshot left out. The server's id keeps the order.
export type ReceivedEvent = Omit<GraphEvent, 'snapshot'>;
// A command response is logged as a placeholder under its revision; the server's event for that same revision,
// which names who and when, replaces the placeholder's log line. The graph itself is never taken from it.
const placeholder = (entry: ReceivedEvent | undefined) => !!entry && entry.type.startsWith('command.');
type Projection = { graph: Graph; events: ReceivedEvent[]; selectedId: string; notice: string; select: (id: string) => void; apply: (event: GraphEvent) => Graph; hydrate: (graph: Graph) => void };
export const useProjection = create<Projection>((set) => ({
  graph: createGraph(), events: [], selectedId: 'root', notice: '',
  select: selectedId => set({ selectedId }),
  hydrate: graph => set({ graph, events: [], selectedId: 'root', notice: '' }),
  apply: event => {
    let projection = event.snapshot;
    set(state => {
      const { snapshot, ...entry } = event;
      if (event.id === state.graph.revision && !placeholder(entry) && placeholder(state.events.find(item => item.id === event.id))) {
        projection = state.graph; return { events: state.events.map(item => item.id === event.id ? entry : item) };
      }
      if (event.id <= state.graph.revision) { projection = state.graph; return state; }
      return { graph: snapshot,
        selectedId: snapshot.agents.some(a => a.id === state.selectedId) ? state.selectedId : 'root',
        events: event.type === 'graph.reset' ? [entry] : [entry, ...state.events].slice(0, 100),
      };
    });
    return projection;
  },
}));
