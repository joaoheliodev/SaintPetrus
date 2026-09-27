'use client';
// Adapted canvas geometry and interactions; all mutations go to the local server.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useEdgesState, useNodesState, useReactFlow, type Edge, type EdgeChange, type Node, type NodeProps, type NodeChange, type FinalConnectionState } from '@xyflow/react';
import { Bot, CornerDownRight, Crown, Download, Ellipsis, Gauge, GitBranch, History, LayoutGrid, Maximize, Plug, Tag, Pause, Play, Plus, RotateCcw, ShieldCheck, Upload, Workflow, X } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { connectionFeedback, type Agent, type Graph } from '@/lib/orchestrator';
import { useProjection } from '@/lib/store';
import { useGraphTransport } from '@/lib/use-graph-transport';
import { AgentInspector } from './agent-inspector';
import { BudgetsView, PauseAllButton, PricesView, useTokenSnapshot } from './token-panel';
import { AgentStatusBadge } from './agent-status-badge';
import { agentPlacement } from '@/lib/agent-status';
import { ArtifactPreview } from './artifact-preview';
import { EventFeed } from './event-feed';
import { ConnectionChip, ConnectionView, connectionTarget, useProviderStatus } from './provider-status';
import type { ProviderStatusSnapshot } from '@/lib/providers/runtime';
import type { RunExchange } from '@/lib/run-exchange';
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
type View = 'workspace' | 'activity' | 'budgets' | 'prices' | 'connection';
type Draft = { parentId: string | null; position?: { x: number; y: number } };
type Props = { initialGraph: Graph; mockEnabled: boolean; feedEnabled?: boolean; previewPort?: number };
function CanvasWorkspace({ initialGraph, mockEnabled, feedEnabled = false, previewPort }: Props) {
  const { graph, selectedId, notice, events, select } = useProjection();
  const { command, importGraph, pending } = useGraphTransport(initialGraph);
  const connection = useProviderStatus(); const tokens = useTokenSnapshot();
  // Which view fills the main column; presentation state in memory only.
  const [view, setView] = useState<View>('workspace');
  const importInput = useRef<HTMLInputElement>(null); const exportLink = useRef<HTMLAnchorElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  // Each agent's last Run once, in memory only: never sent back, saved or put in browser storage.
  const [exchanges, setExchanges] = useState<Record<string, RunExchange>>({});
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
  // Each of these replaces the whole canvas, so each asks first; the texts are the ones the browser check answers.
  function loadDemo() { if (window.confirm('Load the demo? It replaces the current graph with a fixed synthetic demo; your agents and connections are removed.')) void command({ action: 'start', objective }); }
  function loadPreviewDemo() { if (window.confirm('Load the preview demo? It replaces the current graph with a synthetic preview demonstration; your agents and connections are removed.')) void command({ action: 'preview-mock' }); }
  async function resetGraph() {
    if (!window.confirm('Reset the graph? Every agent except the coordinator, every connection and all output are removed. This cannot be undone.')) return;
    if (await command({ action: 'reset', objective })) setResetOpen(false);
  }
  const applyLimits = () => command({ action: 'budget', depth: limits.maxDepth, nodes: limits.maxNodes, cents: limits.maxCostCents });
  const parentName = draft?.parentId ? graph.agents.find(a => a.id === draft.parentId)?.name : undefined;
  const lonely = graph.agents.length === 1 && !graph.edges.length;
  const views: { id: View; label: string; icon: typeof Bot }[] = [
    { id: 'workspace', label: 'Workspace', icon: LayoutGrid }, { id: 'activity', label: 'Activity', icon: History },
    { id: 'budgets', label: 'Budgets', icon: Gauge }, { id: 'prices', label: 'Prices', icon: Tag }, { id: 'connection', label: 'Connection', icon: Plug },
  ];
  function openAgent(agent: Agent) { setView('workspace'); select(agent.id); void flow.setCenter(agent.position.x + 145, agent.position.y + 100, { zoom: .9, duration: 300 }); }
  return <main className="app-shell">
    <aside className="sidebar" aria-label="Navigation">
      <div className="brand"><Workflow aria-hidden="true" /><strong>SaintPetrus</strong><span className={cn('mode-badge', mockEnabled ? 'is-mock' : 'is-real')} title={mockEnabled ? 'MOCK mode: no provider is reachable.' : 'REAL mode: calls can reach a provider and cost money.'}>{mockEnabled ? 'MOCK' : 'REAL'}</span></div>
      <nav aria-label="Views" className="sidebar-nav">{views.map(item => <button key={item.id} type="button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}><item.icon size={16} aria-hidden="true" />{item.label}</button>)}</nav>
      <div className="sidebar-label"><GitBranch size={14} aria-hidden="true" />Agents <span>{graph.agents.length}</span></div>
      <div className="agent-list">{graph.agents.map(a => <div key={a.id} className={cn('agent-list-item', selectedId === a.id && 'active')}>
        <button className="agent-list-open" onClick={() => openAgent(a)}><AgentStatusBadge status={a.status} compact /><span>{a.name}</span>{a.id === 'root' && <Crown className="role-mark" size={14} aria-label="Coordinator" />}</button>
        <button className="agent-list-add" aria-label={`Add subagent under ${a.name}`} title={`Add subagent under ${a.name}`} disabled={pending} onClick={() => { setView('workspace'); openDraft({ parentId: a.id }); }}><Plus size={15} /></button>
      </div>)}</div>
      <div className="sidebar-footer">
      <details className="budget-card" aria-label="Graph limits"><summary>Graph limits <small>depth {graph.budget.maxDepth} · {graph.budget.maxNodes} agents</small></summary><p className="helper">How deep and how large the graph may grow.</p>
        <label>Max depth<input type="number" min={1} max={5} value={limits.maxDepth} disabled={active} onChange={e => setLimits({ ...limits, maxDepth: Number(e.target.value) })} /></label>
        <label>Max agents<input type="number" min={1} max={50} value={limits.maxNodes} disabled={active} onChange={e => setLimits({ ...limits, maxNodes: Number(e.target.value) })} /></label>
        <Button disabled={active || pending} variant="outline" onClick={applyLimits}>Apply graph limits</Button>
      </details>
      {mockEnabled && <details className="budget-card" aria-label="Demo cost"><summary>Demo cost <small>${(graph.costCents / 100).toFixed(2)} of ${(graph.budget.maxCostCents / 100).toFixed(2)}</small></summary><p className="helper">Fictitious spend of the demo only. Budgets holds real accounting.</p><p>${(graph.costCents / 100).toFixed(2)} of ${(graph.budget.maxCostCents / 100).toFixed(2)}</p><Progress aria-label="Demo cost used" value={graph.costCents / graph.budget.maxCostCents * 100} />
        <label>Demo cost limit (cents)<input type="number" min={1} max={10000} value={limits.maxCostCents} disabled={active} onChange={e => setLimits({ ...limits, maxCostCents: Number(e.target.value) })} /></label>
        <Button disabled={active || pending} variant="outline" onClick={applyLimits}>Apply demo cost limit</Button>
      </details>}
      <p className="helper">The graph is saved on this machine; token accounting is not. Only Run once and connection tests call a provider, and only when you click them.</p>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar"><ConnectionChip source={connection} open={() => setView('connection')} /><div className="topbar-actions"><PauseAllButton tokens={tokens} /></div></header>
      {/* The canvas stays laid out under the other views: React Flow measures nodes and draws its background from its own size. */}
      <div className={cn('workspace-view', view !== 'workspace' && 'is-away')} inert={view !== 'workspace'}><div className="center-panel"><div className="canvas-toolbar"><span>Canvas · {graph.agents.length} {graph.agents.length === 1 ? 'agent' : 'agents'} · {graph.edges.length} {graph.edges.length === 1 ? 'connection' : 'connections'}</span><div className="project-actions">
      <Button disabled={pending} onClick={() => openDraft({ parentId: null })}><Plus />Add agent</Button>
      <Button variant="outline" disabled={pending || !selected} onClick={() => openDraft({ parentId: selected.id })}><CornerDownRight />Add subagent</Button>
      <Button variant="ghost" onClick={() => flow.fitView({ padding: .2, maxZoom: 1, duration: 300 })}><Maximize />Fit all</Button>
      {mockEnabled && active && <Button variant="outline" disabled={pending} onClick={() => void command({ action: graph.status === 'running' ? 'pause' : 'resume' })}>{graph.status === 'running' ? <Pause /> : <Play />}{graph.status === 'running' ? 'Pause demo' : 'Resume demo'}</Button>}
      {/* Everything that replaces or leaves the canvas sits one menu away, and each replacement asks first. */}
      <Menu><MenuTrigger render={<Button variant="outline" />}><Ellipsis />More</MenuTrigger>
        <MenuContent aria-label="More graph actions">
          <MenuItem disabled={pending || active} onClick={() => importInput.current?.click()}><Upload />Import graph…</MenuItem>
          <MenuItem onClick={() => exportLink.current?.click()}><Download />Export graph</MenuItem>
          <MenuItem disabled={pending || active} onClick={() => setResetOpen(true)}><RotateCcw />Reset graph…</MenuItem>
          {mockEnabled && <><MenuSeparator />
            <MenuItem disabled={pending || active} onClick={loadDemo}><Play />Load demo…</MenuItem>
            {previewPort && <MenuItem disabled={pending || active} onClick={loadPreviewDemo}><Play />Load preview demo…</MenuItem>}</>}
        </MenuContent>
      </Menu>
      <a ref={exportLink} href="/api/graph/export" download hidden tabIndex={-1}>Export graph</a>
      <input ref={importInput} type="file" accept="application/json,.json" hidden aria-label="Graph file to import" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && window.confirm(`Import ${file.name}? It replaces every agent, connection and output on the canvas. Token accounting is not part of the file and is unchanged.`)) void file.text().then(importGraph); }} />
    </div></div>
      <div className="canvas-area"><ConnectionContext.Provider value={connection.status}><ReactFlow<AgentNodeType, AgentEdgeType> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes} onEdgesChange={edgeChanges} onBeforeDelete={confirmDeletion} onEdgesDelete={deleteEdges} onNodeClick={(_, n) => select(n.id)} onConnect={c => connect(c.source, c.target)} onConnectEnd={connectEnd} onPaneClick={() => useProjection.setState({ notice: '' })} onDoubleClick={paneDoubleClick} zoomOnDoubleClick={false} minZoom={.25} maxZoom={1.5} deleteKeyCode={['Backspace', 'Delete']} colorMode="dark" fitView fitViewOptions={{ maxZoom: 1, padding: .25 }} aria-label="Agent graph"><Background /><Controls showInteractive={false} /><MiniMap pannable zoomable style={MINIMAP} /></ReactFlow></ConnectionContext.Provider>
        {lonely && <div className="canvas-hint"><p><strong>Two ways to grow the graph</strong></p><p>Drag from the dot on the right edge of a card and release on empty canvas — that creates a subagent already connected.</p><p>Or double-click anywhere empty to drop a standalone agent there.</p>{mockEnabled && <p>Just looking around? <Button variant="link" disabled={pending} onClick={loadDemo}>Load demo…</Button> It replaces this canvas with a fixed demonstration.</p>}</div>}
      </div>
      <Tabs className="drawer" defaultValue="activity"><TabsList aria-label="Canvas panels"><TabsTrigger value="activity">Activity</TabsTrigger>{previewPort && <TabsTrigger value="preview">Preview</TabsTrigger>}</TabsList>
        <TabsContent value="activity" keepMounted><section className="event-panel" aria-label="Graph events"><div className="panel-title">Server events · revision {graph.revision}</div><div className="event-list">{events.length ? events.map(event => <p key={event.id}>{event.type} — {event.message}</p>) : <p>Ready. Add an agent to create your first connection.</p>}</div></section></TabsContent>
        {previewPort && <TabsContent value="preview" keepMounted><ArtifactPreview port={previewPort} /></TabsContent>}
      </Tabs>
      </div><AgentInspector key={selected.id} agent={selected} agents={graph.agents} pending={pending} command={command} connect={connect} connection={connection.status} exchange={exchanges[selected.id]} onExchange={exchange => setExchanges(current => ({ ...current, [selected.id]: exchange }))} /></div>
      {view === 'activity' && <section className="view" aria-labelledby="activity-title"><h1 id="activity-title">Activity</h1>{feedEnabled ? <EventFeed /> : <p className="helper">The live event feed is off. See Optional features in Connection.</p>}</section>}
      {view === 'budgets' && <BudgetsView tokens={tokens} />}
      {view === 'prices' && <PricesView tokens={tokens} />}
      {view === 'connection' && <ConnectionView source={connection}><section className="optional-features" aria-labelledby="optional-title"><h2 id="optional-title">Optional features</h2>
        <p>{feedEnabled ? 'Live event feed: on (see Activity).' : 'Live event feed: off. Enable SAINTPETRUS_FEED on the server and restart.'}</p>
        <p>{previewPort ? 'Artifact preview: on (see the Preview tab under the canvas).' : 'Artifact preview: off. It executes LLM-generated code in an isolated sandbox. Enable SAINTPETRUS_PREVIEW on the server and restart.'}</p>
      </section></ConnectionView>}
    </div>
    {notice && <div role="alert" className="notice"><ShieldCheck /><span>{notice}</span><Button variant="ghost" size="icon" aria-label="Dismiss notice" onClick={() => useProjection.setState({ notice: '' })}><X /></Button></div>}
    <Dialog open={!!draft} onOpenChange={open => setDraft(open ? draft : null)}><DialogContent>
      <DialogTitle>{parentName ? 'Add subagent' : 'Add agent'}</DialogTitle>
      <DialogDescription>{parentName ? `Connected to ${parentName} as a delegation, at level ${(graph.agents.find(a => a.id === draft?.parentId)?.depth ?? 0) + 1}.` : 'Standalone agent. Drag between handles later to connect it.'}</DialogDescription>
      <label>Name<input autoFocus value={name} maxLength={70} onChange={e => setName(e.target.value)} /></label>
      <label>Objective<textarea value={goal} maxLength={2000} placeholder="What should this agent be responsible for?" onChange={e => setGoal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && name.trim() && goal.trim()) void add(); }} /></label>
      {notice && <p role="alert">{notice}</p>}
      <Button disabled={pending || !name.trim() || !goal.trim()} onClick={add}><Plus />{parentName ? 'Create subagent' : 'Create agent'}</Button>
    </DialogContent></Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent>
      <DialogTitle>Reset graph</DialogTitle>
      <DialogDescription>Removes every agent except the Coordinator, every connection and all output. Token accounting is not touched.</DialogDescription>
      <label htmlFor="objective">Coordinator objective</label><textarea id="objective" value={objective} maxLength={2000} disabled={active} onChange={e => setObjective(e.target.value)} />
      <p className="helper">The objective the Coordinator receives when the graph is reset{mockEnabled ? ' or the demo is loaded' : ''}.</p>
      <Button variant="destructive" disabled={pending || active || !objective.trim()} onClick={() => void resetGraph()}><RotateCcw />Reset graph</Button>
    </DialogContent></Dialog>
  </main>;
}
export default function Workspace(props: Props) { return <ReactFlowProvider><CanvasWorkspace {...props} /></ReactFlowProvider>; }
