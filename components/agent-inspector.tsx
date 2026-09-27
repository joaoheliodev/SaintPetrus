'use client';
import { useState } from 'react';
import { Bot, Check, Pencil, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { Agent, Graph } from '../lib/orchestrator';
export const statusLabels = { paused: 'Paused', ready: 'Ready', running: 'Running', completed: 'Completed', blocked: 'Blocked' };
type Props = { agent: Agent; pending: boolean; command: (input: Record<string, unknown>) => Promise<Graph | null> };
// Mount with `key={agent.id}` so drafts never carry over from another agent.
export function AgentInspector({ agent, pending, command }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [objective, setObjective] = useState(agent.context.objective);
  function edit() { setName(agent.name); setObjective(agent.context.objective); setEditing(true); }
  async function save() { if (await command({ action: 'update', id: agent.id, name, objective })) setEditing(false); }
  return <aside className="inspector" aria-label="Agent inspector"><div className="panel-title">Agent inspector</div><div className="inspector-profile"><Bot /><h2>{agent.name}</h2></div><p className="status"><Check size={15} />{statusLabels[agent.status]} · {agent.provider}</p>
    <Tabs defaultValue="context"><TabsList><TabsTrigger value="context">Context</TabsTrigger><TabsTrigger value="output">Output</TabsTrigger></TabsList>
      <TabsContent value="context">
        {editing ? <form aria-label="Edit agent" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>Name<input value={name} maxLength={70} required onChange={event => setName(event.target.value)} /></label>
          <label>Objective<textarea value={objective} maxLength={2000} required onChange={event => setObjective(event.target.value)} /></label>
          <div className="project-actions"><Button type="submit" disabled={pending || !name.trim() || !objective.trim()}>Save</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form> : <><h3>Objective</h3><p>{agent.context.objective}</p><Button variant="outline" disabled={pending} onClick={edit}><Pencil />Edit name and objective</Button></>}
        <h3>Executive summary</h3><p>{agent.context.summary}</p><div className="context-note"><ShieldCheck /><span>Isolated context envelope. Parent transcript is not inherited.</span></div>
      </TabsContent>
      <TabsContent value="output"><pre>{agent.output || 'No provider output.'}</pre></TabsContent>
    </Tabs>
  </aside>;
}
