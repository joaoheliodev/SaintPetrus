'use client';
// Adapted canvas geometry and interactions; all mutations go to the local server.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useEdgesState, useNodesState, useReactFlow, type Edge, type EdgeChange, type Node, type NodeProps, type NodeChange, type FinalConnectionState } from '@xyflow/react';
import { Bot, CornerDownRight, GitBranch, Maximize, Pause, Play, Plus, RotateCcw, ShieldCheck, Upload, Workflow, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { connectionFeedback, type Agent, type Graph } from '@/lib/orchestrator';
import { useProjection } from '@/lib/store';
import { useGraphTransport } from '@/lib/use-graph-transport';
import { AgentInspector } from './agent-inspector';
import { AgentStatusBadge } from './agent-status-badge';
import { agentPlacement } from '@/lib/agent-status';
import { ArtifactPreview } from './artifact-preview';
import { EventFeed } from './event-feed';
import { TokenPanel } from './token-panel';
import { ProviderStatus, connectionTarget, useProviderStatus } from './provider-status';
import type { ProviderStatusSnapshot } from '@/lib/providers/runtime';
import { allowSelectedEdgesOnly } from '@/lib/graph-deletion';
import { latestMoveSender, settledMoves } from '@/lib/node-moves';
import { cn } from '@/lib/utils';
import '@xyflow/react/dist/style.css';
type AgentNodeType = Node<{ agent: Agent }, 'agent'>;
type AgentEdgeType = Edge;
const MINIMAP = { width: 120, height: 80 };
// Compared without position: position is reconciled separately so an in-flight drag is not overwritten.
const sameAgent = (a: Agent | undefined, b: Agent) => !!a && JSON.stringify({ ...a, position: null }) === JSON.stringify({ ...b, position: null });
// Every card runs through the one global connection. A context, not node data, carries it, so a connection change
// never recreates node objects (docs/reference/react-flow-node-identity.md).
const ConnectionContext = createContext<ProviderStatusSnapshot | undefined>(undefined);
function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const a = data.agent;
  const connection = useContext(ConnectionContext);
  return <article className={cn('agent-card', selected && 'is-selected')}>
    <Handle id="input" type="target" position={Position.Left} aria-label={`Connect to ${a.name}`} />
    <div className="agent-card-head"><Bot size={20} aria-hidden="true" /><div><h3>{a.name}</h3><small>{agentPlacement(a)}</small></div></div>
    <div className="agent-card-body"><p>{a.context.objective}</p>{a.output && <p className="node-output">{a.output.slice(-120)}</p>}</div>
    <div className="agent-card-foot"><AgentStatusBadge status={a.status} /><small title="The connection Run once uses">{connection && connection.state !== 'disconnected' ? connectionTarget(connection) : 'No connection'}</small></div>
    <Handle id="output" type="source" position={Position.Right} aria-label={`Drag from ${a.name} to empty canvas to create a subagent`} />
  </article>;
}
const nodeTypes = { agent: AgentNode };
type Draft = { parentId: string | null; position?: { x: number; y: number } };
type Props = { initialGraph: Graph; mockEnabled: boolean; feedEnabled?: boolean; previewPort?: number };
function CanvasWorkspace({ initialGraph, mockEnabled, feedEnabled = false, previewPort }: Props) {
  const { graph, selectedId, notice, events, select } = useProjection();
  const { command, importGraph, pending } = useGraphTransport(initialGraph);
  const connection = useProviderStatus();
  const importInput = useRef<HTMLInputElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgentEdgeType>([]);
  const [objective, setObjective] = useState(initialGraph.agents[0].context.objective);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [limits, setLimits] = useState(initialGraph.budget);
  const flow = useReactFlow();
  // Positions the server has not confirmed yet. Without this the 300 ms poll fights an active drag.
  const unconfirmed = useRef(new Map<string, { x: number; y: number }>());
  const selected = graph.agents.find(a => a.id === selectedId) || graph.agents[0];
  const active = graph.status === 'running' || graph.status === 'paused';
  // Reconcile server agents into React Flow's own node state. Nodes that did not change keep their
  // object identity, so React Flow reuses the measured size and handle bounds instead of wiping them.
  useEffect(() => {
    setNodes(current => {
      const byId = new Map(current.map(node => [node.id, node]));
      let changed = current.length !== graph.agents.length;
      const next = graph.agents.map((agent, index) => {
        const previous = byId.get(agent.id);
        const inFlight = unconfirmed.current.get(agent.id);
        if (inFlight && inFlight.x === agent.position.x && inFlight.y === agent.position.y) unconfirmed.current.delete(agent.id);
        const position = unconfirmed.current.get(agent.id) ?? agent.position;
        const identical = previous && sameAgent(previous.data.agent, agent) && previous.position.x === position.x && previous.position.y === position.y;
        if (identical) { changed ||= current[index] !== previous; return previous; }
        changed = true;
        return { ...(previous ?? { id: agent.id, type: 'agent' as const }), id: agent.id, type: 'agent' as const, data: { agent }, position };
      });
      return changed ? next : current;
    });
  }, [graph.agents, setNodes]);
  // Edge selection is local UX state. Server snapshots remain authoritative for existence and shape.
  useEffect(() => {
    setEdges(current => {
      const byId = new Map(current.map(edge => [edge.id, edge]));
      let changed = current.length !== graph.edges.length;
      const next = graph.edges.map((edge, index) => {
        const previous = byId.get(edge.id);
        const identical = previous && previous.source === edge.source && previous.target === edge.target && previous.label === edge.kind;
        if (identical) { changed ||= current[index] !== previous; return previous; }
        changed = true;
        return { ...edge, sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed }, label: edge.kind, ...(previous?.selected ? { selected: true } : {}) };
      });
      return changed ? next : current;
    });
  }, [graph.edges, setEdges]);
  const sendMove = useCallback(async (id: string, position: { x: number; y: number }) => !!await command({ action: 'move', id, ...position }), [command]);
  const move = useMemo(() => latestMoveSender(sendMove, unconfirmed), [sendMove]);
  const changes = useCallback((items: NodeChange<AgentNodeType>[]) => {
    onNodesChange(items);
    for (const change of items) if (change.type === 'select' && change.selected) select(change.id);
    // Drag ends and arrow-key steps both settle here; a drag-stop callback would miss the keyboard.
    for (const { id, position } of settledMoves(items)) void move(id, position);
  }, [onNodesChange, select, move]);
  const edgeChanges = useCallback((items: EdgeChange<AgentEdgeType>[]) => {
    // A remove change is only a request; deletion must be accepted and reflected by the server.
    onEdgesChange(items.filter(item => item.type === 'select'));
  }, [onEdgesChange]);
  // Keyboard deletion reaches only selected connections, and only after the user confirms.
  const confirmDeletion = useCallback(async (candidates: { nodes: AgentNodeType[]; edges: AgentEdgeType[] }) => {
    const allowed = await allowSelectedEdgesOnly(candidates);
    return allowed.edges.length > 0 && window.confirm(`Delete ${allowed.edges.length === 1 ? 'the selected connection' : `${allowed.edges.length} selected connections`}? This cannot be undone.`) ? allowed : false;
  }, []);
  async function deleteEdges(items: AgentEdgeType[]) {
    for (const edge of items) await command({ action: 'disconnect', id: edge.id });
  }
  function openDraft(next: Draft) {
    const parent = next.parentId ? graph.agents.find(a => a.id === next.parentId) : undefined;
    setName(parent ? `${parent.name} subagent` : `Agent ${graph.agents.length + 1}`);
    setGoal(''); setDraft(next);
  }
  async function add() {
    const snapshot = await command({ action: 'add', name, objective: goal, parentId: draft?.parentId ?? null, ...(draft?.position ?? {}) });
    if (!snapshot) return;
    setDraft(null); setGoal('');
    // Send the user straight to what they just made instead of leaving them to hunt for it.
    const created = snapshot.agents.find(agent => !graph.agents.some(existing => existing.id === agent.id));
    if (created) { select(created.id); void flow.setCenter(created.position.x + 145, created.position.y + 100, { zoom: .9, duration: 300 }); }
  }
  async function connect(source: string, target: string) {
    // UX feedback only; bypassing this check cannot bypass server-side validation.
    const message = connectionFeedback(graph, source, target);
    if (message) { useProjection.setState({ notice: message }); return; }
    await command({ action: 'connect', source, target });
  }
  // Dropping a connection on empty canvas is the shortest path from "I want a subagent" to having one.
  // Only an empty drop counts: a rejected drop on a real node is a failed connection, not a request.
  function connectEnd(event: MouseEvent | TouchEvent, state: FinalConnectionState) {
    if (state.isValid || state.toNode || !state.fromNode) return;
    openDraft({ parentId: state.fromNode.id, position: dropPoint(event) });
  }
  function dropPoint(event: { clientX: number; clientY: number } | MouseEvent | TouchEvent) {
    const point = 'changedTouches' in event ? event.changedTouches[0] : event as { clientX: number; clientY: number };
    // Offset by half a card so the new node lands under the pointer rather than beside it.
    return flow.screenToFlowPosition({ x: point.clientX - 145, y: point.clientY - 60 });
  }
  // React Flow has no onPaneDoubleClick, so the pane is identified explicitly: without this the
  // handler also fires for double-clicks on cards.
  function paneDoubleClick(event: React.MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
    openDraft({ parentId: null, position: dropPoint(event.nativeEvent) });
  }
  const parentName = draft?.parentId ? graph.agents.find(a => a.id === draft.parentId)?.name : undefined;
  const lonely = graph.agents.length === 1 && !graph.edges.length;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><Workflow /><strong>SaintPetrus</strong><span className={cn('mode-badge', mockEnabled ? 'is-mock' : 'is-real')} title={mockEnabled ? 'MOCK mode: no provider is reachable.' : 'REAL mode: calls can reach a provider and cost money.'}>{mockEnabled ? 'MOCK' : 'REAL'}</span></div><ProviderStatus source={connection} /><TokenPanel /></header>
    <div className="projectbar"><h1>Agent workspace <small>M0</small></h1><div className="project-actions">
      <Button variant="outline" disabled={pending} onClick={() => { if (window.confirm('Reset the graph? Every agent except the coordinator, every connection and all output are removed. This cannot be undone.')) void command({ action: 'reset', objective }); }}><RotateCcw />Reset graph</Button>
      <a className={buttonVariants({ variant: 'outline' })} href="/api/graph/export" download>Export graph</a>
      <Button variant="outline" disabled={pending || active} onClick={() => importInput.current?.click()}><Upload />Import graph</Button>
      <input ref={importInput} type="file" accept="application/json,.json" hidden aria-label="Graph file to import" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && window.confirm(`Import ${file.name}? It replaces every agent, connection and output on the canvas. Token accounting is not part of the file and is unchanged.`)) void file.text().then(importGraph); }} />
      <Button variant="outline" disabled={pending || !selected} onClick={() => openDraft({ parentId: selected.id })}><CornerDownRight />Add subagent</Button>
      {mockEnabled && previewPort && <Button disabled={pending} onClick={() => { if (window.confirm('Load the preview demo? It replaces the current graph with a synthetic preview demonstration; your agents and connections are removed.')) void command({ action: 'preview-mock' }); }}>Load preview demo</Button>}
      {mockEnabled && <Button disabled={pending} onClick={() => { const action = graph.status === 'running' ? 'pause' : graph.status === 'paused' ? 'resume' : 'start'; if (action !== 'start' || window.confirm('Load the demo? It replaces the current graph with a fixed synthetic demo; your agents and connections are removed.')) void command({ action, objective }); }}>{graph.status === 'running' ? <Pause /> : <Play />}{graph.status === 'running' ? 'Pause demo' : graph.status === 'paused' ? 'Resume demo' : 'Load demo'}</Button>}
    </div></div>
    <div className="workspace-body"><aside className="setup-panel">
      <div className="panel-title"><GitBranch size={17} />Graph agents <span>{graph.agents.length}</span></div>
      <div className="setup-section"><label htmlFor="objective">Project objective</label><textarea id="objective" value={objective} maxLength={2000} disabled={active} onChange={e => setObjective(e.target.value)} /><p className="helper">Used when resetting the graph.</p></div>
      <div className="agent-list">{graph.agents.map(a => <div key={a.id} className={cn('agent-list-item', selectedId === a.id && 'active')}>
        <button className="agent-list-open" onClick={() => { select(a.id); void flow.setCenter(a.position.x + 145, a.position.y + 100, { zoom: .9, duration: 300 }); }}><Bot size={17} /><span>{a.name}</span></button>
        <button className="agent-list-add" aria-label={`Add subagent under ${a.name}`} title={`Add subagent under ${a.name}`} disabled={pending} onClick={() => openDraft({ parentId: a.id })}><Plus size={15} /></button>
      </div>)}</div>
      {mockEnabled && <section className="budget-card"><h2>Mock limits</h2><p>Fictitious cost: ${(graph.costCents / 100).toFixed(2)} / ${(graph.budget.maxCostCents / 100).toFixed(2)}</p><Progress aria-label="Mock budget used" value={graph.costCents / graph.budget.maxCostCents * 100} />
        <label>Max depth<input type="number" min={1} max={5} value={limits.maxDepth} disabled={active} onChange={e => setLimits({ ...limits, maxDepth: Number(e.target.value) })} /></label>
        <label>Max agents<input type="number" min={1} max={50} value={limits.maxNodes} disabled={active} onChange={e => setLimits({ ...limits, maxNodes: Number(e.target.value) })} /></label>
        <label>Mock cents<input type="number" min={1} max={10000} value={limits.maxCostCents} disabled={active} onChange={e => setLimits({ ...limits, maxCostCents: Number(e.target.value) })} /></label>
        <Button disabled={active || pending} variant="outline" onClick={() => command({ action: 'budget', depth: limits.maxDepth, nodes: limits.maxNodes, cents: limits.maxCostCents })}>Apply limits</Button>
      </section>}
      <p className="helper setup-section">The graph is saved in your user data directory and restored when the server starts; token accounting is not. Only Run once and connection tests call a provider, and only when you click them.{mockEnabled && ' Load demo replaces the graph with a fixed demonstration.'}</p>
    </aside><div className="center-panel"><div className="canvas-toolbar"><span>Canvas · {graph.agents.length} nodes · {graph.edges.length} connections</span><div className="project-actions">
      <Button disabled={pending} onClick={() => openDraft({ parentId: null })}><Plus />Add agent</Button>
      <Button variant="ghost" onClick={() => flow.fitView({ padding: .2, maxZoom: 1, duration: 300 })}><Maximize />Fit all</Button>
    </div></div>
      <div className="canvas-area"><ConnectionContext.Provider value={connection.status}><ReactFlow<AgentNodeType, AgentEdgeType> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes} onEdgesChange={edgeChanges} onBeforeDelete={confirmDeletion} onEdgesDelete={deleteEdges} onNodeClick={(_, n) => select(n.id)} onConnect={c => connect(c.source, c.target)} onConnectEnd={connectEnd} onPaneClick={() => useProjection.setState({ notice: '' })} onDoubleClick={paneDoubleClick} zoomOnDoubleClick={false} minZoom={.25} maxZoom={1.5} deleteKeyCode={['Backspace', 'Delete']} colorMode="dark" fitView fitViewOptions={{ maxZoom: 1, padding: .25 }} aria-label="Agent graph"><Background /><Controls showInteractive={false} /><MiniMap pannable zoomable style={MINIMAP} /></ReactFlow></ConnectionContext.Provider>
        {lonely && <div className="canvas-hint"><p><strong>Two ways to grow the graph</strong></p><p>Drag from the dot on the right edge of a card and release on empty canvas — that creates a subagent already connected.</p><p>Or double-click anywhere empty to drop a standalone agent there.</p></div>}
      </div>
      <section className="event-panel" aria-label="Graph events"><div className="panel-title">Server events · revision {graph.revision}</div><div className="event-list">{events.length ? events.map(event => <p key={event.id}>{event.type} — {event.message}</p>) : <p>Ready. Add an agent to create your first connection.</p>}</div></section>
    </div><AgentInspector key={selected.id} agent={selected} agents={graph.agents} pending={pending} command={command} connect={connect} /></div>
    <div className="aux-panels">
      {feedEnabled ? <EventFeed /> : <p className="helper">Live feed disabled on server. Enable SAINTPETRUS_FEED and restart.</p>}
      {previewPort ? <ArtifactPreview port={previewPort} /> : <p className="helper">Preview disabled: it executes LLM-generated code in an isolated sandbox. Enable SAINTPETRUS_PREVIEW on the server and restart.</p>}
    </div>
    <footer className="statusbar">Local server · 127.0.0.1 <span>{mockEnabled ? `Demo: ${graph.status}` : 'REAL mode · demo unavailable'}</span></footer>
    {notice && <div role="alert" className="notice"><ShieldCheck /><span>{notice}</span><Button variant="ghost" size="icon" aria-label="Dismiss notice" onClick={() => useProjection.setState({ notice: '' })}><X /></Button></div>}
    <Dialog open={!!draft} onOpenChange={open => setDraft(open ? draft : null)}><DialogContent>
      <DialogTitle>{parentName ? 'Add subagent' : 'Add agent'}</DialogTitle>
      <DialogDescription>{parentName ? `Connected to ${parentName} as a delegation, at level ${(graph.agents.find(a => a.id === draft?.parentId)?.depth ?? 0) + 1}.` : 'Standalone agent. Drag between handles later to connect it.'}</DialogDescription>
      <label>Name<input autoFocus value={name} maxLength={70} onChange={e => setName(e.target.value)} /></label>
      <label>Objective<textarea value={goal} maxLength={2000} placeholder="What should this agent be responsible for?" onChange={e => setGoal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && name.trim() && goal.trim()) void add(); }} /></label>
      {notice && <p role="alert">{notice}</p>}
      <Button disabled={pending || !name.trim() || !goal.trim()} onClick={add}><Plus />{parentName ? 'Create subagent' : 'Create agent'}</Button>
    </DialogContent></Dialog>
  </main>;
}
export default function Workspace(props: Props) { return <ReactFlowProvider><CanvasWorkspace {...props} /></ReactFlowProvider>; }
