'use client';
import { create } from 'zustand';
import { createGraph, type Graph, type GraphEvent } from './orchestrator';
// at is when this panel received the event: presentation only, for "2m ago"; the server's id keeps the order.
export type ReceivedEvent = Omit<GraphEvent, 'snapshot'> & { at: number };
type Projection = { graph: Graph; events: ReceivedEvent[]; selectedId: string; notice: string; select: (id: string) => void; apply: (event: GraphEvent) => Graph; hydrate: (graph: Graph) => void };
export const useProjection = create<Projection>((set) => ({
  graph: createGraph(), events: [], selectedId: 'root', notice: '',
  select: selectedId => set({ selectedId }),
  hydrate: graph => set({ graph, events: [], selectedId: 'root', notice: '' }),
  apply: event => {
    let projection = event.snapshot;
    set(state => {
      if (event.id <= state.graph.revision) { projection = state.graph; return state; }
      const { snapshot, ...rest } = event; const entry = { ...rest, at: Date.now() };
      return { graph: snapshot,
        selectedId: snapshot.agents.some(a => a.id === state.selectedId) ? state.selectedId : 'root',
        events: event.type === 'graph.reset' ? [entry] : [entry, ...state.events].slice(0, 100),
      };
    });
    return projection;
  },
}));
