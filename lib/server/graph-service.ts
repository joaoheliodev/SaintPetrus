import { observeArtifact } from '../preview/store';
import { eventBus } from '../events/bus';
// Server authority. Node imports prevent accidental use in the browser bundle.
import { randomUUID } from 'node:crypto';
import { onSecretRegistered, redactText } from '../security/redact';
import { createGraph, type Graph, type GraphEvent, type ExecutionBudget, type SpawnRequest, type Agent } from '../orchestrator';
// Thrown by the graph the custom server builds from its own copy of lib/ and caught by the route bundle's copy, so it
// is recognized by a Symbol.for brand, like ProviderFailure, never by instanceof.
const graphErrorBrand = Symbol.for('saintpetrus.GraphError');
export class GraphError extends Error {
  constructor(message: string) { super(message); Object.defineProperty(this, graphErrorBrand, { value: true }); }
  static is(value: unknown): value is GraphError { return value instanceof Error && Reflect.get(value, graphErrorBrand) === true; }
}
// Text the redactor would change cannot be saved as it is, so it is refused at the door, as import refuses it; the
// redactor is the one definition of credential-shaped. Otherwise a saved graph could fail its own restore.
function refuseCredentials(fields: Record<string, string | readonly string[]>) {
  for (const [field, value] of Object.entries(fields)) {
    if ((typeof value === 'string' ? [value] : value).some(text => redactText(text) !== text)) throw new GraphError(`The ${field} contains text shaped like a credential (an API key or an authorization header). Remove it and try again.`);
  }
}
// Text is redacted before the cut, so it is within its limit as the file will hold it. A cut inside
// "Bearer [REDACTED]" leaves text the redactor would lengthen again, so it is trimmed back until the redactor leaves it.
function savedText(text: string, max: number) {
  let value = redactText(text).slice(0, max);
  while (redactText(value) !== value) value = value.slice(0, -1);
  return value;
}
const savedOutput = (text: string) => savedText(text, 8000);
// The saved graph refuses a position outside this square (graph-document.ts), so placement never leaves it.
const onCanvas = (value: number) => Math.max(-100000, Math.min(100000, value));
// Only the demo runs or pauses the graph; the refusal names both ways out of it.
export const demoRefusal = (action: string) => `The demo is running or paused: let it finish (Resume demo if it is paused) or reset the graph before ${action}.`;
export class GraphService {
  private graph = createGraph();
  // The token service owns every pause; the graph shows the ones it holds (Round 5, R5-3). Only the process graph is told.
  private held: (id: string) => boolean = () => false;
  followPauses(held: (id: string) => boolean) { this.held = held; }
  constructor() { this.record('agent.created', 'root', 'Coordinator created.'); }
  private record(type: import('../events/types').EventType, id: string, payload: string, extra: Partial<import('../events/types').EventInput> = {}) {
    eventBus().publish({ agent_id: id, role: this.graph.agents.find(a => a.id === id)?.name ?? 'Unknown', type, payload, ...extra });
  }
  private listeners = new Set<(event: GraphEvent) => void>();
  snapshot(): Graph { return structuredClone(this.graph); }
  subscribe(listener: (event: GraphEvent) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  // parties name who the event concerns as they are now, so the name survives a later removal or rename.
  private emit(type: string, message: string, parties: { agent?: Agent; source?: Agent; target?: Agent } = {}) {
    this.graph.revision++;
    const party = (agent: Agent | undefined) => agent ? { id: agent.id, name: agent.name } : undefined;
    const event: GraphEvent = { id: this.graph.revision, type, message, snapshot: this.snapshot(), at: Date.now(),
      ...(parties.agent ? { agent: party(parties.agent) } : {}), ...(parties.source ? { source: party(parties.source) } : {}), ...(parties.target ? { target: party(parties.target) } : {}) };
    // A transport consumer cannot mutate another consumer's event or turn a committed mutation
    // into an apparent command failure by throwing from its listener.
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Listener isolation is intentional. */ }
    }
  }
  reset(objective = this.graph.agents[0].context.objective) {
    if (!objective.trim() || objective.length > 2000) throw new GraphError('Invalid objective.');
    refuseCredentials({ objective });
    const revision = this.graph.revision;
    this.graph = createGraph(this.graph.budget, objective);
    // The Coordinator keeps its id through a reset, and with it a pause the token service still holds.
    if (this.held('root')) this.graph.agents[0].status = 'paused';
    this.graph.revision = revision; this.emit('graph.reset', 'Graph reset.');
  }
  setBudget(budget: ExecutionBudget) {
    if (['running', 'paused'].includes(this.graph.status)) throw new GraphError(demoRefusal('changing the graph limits'));
    if (!Number.isInteger(budget.maxDepth) || budget.maxDepth < 1 || budget.maxDepth > 5 ||
      !Number.isInteger(budget.maxNodes) || budget.maxNodes < this.graph.agents.length || budget.maxNodes > 50 ||
      !Number.isInteger(budget.maxCostCents) || budget.maxCostCents < Math.max(1, this.graph.costCents) || budget.maxCostCents > 10000 ||
      this.graph.agents.some(a => a.depth > budget.maxDepth)) throw new GraphError('Invalid limits.');
    this.graph.budget = { ...budget }; this.emit('budget.updated', 'Limits updated.');
  }
  add(request: SpawnRequest, options: { parentId?: string | null; position?: { x: number; y: number } } = {}) {
    return this.createAgent(options.parentId ?? null, request, options.position);
  }
  spawn(callerId: string, request: SpawnRequest) { return this.createAgent(callerId, request); }
  // Placement is server-side so two clients cannot stack agents on the same spot.
  private freePosition(parent: Agent | undefined, requested?: { x: number; y: number }) {
    if (requested) {
      if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y) || Math.abs(requested.x) > 100000 || Math.abs(requested.y) > 100000) throw new GraphError('Invalid position.');
      return { x: Math.round(requested.x), y: Math.round(requested.y) };
    }
    const row = this.graph.agents.length;
    let candidate = parent ? { x: parent.position.x + 360, y: parent.position.y } : { x: 40 + (row % 3) * 360, y: 180 + Math.floor(row / 3) * 280 };
    const taken = (spot: { x: number; y: number }) => this.graph.agents.some(a => Math.abs(a.position.x - spot.x) < 320 && Math.abs(a.position.y - spot.y) < 240);
    for (let step = 0; step < 64 && taken(candidate); step++) candidate = { x: candidate.x, y: candidate.y + 260 };
    // Beside a parent at the edge of the canvas the free spot would fall outside it.
    return { x: onCanvas(candidate.x), y: onCanvas(candidate.y) };
  }
  private createAgent(callerId: string | null, request: SpawnRequest, requested?: { x: number; y: number }) {
    const parent = this.graph.agents.find(a => a.id === callerId);
    if (callerId && !parent) throw new GraphError('Parent not found.');
    if (!request.name.trim() || request.name.length > 70 || !request.context.objective.trim() ||
      request.context.objective.length > 2000 || request.context.summary.length > 2000 ||
      request.context.artifacts.length > 10 || request.context.artifacts.some(a => a.length > 500) ||
      !['Unconfigured', 'Mock'].includes(request.provider)) throw new GraphError('Invalid agent request.');
    refuseCredentials({ name: request.name, objective: request.context.objective, summary: request.context.summary, artifacts: request.context.artifacts });
    if (parent && parent.depth >= this.graph.budget.maxDepth) throw new GraphError('Depth limit reached.');
    if (this.graph.agents.length >= this.graph.budget.maxNodes) throw new GraphError('Agent limit reached.');
    if (this.graph.costCents >= this.graph.budget.maxCostCents) throw new GraphError('Mock budget exhausted.');
    const id = randomUUID();
    const depth = parent ? parent.depth + 1 : 0;
    const agent: Agent = { id, parentId: parent?.id ?? null, name: request.name.trim(), provider: request.provider,
      depth, status: 'ready', output: '', context: structuredClone(request.context),
      position: this.freePosition(parent, requested) };
    // Synchronous node + edge mutation is atomic within this single local process.
    this.graph.agents = [...this.graph.agents, agent];
    if (parent) this.graph.edges.push({ id: randomUUID(), source: parent.id, target: id, kind: 'delegation' });
    this.record('agent.created', id, 'Agent created.');
    if (parent) this.record('connection.created', parent.id, 'Delegation connection created.', { source: parent.id, destination: id });
    this.emit('agent.created', 'Agent created.', { agent, ...(parent ? { source: parent, target: agent } : {}) }); return id;
  }
  // Accounting refusals (a reservation not yet settled) are decided by the token service before this runs.
  remove(id: string) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    if (id === this.graph.agents[0].id) throw new GraphError('The coordinator cannot be removed.');
    if (this.graph.status === 'running' || this.graph.status === 'paused') throw new GraphError(demoRefusal('removing an agent'));
    if (this.graph.agents.some(a => a.parentId === id)) throw new GraphError('Remove its subagents first.');
    this.record('agent.removed', id, 'Agent removed.');
    const [root, ...rest] = this.graph.agents;
    this.graph.agents = [root, ...rest.filter(a => a.id !== id)];
    this.graph.edges = this.graph.edges.filter(e => e.source !== id && e.target !== id);
    this.emit('agent.removed', 'Agent removed.', { agent });
  }
  // Takes a graph already rebuilt by parseGraphDocument. Accounting refusals are decided before this runs, as for remove.
  replace(graph: Graph, reason: 'imported' | 'restored') {
    if (this.graph.status === 'running' || this.graph.status === 'paused') throw new GraphError(demoRefusal('importing a graph'));
    // Revisions only move forward, so a client that saw a later revision still accepts the next event.
    this.graph = { ...structuredClone(graph), revision: Math.max(this.graph.revision, graph.revision) };
    for (const agent of this.graph.agents) if (this.held(agent.id)) agent.status = 'paused';
    this.record('graph.replaced', 'root', reason === 'imported' ? 'Graph imported from a file.' : 'Saved graph restored.');
    this.emit(`graph.${reason}`, reason === 'imported' ? 'Graph imported.' : 'Graph restored.');
  }
  update(id: string, changes: { name: string; objective: string }) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    const name = changes.name.trim();
    if (!name || name.length > 70 || !changes.objective.trim() || changes.objective.length > 2000) throw new GraphError('Invalid agent request.');
    refuseCredentials({ name, objective: changes.objective });
    agent.name = name; agent.context = { ...agent.context, objective: changes.objective };
    this.emit('agent.updated', 'Agent updated.', { agent });
  }
  // A key configured after it was typed: every text keeps what the redactor leaves of it, within its limit, as the
  // screen already showed it, so the store saves that at once and a key forgotten later cannot come back from memory.
  redactSecrets(): boolean {
    const before = JSON.stringify(this.graph.agents);
    for (const agent of this.graph.agents) {
      agent.name = savedText(agent.name, 70).trim();
      agent.context = { objective: savedText(agent.context.objective, 2000), summary: savedText(agent.context.summary, 2000), artifacts: agent.context.artifacts.map(item => savedText(item, 500)) };
      agent.output = savedOutput(agent.output);
    }
    if (JSON.stringify(this.graph.agents) === before) return false;
    this.emit('graph.redacted', 'A configured key was removed from the graph.'); return true;
  }
  // Only the process-wide graph follows the key registry (lib/server/runtime.ts); one built for a file or a test does not.
  followSecrets() { return onSecretRegistered(() => { this.redactSecrets(); }); }
  // A provider answer replaces the agent's output, bounded; a reset may already have removed the agent that asked.
  recordOutput(id: string, text: string): boolean {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) return false;
    agent.output = savedOutput(text); this.emit('agent.output', 'Answer recorded.', { agent }); return true;
  }
  connect(source: string, target: string) {
    // Authoritative validation: never trust client feedback or supplied edge IDs.
    if (source === target) throw new GraphError('Self-connections are not allowed.');
    if (!this.graph.agents.some(a => a.id === source) || !this.graph.agents.some(a => a.id === target)) throw new GraphError('Agent not found.');
    if (this.graph.edges.some(e => e.source === source && e.target === target)) throw new GraphError('Connection already exists.');
    const visited = new Set<string>();
    const reaches = (id: string): boolean => {
      if (id === source) return true;
      if (visited.has(id)) return false;
      visited.add(id); return this.graph.edges.filter(e => e.source === id).some(e => reaches(e.target));
    };
    if (reaches(target)) throw new GraphError('Connection would create a cycle.');
    this.graph.edges.push({ id: randomUUID(), source, target, kind: 'context' });
    this.record('connection.created', source, 'Connection created.', { source, destination: target });
    this.emit('edge.created', 'Connection created.', { source: this.graph.agents.find(a => a.id === source), target: this.graph.agents.find(a => a.id === target) });
  }
  disconnect(id: string) {
    const edge = this.graph.edges.find(e => e.id === id);
    if (!edge) throw new GraphError('Connection not found.');
    // A delegation is what makes its target a subagent: without it the graph could no longer be saved or restored.
    if (edge.kind === 'delegation') throw new GraphError('A delegation connection cannot be deleted on its own. Remove the subagent instead.');
    this.graph.edges = this.graph.edges.filter(e => e.id !== id);
    this.record('connection.removed', edge.source, 'Connection removed.', { source: edge.source, destination: edge.target });
    this.emit('edge.removed', 'Connection removed.', { source: this.graph.agents.find(a => a.id === edge.source), target: this.graph.agents.find(a => a.id === edge.target) });
  }
  move(id: string, position: { x: number; y: number }) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent || !Number.isFinite(position.x) || !Number.isFinite(position.y) || Math.abs(position.x) > 100000 || Math.abs(position.y) > 100000) throw new GraphError('Invalid position.');
    agent.position = { ...position }; this.emit('agent.moved', 'Agent moved.', { agent });
  }
  // Pause all pauses the agents, and a demo only while it runs: an idle, finished or blocked graph keeps its run status,
  // or the run would stay paused after the agents resume, with no demo to resume it (Round 5, R5-2).
  pauseAll() { this.graph.agents.forEach(agent => this.setAgentStatus(agent.id, 'paused')); if (this.graph.status === 'running') this.graph.status = 'paused'; this.emit('agents.paused', 'All agents paused by Pause all agents.'); }
  setRunStatus(status: Graph['status']) { this.graph.status = status; this.emit('run.updated', `Run ${status}.`); }
  setAgentStatus(id: string, status: Agent['status']) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    // Nothing but the token service's release replaces a pause it holds; the demo drives statuses around it.
    if (status !== 'paused' && this.held(id)) return;
    const from = agent.status; agent.status = status;
    if (from !== status) this.record(status === 'paused' ? 'agent.paused' : 'agent.status_changed', id, 'Agent status changed.', { status: { from, to: status } });
    this.emit('agent.updated', 'Agent status updated.', { agent });
  }
  compareAndSetAgentStatus(id: string, expected: Agent['status'], status: Agent['status']) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    if (agent.status !== expected) return false;
    this.setAgentStatus(id, status);
    return true;
  }
  appendMockOutput(id: string, character: string, charge: boolean): boolean {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    if (charge && this.graph.costCents + 1 > this.graph.budget.maxCostCents) {
      if (!this.held(id)) agent.status = 'blocked';
      this.graph.status = 'blocked';
      this.emit('budget.exhausted', 'Mock budget exhausted.', { agent }); return false;
    }
    if (charge) this.graph.costCents++;
    agent.output = savedOutput(agent.output + character); observeArtifact(id, agent.name, agent.output); this.record('agent.message', id, agent.output); this.emit('mock.delta', 'Mock output updated.', { agent }); return true;
  }
}
