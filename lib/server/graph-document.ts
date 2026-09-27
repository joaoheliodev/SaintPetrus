// The graph as a file: what the export writes, what the store saves and what import reads back. A file is untrusted
// input (operator decision Q-04), so parsing is strict and rebuilds a graph from checked fields only.
import { GraphError } from './graph-service';
import { redactText } from '../security/redact';
import type { Agent, Edge, ExecutionBudget, Graph, RootAgent, Status } from '../orchestrator';

// Room for the largest graph the limits allow (50 agents with full context and output) with JSON escaping.
export const GRAPH_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

const refuse = (reason: string): never => { throw new GraphError(`Graph file refused: ${reason}`); };
type Fields = Record<string, unknown>;
// Exact key sets: an unknown field is refused, never ignored. The key itself is not echoed.
function fields(value: unknown, keys: readonly string[], where: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse(`${where} is not an object.`);
  const present = Object.keys(value);
  if (present.some(key => !keys.includes(key))) return refuse(`${where} has a field that is not part of the graph format.`);
  if (keys.some(key => !present.includes(key))) return refuse(`${where} is missing a field.`);
  const result: Fields = {};
  for (const key of keys) result[key] = Reflect.get(value, key);
  return result;
}
function text(value: unknown, where: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return refuse(`${where} is not valid text.`);
  // A key pasted into an objective must not come back through a file; the redactor is the one definition of key-shaped.
  if (redactText(value) !== value) return refuse(`${where} contains text shaped like a credential.`);
  return value;
}
function whole(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return refuse(`${where} is out of range.`);
  return value;
}
const identifier = (value: unknown, where: string): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : refuse(`${where} is not a valid identifier.`);
const statuses: readonly Status[] = ['ready', 'paused', 'running', 'completed', 'blocked'];
const runStatuses: readonly Graph['status'][] = ['idle', 'running', 'paused', 'completed', 'blocked'];

function agent(value: unknown, index: number) {
  const where = `agents[${index}]`;
  const raw = fields(value, ['id', 'parentId', 'name', 'provider', 'depth', 'status', 'output', 'context', 'position'], where);
  const context = fields(raw.context, ['objective', 'summary', 'artifacts'], `${where}.context`);
  const position = fields(raw.position, ['x', 'y'], `${where}.position`);
  if (!Array.isArray(context.artifacts) || context.artifacts.length > 10) refuse(`${where}.context.artifacts is not valid.`);
  const artifacts: string[] = Array.isArray(context.artifacts) ? context.artifacts.map((item, at) => text(item, `${where}.context.artifacts[${at}]`, 500, false)) : [];
  // Graph agents name no model; a provider label outside the canvas set would be a way to smuggle one in.
  if (raw.provider !== 'Unconfigured' && raw.provider !== 'Mock') refuse(`${where}.provider is not Unconfigured or Mock.`);
  if (!statuses.some(status => status === raw.status)) refuse(`${where}.status is not valid.`);
  const coordinate = (item: unknown, axis: string) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 100000 ? Math.round(item) : refuse(`${where}.position.${axis} is out of range.`);
  return {
    id: identifier(raw.id, `${where}.id`),
    parentId: raw.parentId === null ? null : identifier(raw.parentId, `${where}.parentId`),
    name: text(raw.name, `${where}.name`, 70).trim(),
    provider: raw.provider === 'Mock' ? 'Mock' : 'Unconfigured',
    depth: whole(raw.depth, `${where}.depth`, 0, 5),
    output: text(raw.output, `${where}.output`, 8000, false),
    context: { objective: text(context.objective, `${where}.context.objective`, 2000), summary: text(context.summary, `${where}.context.summary`, 2000, false), artifacts },
    position: { x: coordinate(position.x, 'x'), y: coordinate(position.y, 'y') },
  } satisfies Omit<Agent, 'status'>;
}

