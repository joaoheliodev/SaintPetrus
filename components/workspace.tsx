'use client';
// Adapted canvas geometry and interactions; all mutations go to the local server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useReactFlow, type Node, type NodeProps, type NodeChange, type FinalConnectionState } from '@xyflow/react';
import { Bot, Check, CornerDownRight, GitBranch, Maximize, Pause, Play, Plus, RotateCcw, ShieldCheck, Workflow, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { connectionFeedback, type Agent, type Graph } from '@/lib/orchestrator';
import { useProjection } from '@/lib/store';
import { useGraphTransport } from '@/lib/use-graph-transport';
import { ArtifactPreview } from './artifact-preview';
import { EventFeed } from './event-feed';
import { TokenPanel } from './token-panel';
import { ProviderStatus } from './provider-status';
import { cn } from '@/lib/utils';
import '@xyflow/react/dist/style.css';
type AgentNodeType = Node<{ agent: Agent }, 'agent'>;
const statusLabels = { paused: 'Paused', ready: 'Ready', running: 'Running', completed: 'Completed', blocked: 'Blocked' };
const MINIMAP = { width: 120, height: 80 };
// Compared without position: position is reconciled separately so an in-flight drag is not overwritten.
const sameAgent = (a: Agent | undefined, b: Agent) => !!a && JSON.stringify({ ...a, position: null }) === JSON.stringify({ ...b, position: null });
function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const a = data.agent;
  return <article className={cn('agent-card', selected && 'is-selected')}>
    <Handle id="input" type="target" position={Position.Left} aria-label={`Connect to ${a.name}`} />
    <div className="agent-card-head"><Bot size={20} /><div><small>{a.provider}</small><h3>{a.name}</h3></div><span>L{a.depth}</span></div>
    <div className="agent-card-body"><p>{a.context.objective}</p>{a.output && <p className="node-output">{a.output.slice(-120)}</p>}</div>
    <div className="agent-card-foot"><span className="status"><Check size={14} />{statusLabels[a.status]}</span><span>{a.parentId ? 'Subagent' : 'Agent'}</span></div>
    <Handle id="output" type="source" position={Position.Right} aria-label={`Drag from ${a.name} to empty canvas to create a subagent`} />
  </article>;
}
const nodeTypes = { agent: AgentNode };
type Draft = { parentId: string | null; position?: { x: number; y: number } };
type Props = { initialGraph: Graph; mockEnabled: boolean; feedEnabled?: boolean; previewPort?: number };
function CanvasWorkspace({ initialGraph, mockEnabled, feedEnabled = false, previewPort }: Props) {
  const { graph, selectedId, notice, events, select } = useProjection();
  const { command, pending } = useGraphTransport(initialGraph);
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeType>([]);
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
  const edges = useMemo(() => graph.edges.map(edge => ({ ...edge, sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed }, label: edge.kind })), [graph.edges]);
  const changes = useCallback((items: NodeChange<AgentNodeType>[]) => {
    onNodesChange(items);
    for (const change of items) if (change.type === 'select' && change.selected) select(change.id);
  }, [onNodesChange, select]);
  async function move(id: string, position: { x: number; y: number }) {
    unconfirmed.current.set(id, position);
    if (!await command({ action: 'move', id, ...position })) unconfirmed.current.delete(id);
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
    <header className="topbar"><div className="brand"><Workflow /><strong>SaintPetrus</strong></div><ProviderStatus /><TokenPanel /></header>
    <div className="projectbar"><h1>Agent workspace <small>M0</small></h1><div className="project-actions">
      <Button variant="outline" disabled={pending} onClick={() => command({ action: 'reset', objective })}><RotateCcw />Reset graph</Button>
      <Button disabled={pending} onClick={() => openDraft({ parentId: null })}><Plus />Add agent</Button>
      <Button variant="outline" disabled={pending || !selected} onClick={() => openDraft({ parentId: selected.id })}><CornerDownRight />Add subagent</Button>
      {mockEnabled && previewPort && <Button disabled={pending} onClick={() => command({ action: 'preview-mock' })}>Run preview mock</Button>}
      {mockEnabled && <Button disabled={pending} onClick={() => command({ action: graph.status === 'running' ? 'pause' : graph.status === 'paused' ? 'resume' : 'start', objective })}>{graph.status === 'running' ? <Pause /> : <Play />}{graph.status === 'running' ? 'Pause mock' : graph.status === 'paused' ? 'Resume mock' : 'Run mock'}</Button>}
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
      <p className="helper setup-section">Local, in-memory graph. No API calls to LLMs. Server restart clears the graph.{mockEnabled && ' Run mock resets the graph to a fixed demonstration.'}</p>
    </aside><div className="center-panel"><div className="canvas-toolbar"><span>Canvas · {graph.agents.length} nodes · {graph.edges.length} connections</span><div className="project-actions">
      <Button variant="ghost" disabled={pending} onClick={() => openDraft({ parentId: null })}><Plus />Add agent</Button>
      <Button variant="ghost" onClick={() => flow.fitView({ padding: .2, maxZoom: 1, duration: 300 })}><Maximize />Fit all</Button>
    </div></div>
      <div className="canvas-area"><ReactFlow<AgentNodeType> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes} onNodeClick={(_, n) => select(n.id)} onNodeDragStop={(_, n) => move(n.id, n.position)} onConnect={c => connect(c.source, c.target)} onConnectEnd={connectEnd} onPaneClick={() => useProjection.setState({ notice: '' })} onDoubleClick={paneDoubleClick} zoomOnDoubleClick={false} minZoom={.25} maxZoom={1.5} deleteKeyCode={null} colorMode="dark" fitView fitViewOptions={{ maxZoom: 1, padding: .25 }} aria-label="Agent graph"><Background /><Controls showInteractive={false} /><MiniMap pannable zoomable style={MINIMAP} /></ReactFlow>
        {lonely && <div className="canvas-hint"><p><strong>Two ways to grow the graph</strong></p><p>Drag from the dot on the right edge of a card and release on empty canvas — that creates a subagent already connected.</p><p>Or double-click anywhere empty to drop a standalone agent there.</p></div>}
      </div>
      <section className="event-panel" aria-label="Graph events"><div className="panel-title">Server events · revision {graph.revision}</div><div className="event-list">{events.length ? events.slice(-5).reverse().map(event => <p key={event.id}>{event.type} — {event.message}</p>) : <p>Ready. Add an agent to create your first connection.</p>}</div></section>
    </div><aside className="inspector"><div className="panel-title">Agent inspector</div><div className="inspector-profile"><Bot /><h2>{selected.name}</h2></div><p className="status"><Check size={15} />{statusLabels[selected.status]} · {selected.provider}</p>
      <Tabs defaultValue="context"><TabsList><TabsTrigger value="context">Context</TabsTrigger><TabsTrigger value="output">Output</TabsTrigger></TabsList><TabsContent value="context"><h3>Objective</h3><p>{selected.context.objective}</p><h3>Executive summary</h3><p>{selected.context.summary}</p><div className="context-note"><ShieldCheck /><span>Isolated context envelope. Parent transcript is not inherited.</span></div></TabsContent><TabsContent value="output"><pre>{selected.output || 'No provider output.'}</pre></TabsContent></Tabs>
    </aside></div>
    <div className="aux-panels">
      {feedEnabled ? <EventFeed /> : <p className="helper">Live feed disabled on server. Enable SAINTPETRUS_FEED and restart.</p>}
      {previewPort ? <ArtifactPreview port={previewPort} /> : <p className="helper">Preview disabled: it executes LLM-generated code in an isolated sandbox. Enable SAINTPETRUS_PREVIEW on the server and restart.</p>}
    </div>
    <footer className="statusbar">Local server · 127.0.0.1 <span>{mockEnabled ? `Mock: ${graph.status}` : 'Mock disabled'}</span></footer>
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
