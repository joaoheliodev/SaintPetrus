'use client';
import { useState } from 'react';
import { Bot, GitBranch, Pencil, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { Agent, Graph } from '../lib/orchestrator';
import { postProviderAction, verificationMessage } from './provider-status';
import { AgentStatusBadge } from './agent-status-badge';
import { agentPlacement } from '../lib/agent-status';
// The confirmation names the maximum the server will hold before sending; the call itself is checked again.
export function runQuestion(quote: unknown): string {
  const field = (name: string) => quote !== null && typeof quote === 'object' ? Reflect.get(quote, name) : undefined;
  const provider = field('provider'), model = field('model'), tokens = field('reservedTokens'), cost = field('reservedCostUsd');
  if (typeof model !== 'string' || typeof tokens !== 'number' || typeof cost !== 'number') return 'Send one call? The server did not say how much it reserves.';
  if (field('cached') === true) return `Send one call to ${model}? A saved answer will be reused: nothing is reserved and no provider is called.`;
  const price = provider === 'mock' ? 'the mock is free' : `at most $${cost.toFixed(6)} before sending`;
  return `Send one call to ${model}? It reserves ${tokens} tokens, ${price}. What the provider does not use is released when its usage is confirmed.`;
}
type Props = { agent: Agent; agents: readonly Pick<Agent, 'id' | 'name'>[]; pending: boolean; command: (input: Record<string, unknown>) => Promise<Graph | null>; connect: (source: string, target: string) => Promise<void> };
// Mount with `key={agent.id}` so drafts never carry over from another agent.
export function AgentInspector({ agent, agents, pending, command, connect }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [objective, setObjective] = useState(agent.context.objective);
  function edit() { setName(agent.name); setObjective(agent.context.objective); setEditing(true); }
  async function save() { if (await command({ action: 'update', id: agent.id, name, objective })) setEditing(false); }
  // The server refuses a removal while the agent's accounting is unsettled, and the coordinator is never removable.
  const removable = agents[0]?.id !== agent.id;
  function remove() {
    if (window.confirm(`Remove ${agent.name}? Its connections are deleted and it leaves the canvas; its accounting stays in Tokens, marked as a removed agent. This cannot be undone.`)) void command({ action: 'remove-agent', id: agent.id });
  }
  // The keyboard path to what a drag between two cards does; the canvas validates and the server decides.
  const [target, setTarget] = useState(''); const others = agents.filter(other => other.id !== agent.id);
  const [message, setMessage] = useState(''); const [running, setRunning] = useState(false); const [result, setResult] = useState('');
  // A 409 carries either a known code or the server's own fixed refusal sentence; both are safe to show.
  const refusal = (status: number, error: unknown) => status === 409 && typeof error === 'string' && !/^[a-z_]+$/.test(error) ? `Stopped by the server: ${error}` : verificationMessage(status, typeof error === 'string' ? error : undefined);
  // One budgeted call through the connected provider; the server records the answer as this agent's output.
  // It asks first with the server's own quote of the most the call can reserve (operator decision Q-09).
  async function run() {
    setRunning(true); setResult('');
    try {
      const quoted = await postProviderAction(JSON.stringify({ action: 'quote', input: message, agentId: agent.id }));
      if (!quoted.ok) { setResult(refusal(quoted.status, quoted.data?.error)); return; }
      if (!window.confirm(runQuestion(quoted.data?.quote))) { setResult('Not sent.'); return; }
      const { ok, status, data } = await postProviderAction(JSON.stringify({ action: 'complete', input: message, agentId: agent.id }));
      if (ok) setResult(`${data.mocked ? 'Mock answer' : `Answer from ${data.billingModel}`} · ${data.usage?.total ?? 0} tokens · ${data.latencyMs} ms`);
      else setResult(refusal(status, data?.error));
    } catch { setResult('Local server unavailable. The call was not confirmed.'); }
    finally { setRunning(false); }
  }
  return <aside className="inspector" aria-label="Agent inspector"><div className="panel-title">Agent inspector</div><div className="inspector-profile"><Bot /><h2>{agent.name}</h2></div><p className="inspector-meta"><AgentStatusBadge status={agent.status} /><span>{agentPlacement(agent)}</span></p>
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
    <section className="inspector-connect" aria-label="Connect this agent"><h3>Connect</h3>
      <p className="helper">Same as dragging from this card&apos;s right dot to another card&apos;s left dot.</p>
      <label>Connect to<select value={target} disabled={pending || !others.length} onChange={event => setTarget(event.target.value)}><option value="">Choose an agent</option>{others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label>
      <Button variant="outline" disabled={pending || !target} onClick={async () => { await connect(agent.id, target); setTarget(''); }}><GitBranch />Connect</Button>
    </section>
    {removable && <section aria-label="Remove this agent"><h3>Remove</h3><Button variant="destructive" disabled={pending} onClick={remove}><Trash2 />Remove agent</Button></section>}
    <section className="inspector-run" aria-label="Run this agent"><h3>Run once</h3>
      <p className="helper">Sends one budgeted call through the connected provider and shows the answer under Output. It asks first, showing the most the call can reserve. The mock is free; a real provider can charge for it.</p>
      <label>Message<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
      <Button disabled={running || !message.trim()} onClick={run}><Send />{running ? 'Running…' : 'Send (1 call)'}</Button>
      <p role="status">{result}</p>
    </section>
  </aside>;
}
