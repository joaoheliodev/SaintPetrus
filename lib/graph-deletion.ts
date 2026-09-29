import type { Graph } from './orchestrator';

export async function allowSelectedEdgesOnly<NodeType, EdgeType extends { selected?: boolean }>(candidates: {
  nodes: NodeType[];
  edges: EdgeType[];
}): Promise<{ nodes: NodeType[]; edges: EdgeType[] }> {
  return { nodes: [], edges: candidates.edges.filter(edge => edge.selected === true) };
}

// Presentation only: the server refuses to delete a delegation whatever the canvas sends (lib/server/graph-service.ts).
const isDelegation = (graph: Pick<Graph, 'edges'>, id: string) => graph.edges.some(edge => edge.id === id && edge.kind === 'delegation');

// Only context connections are asked about. They are sent first, so the server's refusal of a delegation is the notice
// left on screen rather than one a later accepted deletion clears.
export function byDeletability<EdgeType extends { id: string }>(graph: Pick<Graph, 'edges'>, edges: readonly EdgeType[]) {
  return { contexts: edges.filter(edge => !isDelegation(graph, edge.id)), delegations: edges.filter(edge => isDelegation(graph, edge.id)) };
}

const joined = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// Shown while a delegation is selected, so pressing Delete is not the first place a person meets the rule.
export function delegationHint(graph: Pick<Graph, 'agents' | 'edges'>, selectedIds: readonly string[]): string {
  const subagents = graph.edges.filter(edge => edge.kind === 'delegation' && selectedIds.includes(edge.id))
    .map(edge => graph.agents.find(agent => agent.id === edge.target)?.name ?? 'the subagent');
  if (!subagents.length) return '';
  return subagents.length === 1
    ? `The delegation to ${subagents[0]} cannot be deleted on its own. Remove the subagent instead (Details → Remove agent).`
    : `The delegations to ${joined(subagents)} cannot be deleted on their own. Remove the subagents instead (Details → Remove agent).`;
}
