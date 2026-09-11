export async function allowSelectedEdgesOnly<NodeType, EdgeType extends { selected?: boolean }>(candidates: {
  nodes: NodeType[];
  edges: EdgeType[];
}): Promise<{ nodes: NodeType[]; edges: EdgeType[] }> {
  return { nodes: [], edges: candidates.edges.filter(edge => edge.selected === true) };
}