// Returns a graph at rest: nothing is running after a restart or an import, so every status starts over.
export function parseGraphDocument(input: string): Graph {
  if (Buffer.byteLength(input, 'utf8') > GRAPH_DOCUMENT_MAX_BYTES) refuse('it is larger than 4 MiB.');
  let value: unknown;
  try { value = JSON.parse(input); } catch { return refuse('it is not JSON.'); }
  const raw = fields(value, ['revision', 'agents', 'edges', 'budget', 'costCents', 'status'], 'the graph');
  const budgetFields = fields(raw.budget, ['maxDepth', 'maxNodes', 'maxCostCents'], 'budget');
  const budget: ExecutionBudget = { maxDepth: whole(budgetFields.maxDepth, 'budget.maxDepth', 1, 5), maxNodes: whole(budgetFields.maxNodes, 'budget.maxNodes', 1, 50), maxCostCents: whole(budgetFields.maxCostCents, 'budget.maxCostCents', 1, 10000) };
  if (!runStatuses.some(status => status === raw.status)) refuse('status is not valid.');
  if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > budget.maxNodes) return refuse('the agent list is empty or over budget.maxNodes.');
  if (!Array.isArray(raw.edges) || raw.edges.length > 50 * 49) return refuse('the connection list is not valid.');
  const agents = raw.agents.map(agent);
  const byId = new Map<string, (typeof agents)[number]>();
  agents.forEach((item, index) => {
    if (byId.has(item.id)) refuse(`agents[${index}].id is a duplicate.`);
    // A parent comes before its children, as the canvas creates them, so depth is checked against a known parent.
    const parent = item.parentId === null ? undefined : byId.get(item.parentId);
    if (item.parentId !== null && !parent) refuse(`agents[${index}].parentId does not name an earlier agent.`);
    if (item.depth !== (parent ? parent.depth + 1 : 0) || item.depth > budget.maxDepth) refuse(`agents[${index}].depth does not match its parent or budget.maxDepth.`);
    byId.set(item.id, item);
  });
  const [first, ...rest] = agents;
  if (first.id !== 'root' || first.parentId !== null) refuse('the first agent is not the coordinator.');
  if (rest.some(item => item.id === 'root')) refuse('the coordinator appears twice.');
  const edges: Edge[] = raw.edges.map((value, index) => {
    const edge = fields(value, ['id', 'source', 'target', 'kind'], `edges[${index}]`);
    const source = identifier(edge.source, `edges[${index}].source`), target = identifier(edge.target, `edges[${index}].target`);
    if (!byId.has(source) || !byId.has(target) || source === target) refuse(`edges[${index}] does not join two different agents.`);
    if (edge.kind !== 'delegation' && edge.kind !== 'context') return refuse(`edges[${index}].kind is not valid.`);
    if (edge.kind === 'delegation' && byId.get(target)?.parentId !== source) refuse(`edges[${index}] delegates to an agent with another parent.`);
    return { id: identifier(edge.id, `edges[${index}].id`), source, target, kind: edge.kind };
  });
  if (new Set(edges.map(edge => edge.id)).size !== edges.length) refuse('a connection id is a duplicate.');
  if (new Set(edges.map(edge => `${edge.source}\n${edge.target}`)).size !== edges.length) refuse('a connection appears twice.');
  if (edges.filter(edge => edge.kind === 'delegation').length !== agents.filter(item => item.parentId !== null).length) refuse('a subagent has no delegation connection.');
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = (id: string): boolean => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return true;
    state.set(id, 'visiting');
    const found = edges.some(edge => edge.source === id && cyclic(edge.target));
    state.set(id, 'done'); return found;
  };
  if (agents.some(item => cyclic(item.id))) refuse('the connections form a cycle.');
  const costCents = whole(raw.costCents, 'costCents', 0, budget.maxCostCents);
  const root: RootAgent = { ...first, id: 'root', parentId: null, depth: 0, status: 'ready' };
  return {
    revision: whole(raw.revision, 'revision', 0, 2 ** 40),
    agents: [root, ...rest.map((item): Agent => ({ ...item, status: 'ready' }))],
    edges, budget, costCents, status: 'idle',
  };
}
