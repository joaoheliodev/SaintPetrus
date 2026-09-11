// Adapted from the Agent Canvas reference. Shared contracts contain no runtime engine.
export type Provider = 'Unconfigured' | 'Mock';
export type Status = 'ready' | 'paused' | 'running' | 'completed' | 'blocked';
export type ContextEnvelope = { objective: string; summary: string; artifacts: string[] };
export type ExecutionBudget = { maxDepth: number; maxNodes: number; maxCostCents: number };
export type Agent = { id: string; parentId: string | null; name: string; provider: Provider; depth: number; status: Status; output: string; context: ContextEnvelope; position: { x: number; y: number } };
export type RootAgent = Agent & { id: 'root'; parentId: null; depth: 0 };
export type Edge = { id: string; source: string; target: string; kind: 'delegation' | 'context' };
export type Graph = { revision: number; agents: readonly [RootAgent, ...Agent[]]; edges: Edge[]; budget: ExecutionBudget; costCents: number; status: 'idle' | 'running' | 'paused' | 'completed' | 'blocked' };
export type GraphEvent = { id: number; type: string; message: string; snapshot: Graph };
export type SpawnRequest = { name: string; provider: Provider; context: ContextEnvelope };
export const DEFAULT_OBJECTIVE = 'Design a local agent orchestration workspace.';
export const DEFAULT_BUDGET: ExecutionBudget = { maxDepth: 5, maxNodes: 12, maxCostCents: 100 };
export const createGraph = (budget = DEFAULT_BUDGET, objective = DEFAULT_OBJECTIVE): Graph => ({
  revision: 0, agents: [{ id: 'root', parentId: null, name: 'Coordinator', provider: 'Unconfigured', depth: 0, status: 'ready', output: '', position: { x: 40, y: 180 }, context: { objective, summary: 'Coordinate the project. No provider is connected.', artifacts: [] } }],
  edges: [], budget: { ...budget }, costCents: 0, status: 'idle',
});
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const isContext = (value: unknown): value is ContextEnvelope => record(value) && typeof value.objective === 'string' && typeof value.summary === 'string' && Array.isArray(value.artifacts) && value.artifacts.every(item => typeof item === 'string');
const isAgent = (value: unknown): value is Agent => record(value) && typeof value.id === 'string' && (value.parentId === null || typeof value.parentId === 'string') && typeof value.name === 'string' && (value.provider === 'Unconfigured' || value.provider === 'Mock') && integer(value.depth) && value.depth >= 0 && ['ready', 'paused', 'running', 'completed', 'blocked'].some(status => status === value.status) && typeof value.output === 'string' && isContext(value.context) && record(value.position) && typeof value.position.x === 'number' && Number.isFinite(value.position.x) && typeof value.position.y === 'number' && Number.isFinite(value.position.y);
const isRoot = (value: unknown): value is RootAgent => isAgent(value) && value.id === 'root' && value.parentId === null && value.depth === 0;
const isEdge = (value: unknown): value is Edge => record(value) && typeof value.id === 'string' && typeof value.source === 'string' && typeof value.target === 'string' && (value.kind === 'delegation' || value.kind === 'context');
const isBudget = (value: unknown): value is ExecutionBudget => record(value) && integer(value.maxDepth) && integer(value.maxNodes) && integer(value.maxCostCents);
export function isGraph(value: unknown): value is Graph {
  if (!record(value) || !integer(value.revision) || value.revision < 0 || !Array.isArray(value.agents) || value.agents.length === 0 || !isRoot(value.agents[0]) || !value.agents.every(isAgent)) return false;
  return Array.isArray(value.edges) && value.edges.every(isEdge) && isBudget(value.budget) && integer(value.costCents) && value.costCents >= 0 && ['idle', 'running', 'paused', 'completed', 'blocked'].some(status => status === value.status);
}
export function isGraphEvent(value: unknown): value is GraphEvent {
  return record(value) && integer(value.id) && value.id >= 0 && typeof value.type === 'string' && typeof value.message === 'string' && isGraph(value.snapshot) && value.snapshot.revision === value.id;
}
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
