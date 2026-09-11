import { observeArtifact } from '../preview/store';
import { eventBus } from '../events/bus';
// Server authority. Node imports prevent accidental use in the browser bundle.
import { randomUUID } from 'node:crypto';
import { createGraph, type Graph, type GraphEvent, type ExecutionBudget, type SpawnRequest, type Agent } from '../orchestrator';
export class GraphError extends Error {}
export class GraphService {
  private graph = createGraph();
  constructor() { this.record('agent.created', 'root', 'Coordinator created.'); }
  private record(type: import('../events/types').EventType, id: string, payload: string, extra: Partial<import('../events/types').EventInput> = {}) {
    eventBus().publish({ agent_id: id, role: this.graph.agents.find(a => a.id === id)?.name ?? 'Unknown', type, payload, ...extra });
  }
  private listeners = new Set<(event: GraphEvent) => void>();
  snapshot(): Graph { return structuredClone(this.graph); }
  subscribe(listener: (event: GraphEvent) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(type: string, message: string) {
    this.graph.revision++;
    const event: GraphEvent = { id: this.graph.revision, type, message, snapshot: this.snapshot() };
    // A transport consumer cannot mutate another consumer's event or turn a committed mutation
    // into an apparent command failure by throwing from its listener.
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Listener isolation is intentional. */ }
    }
  }
  reset(objective = this.graph.agents[0].context.objective) {
    if (!objective.trim() || objective.length > 2000) throw new GraphError('Invalid objective.');
    const revision = this.graph.revision;
    this.graph = createGraph(this.graph.budget, objective);
    this.graph.revision = revision; this.emit('graph.reset', 'Graph reset.');
  }
  setBudget(budget: ExecutionBudget) {
    if (['running', 'paused'].includes(this.graph.status)) throw new GraphError('Reset before changing limits.');
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
    return candidate;
  }
  private createAgent(callerId: string | null, request: SpawnRequest, requested?: { x: number; y: number }) {
    const parent = this.graph.agents.find(a => a.id === callerId);
    if (callerId && !parent) throw new GraphError('Parent not found.');
    if (!request.name.trim() || request.name.length > 70 || !request.context.objective.trim() ||
      request.context.objective.length > 2000 || request.context.summary.length > 2000 ||
      request.context.artifacts.length > 10 || request.context.artifacts.some(a => a.length > 500) ||
      !['Unconfigured', 'Mock'].includes(request.provider)) throw new GraphError('Invalid agent request.');
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
    this.emit('agent.created', 'Agent created.'); return id;
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
    this.emit('edge.created', 'Connection created.');
  }
  disconnect(id: string) {
    const edge = this.graph.edges.find(e => e.id === id);
    if (!edge) throw new GraphError('Connection not found.');
    this.graph.edges = this.graph.edges.filter(e => e.id !== id);
    this.record('connection.removed', edge.source, 'Connection removed.', { source: edge.source, destination: edge.target });
    this.emit('edge.removed', 'Connection removed.');
  }
  move(id: string, position: { x: number; y: number }) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent || !Number.isFinite(position.x) || !Number.isFinite(position.y) || Math.abs(position.x) > 100000 || Math.abs(position.y) > 100000) throw new GraphError('Invalid position.');
    agent.position = { ...position }; this.emit('agent.moved', 'Agent moved.');
  }
  pauseAll() { this.graph.agents.forEach(agent => this.setAgentStatus(agent.id, 'paused')); this.graph.status = 'paused'; this.emit('agents.paused', 'All agents paused by kill switch.'); }
  setRunStatus(status: Graph['status']) { this.graph.status = status; this.emit('run.updated', `Run ${status}.`); }
  setAgentStatus(id: string, status: Agent['status']) {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    const from = agent.status; agent.status = status;
    if (from !== status) this.record(status === 'paused' ? 'agent.paused' : 'agent.status_changed', id, 'Agent status changed.', { status: { from, to: status } });
    this.emit('agent.updated', 'Agent status updated.');
  }
  appendMockOutput(id: string, character: string, charge: boolean): boolean {
    const agent = this.graph.agents.find(a => a.id === id);
    if (!agent) throw new GraphError('Agent not found.');
    if (charge && this.graph.costCents + 1 > this.graph.budget.maxCostCents) {
      agent.status = 'blocked'; this.graph.status = 'blocked';
      this.emit('budget.exhausted', 'Mock budget exhausted.'); return false;
    }
    if (charge) this.graph.costCents++;
    agent.output += character; observeArtifact(id, agent.name, agent.output); this.record('agent.message', id, agent.output); this.emit('mock.delta', 'Mock output updated.'); return true;
  }
}
