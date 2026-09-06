'use client';
import { create } from 'zustand';
import { createGraph, type Graph, type GraphEvent } from './orchestrator';
type Projection = { graph: Graph; events: Omit<GraphEvent, 'snapshot'>[]; selectedId: string; notice: string; select: (id: string) => void; apply: (event: GraphEvent) => void; hydrate: (graph: Graph) => void };
export const useProjection = create<Projection>((set) => ({
  graph: createGraph(), events: [], selectedId: 'root', notice: '',
  select: selectedId => set({ selectedId }),
  hydrate: graph => set({ graph, events: [], selectedId: 'root', notice: '' }),
  apply: event => set(state => {
    if (event.id <= state.graph.revision) return state;
    const { snapshot, ...entry } = event;
    return { graph: snapshot,
      selectedId: snapshot.agents.some(a => a.id === state.selectedId) ? state.selectedId : 'root',
      events: event.type === 'graph.reset' ? [entry] : [...state.events, entry].slice(-100),
    };
  }),
}));
