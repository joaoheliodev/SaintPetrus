'use client';
// Adapted canvas geometry and interactions; all mutations go to the local server.
import { useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow, type Node, type NodeProps, type NodeChange } from '@xyflow/react';
import { Bot, Check, GitBranch, Maximize, Pause, Play, Plus, RotateCcw, ShieldCheck, Workflow, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { connectionFeedback, type Agent, type Graph } from '@/lib/orchestrator';
import { useProjection } from '@/lib/store';
import { useGraphTransport } from '@/lib/use-graph-transport';
import { ProviderStatus } from './provider-status';
import { cn } from '@/lib/utils';
import '@xyflow/react/dist/style.css';
type AgentNodeType = Node<{ agent: Agent }, 'agent'>;
const statusLabels = { ready: 'Ready', running: 'Running', completed: 'Completed', blocked: 'Blocked' };
function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const a = data.agent;
  return <article className={cn('agent-card', selected && 'is-selected')}>
    <Handle id="input" type="target" position={Position.Left} aria-label={`Connect to ${a.name}`} />
    <div className="agent-card-head"><Bot size={20} /><div><small>{a.provider}</small><h3>{a.name}</h3></div><span>L{a.depth}</span></div>
    <div className="agent-card-body"><p>{a.context.objective}</p>{a.output && <p className="node-output">{a.output.slice(-120)}</p>}</div>
    <div className="agent-card-foot"><span className="status"><Check size={14} />{statusLabels[a.status]}</span><span>{a.parentId ? 'Subagent' : 'Agent'}</span></div>
    <Handle id="output" type="source" position={Position.Right} aria-label={`Connect from ${a.name}`} />
  </article>;
}
const nodeTypes = { agent: AgentNode };
type Props = { initialGraph: Graph; mockEnabled: boolean };
function CanvasWorkspace({ initialGraph, mockEnabled }: Props) {
  const { graph, selectedId, notice, events, select } = useProjection();
  const { command, pending } = useGraphTransport(initialGraph);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [objective, setObjective] = useState(initialGraph.agents[0].context.objective);
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('Specialist');
  const [goal, setGoal] = useState('');
  const [limits, setLimits] = useState(initialGraph.budget);
  const flow = useReactFlow();
  const selected = graph.agents.find(a => a.id === selectedId) || graph.agents[0];
  const active = graph.status === 'running' || graph.status === 'paused';
  const nodes: AgentNodeType[] = useMemo(() => graph.agents.map(agent => ({ id: agent.id, type: 'agent', data: { agent }, position: positions[agent.id] || agent.position, selected: selectedId === agent.id })), [graph.agents, positions, selectedId]);
  const edges = useMemo(() => graph.edges.map(edge => ({ ...edge, sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed }, label: edge.kind })), [graph.edges]);
  function changes(items: NodeChange<AgentNodeType>[]) {
    for (const change of items) {
      if (change.type === 'position' && change.position) setPositions(current => ({ ...current, [change.id]: change.position! }));
      if (change.type === 'select' && change.selected) select(change.id);
    }
  }
  async function move(id: string, position: { x: number; y: number }) {
    await command({ action: 'move', id, ...position });
    setPositions(current => { const copy = { ...current }; delete copy[id]; return copy; });
  }
  async function add() {
    if (await command({ action: 'add', name, objective: goal })) { setDialog(false); setGoal(''); }
  }
  async function connect(source: string, target: string) {
    // UX feedback only; bypassing this check cannot bypass server-side validation.
    const message = connectionFeedback(graph, source, target);
    if (message) { useProjection.setState({ notice: message }); return; }
    await command({ action: 'connect', source, target });
  }
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><Workflow /><strong>SaintPetrus</strong></div><ProviderStatus /></header>
    <div className="projectbar"><h1>Agent workspace <small>M0</small></h1><div className="project-actions">
      <Button variant="outline" disabled={pending} onClick={() => command({ action: 'reset', objective })}><RotateCcw />Reset graph</Button>
      <Button disabled={pending} onClick={() => setDialog(true)}><Plus />Add agent</Button>
      {mockEnabled && <Button disabled={pending} onClick={() => command({ action: graph.status === 'running' ? 'pause' : graph.status === 'paused' ? 'resume' : 'start', objective })}>{graph.status === 'running' ? <Pause /> : <Play />}{graph.status === 'running' ? 'Pause mock' : graph.status === 'paused' ? 'Resume mock' : 'Run mock'}</Button>}
    </div></div>
    <div className="workspace-body"><aside className="setup-panel">
      <div className="panel-title"><GitBranch size={17} />Graph agents <span>{graph.agents.length}</span></div>
      <div className="setup-section"><label htmlFor="objective">Project objective</label><textarea id="objective" value={objective} maxLength={2000} disabled={active} onChange={e => setObjective(e.target.value)} /><p className="helper">Used when resetting the graph. Drag between node handles to create a directed connection.</p></div>
      <div className="agent-list">{graph.agents.map(a => <button key={a.id} className={cn('agent-list-item', selectedId === a.id && 'active')} onClick={() => { select(a.id); void flow.setCenter(a.position.x + 150, a.position.y + 100, { zoom: .9 }); }}><Bot size={17} /><span>{a.name}</span></button>)}</div>
      {mockEnabled && <section className="budget-card"><h2>Mock limits</h2><p>Fictitious cost: ${(graph.costCents / 100).toFixed(2)} / ${(graph.budget.maxCostCents / 100).toFixed(2)}</p><Progress aria-label="Mock budget used" value={graph.costCents / graph.budget.maxCostCents * 100} />
        <label>Max depth<input type="number" min={1} max={5} value={limits.maxDepth} disabled={active} onChange={e => setLimits({ ...limits, maxDepth: Number(e.target.value) })} /></label>
        <label>Max agents<input type="number" min={1} max={50} value={limits.maxNodes} disabled={active} onChange={e => setLimits({ ...limits, maxNodes: Number(e.target.value) })} /></label>
        <label>Mock cents<input type="number" min={1} max={10000} value={limits.maxCostCents} disabled={active} onChange={e => setLimits({ ...limits, maxCostCents: Number(e.target.value) })} /></label>
        <Button disabled={active || pending} variant="outline" onClick={() => command({ action: 'budget', depth: limits.maxDepth, nodes: limits.maxNodes, cents: limits.maxCostCents })}>Apply limits</Button>
      </section>}
      <p className="helper setup-section">Local, in-memory graph. No API calls to LLMs. Server restart clears the graph.{mockEnabled && ' Run mock resets the graph to a fixed demonstration.'}</p>
    </aside><div className="center-panel"><div className="canvas-toolbar"><span>Canvas · {graph.agents.length} nodes · {graph.edges.length} connections</span><Button variant="ghost" onClick={() => flow.fitView({ padding: .2, maxZoom: 1 })}><Maximize />Fit all</Button></div>
      <div className="canvas-area"><ReactFlow<AgentNodeType> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes} onNodeClick={(_, n) => select(n.id)} onNodeDragStop={(_, n) => move(n.id, n.position)} onConnect={c => connect(c.source, c.target)} minZoom={.25} maxZoom={1.5} deleteKeyCode={null} colorMode="dark" fitView fitViewOptions={{ maxZoom: 1, padding: .25 }} aria-label="Agent graph"><Background /><Controls showInteractive={false} /><MiniMap pannable zoomable /></ReactFlow></div>
      <section className="event-panel" aria-label="Graph events"><div className="panel-title">Server events · revision {graph.revision}</div><div className="event-list">{events.length ? events.slice(-5).reverse().map(event => <p key={event.id}>{event.type} — {event.message}</p>) : <p>Ready. Add an agent to create your first connection.</p>}</div></section>
    </div><aside className="inspector"><div className="panel-title">Agent inspector</div><div className="inspector-profile"><Bot /><h2>{selected.name}</h2></div><p className="status"><Check size={15} />{statusLabels[selected.status]} · {selected.provider}</p>
      <Tabs defaultValue="context"><TabsList><TabsTrigger value="context">Context</TabsTrigger><TabsTrigger value="output">Output</TabsTrigger></TabsList><TabsContent value="context"><h3>Objective</h3><p>{selected.context.objective}</p><h3>Executive summary</h3><p>{selected.context.summary}</p><div className="context-note"><ShieldCheck /><span>Isolated context envelope. Parent transcript is not inherited.</span></div></TabsContent><TabsContent value="output"><pre>{selected.output || 'No provider output.'}</pre></TabsContent></Tabs>
    </aside></div>
    <footer className="statusbar">Local server · 127.0.0.1 <span>{mockEnabled ? `Mock: ${graph.status}` : 'Mock disabled'}</span></footer>
    {notice && <div role="alert" className="notice"><ShieldCheck /><span>{notice}</span><Button variant="ghost" size="icon" aria-label="Dismiss notice" onClick={() => useProjection.setState({ notice: '' })}><X /></Button></div>}
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent><DialogTitle>Add agent</DialogTitle><DialogDescription>Create a disconnected agent, then connect its handles on the canvas.</DialogDescription><label>Name<input value={name} maxLength={70} onChange={e => setName(e.target.value)} /></label><label>Objective<textarea value={goal} maxLength={2000} onChange={e => setGoal(e.target.value)} /></label>{notice && <p role="alert">{notice}</p>}<Button disabled={pending || !name.trim() || !goal.trim()} onClick={add}><Plus />Create agent</Button></DialogContent></Dialog>
  </main>;
}
export default function Workspace(props: Props) { return <ReactFlowProvider><CanvasWorkspace {...props} /></ReactFlowProvider>; }
