'use client';
import { useState } from 'react';
import { Bot, GitBranch, Pencil, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';
import { accountedCost, exchangeFacts, exchangeFromResponse, type RunExchange } from '../lib/run-exchange';
import { readAccounting } from './token-panel';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type { Agent, Graph } from '../lib/orchestrator';
import { connectionTarget, postProviderAction, verificationMessage } from './provider-status';
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
type Props = { agent: Agent; agents: readonly Pick<Agent, 'id' | 'name'>[]; pending: boolean; command: (input: Record<string, unknown>) => Promise<Graph | null>; connect: (source: string, target: string) => Promise<void>;
  // The global connection Run once uses, and this agent's last exchange, kept in the workspace's memory only.
  connection?: ProviderStatusSnapshot; exchange?: RunExchange; onExchange?: (exchange: RunExchange) => void };
// What Run once will use, in the words of the connection chip and the mode badge.
export const runsWith = (connection: ProviderStatusSnapshot | undefined) => !connection ? 'Connection loading' : `${connection.state === 'disconnected' ? 'No connection' : connectionTarget(connection)} · ${connection.mode === 'real' ? 'REAL' : 'MOCK'}`;
// Mount with `key={agent.id}` so drafts never carry over from another agent.
export function AgentInspector({ agent, agents, pending, command, connect, connection, exchange, onExchange }: Props) {
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
      const sent = message;
      const { ok, status, data } = await postProviderAction(JSON.stringify({ action: 'complete', input: sent, agentId: agent.id }));
      if (!ok) { setResult(refusal(status, data?.error)); return; }
      const answered = exchangeFromResponse(sent, data);
      setResult(`${answered.mocked ? 'Mock answer' : `Answer from ${answered.model}`} · ${answered.tokens} tokens · ${answered.latencyMs} ms`);
      onExchange?.({ ...answered, costPending: true }); setMessage('');
      // The cost is the server's own accounting for this call, read from its receipt; never computed here.
      let costUsd: number | null | undefined;
      try { costUsd = accountedCost(await readAccounting('/api/receipts'), agent.id); } catch { /* The answer stands without its cost line. */ }
      onExchange?.({ ...answered, costUsd });
    } catch { setResult('Local server unavailable. The call was not confirmed.'); }
    finally { setRunning(false); }
  }
  const facts = exchange ? exchangeFacts(exchange) : [];
  return <aside className="inspector" aria-label="Agent inspector">
    <header className="inspector-head">
      <div className="inspector-profile"><Bot aria-hidden="true" /><h2>{agent.name}</h2><AgentStatusBadge status={agent.status} /></div>
      <p className="inspector-meta"><span title="The connection Run once uses; change it in Connection">{runsWith(connection)}</span><span>{agentPlacement(agent)}</span></p>
    </header>
    {/* Both panels stay mounted, so an unsaved edit or message survives a tab switch. */}
    <Tabs defaultValue="run"><TabsList aria-label="Agent panel"><TabsTrigger value="run">Run</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList>
      <TabsContent value="run" keepMounted>
        <section className="inspector-run" aria-label="Run this agent">
          <label>Message<textarea value={message} maxLength={2000} placeholder="What should this agent answer?" onChange={event => setMessage(event.target.value)} /></label>
          <Button disabled={running || !message.trim()} onClick={run}><Send />{running ? 'Running…' : 'Send (1 call)'}</Button>
          <p role="status">{result}</p>
          {exchange ? <section className="exchange" aria-label="Last exchange">
            <p className="exchange-label">You</p><pre className="exchange-message">{exchange.message}</pre>
            <p className="exchange-label">{exchange.mocked ? `Mock · ${exchange.model}` : exchange.model}</p><pre className="exchange-answer">{exchange.text || 'No visible text.'}</pre>
            <p className="exchange-facts">{facts.join(' · ')}</p>
          </section> : agent.output ? <section className="exchange" aria-label="Recorded output"><p className="exchange-label">Last recorded output</p><pre className="exchange-answer">{agent.output}</pre></section>
            : <p className="helper">No message sent from this panel yet. The answer, its tokens, latency and cost appear here.</p>}
          <p className="helper">Sends your message with this agent&apos;s instruction (see Details). It asks first, showing the most the call can reserve. The mock is free; a real provider can charge for it.</p>
        </section>
      </TabsContent>
      <TabsContent value="details" keepMounted>
        {editing ? <form aria-label="Edit agent" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>Name<input value={name} maxLength={70} required onChange={event => setName(event.target.value)} /></label>
          <label>Objective<textarea value={objective} maxLength={2000} required onChange={event => setObjective(event.target.value)} /></label>
          <div className="project-actions"><Button type="submit" disabled={pending || !name.trim() || !objective.trim()}>Save</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form> : <><h3>Objective</h3><p>{agent.context.objective}</p><p className="helper">Shown on the card, not sent to the model.</p><Button variant="outline" disabled={pending} onClick={edit}><Pencil />Edit name and objective</Button></>}
        <h3>Instruction sent with Run once</h3><pre className="instruction">{agent.context.summary}</pre>
        <div className="context-note"><ShieldCheck aria-hidden="true" /><span>Run once sends this instruction and your message, nothing else. Parent transcripts are not inherited.</span></div>
        <section className="inspector-connect" aria-label="Connect this agent"><h3>Connect</h3>
          <p className="helper">Same as dragging from this card&apos;s right dot to another card&apos;s left dot.</p>
          <label>Connect to<select value={target} disabled={pending || !others.length} onChange={event => setTarget(event.target.value)}><option value="">Choose an agent</option>{others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label>
          <Button variant="outline" disabled={pending || !target} onClick={async () => { await connect(agent.id, target); setTarget(''); }}><GitBranch />Connect</Button>
        </section>
        {removable && <section className="danger-zone" aria-label="Remove this agent"><h3>Danger zone</h3><p className="helper">Removing deletes the agent and its connections. Its accounting stays in Budgets.</p><Button variant="destructive" disabled={pending} onClick={remove}><Trash2 />Remove agent</Button></section>}
      </TabsContent>
    </Tabs>
  </aside>;
}
