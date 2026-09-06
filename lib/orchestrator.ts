// Adapted from the Agent Canvas reference. Shared contracts contain no runtime engine.
export type Provider = 'Unconfigured' | 'Mock';
export type Status = 'ready' | 'paused' | 'running' | 'completed' | 'blocked';
export type ContextEnvelope = { objective: string; summary: string; artifacts: string[] };
export type ExecutionBudget = { maxDepth: number; maxNodes: number; maxCostCents: number };
export type Agent = { id: string; parentId: string | null; name: string; provider: Provider; depth: number; status: Status; output: string; context: ContextEnvelope; position: { x: number; y: number } };
export type Edge = { id: string; source: string; target: string; kind: 'delegation' | 'context' };
export type Graph = { revision: number; agents: Agent[]; edges: Edge[]; budget: ExecutionBudget; costCents: number; status: 'idle' | 'running' | 'paused' | 'completed' | 'blocked' };
export type GraphEvent = { id: number; type: string; message: string; snapshot: Graph };
export type SpawnRequest = { name: string; provider: Provider; context: ContextEnvelope };
export const DEFAULT_OBJECTIVE = 'Design a local agent orchestration workspace.';
export const DEFAULT_BUDGET: ExecutionBudget = { maxDepth: 5, maxNodes: 12, maxCostCents: 100 };
export const createGraph = (budget = DEFAULT_BUDGET, objective = DEFAULT_OBJECTIVE): Graph => ({
  revision: 0, agents: [{ id: 'root', parentId: null, name: 'Coordinator', provider: 'Unconfigured', depth: 0, status: 'ready', output: '', position: { x: 40, y: 180 }, context: { objective, summary: 'Coordinate the project. No provider is connected.', artifacts: [] } }],
  edges: [], budget: { ...budget }, costCents: 0, status: 'idle',
});
// UX feedback only. The server independently validates every graph mutation.
export function connectionFeedback(graph: Graph, source: string, target: string): string | null {
  if (source === target) return 'An agent cannot connect to itself.';
  if (!graph.agents.some(a => a.id === source) || !graph.agents.some(a => a.id === target)) return 'Agent not found.';
  if (graph.edges.some(e => e.source === source && e.target === target)) return 'Connection already exists.';
  const visited = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return graph.edges.filter(e => e.source === id).some(e => reaches(e.target));
  };
  return reaches(target) ? 'Connection would create a cycle.' : null;
}
