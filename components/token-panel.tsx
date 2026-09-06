'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
type Counts = { prompt: number; completion: number; total: number };
type Row = { scope: string; id: string; limit: number; reserved: number; actual: Counts; mock: Counts; costEstimateUsd: number; saved: number; unresolved: number; state: string };
type Snapshot = { stopped: boolean; sessionId: string; priceDate: string; cacheTtlMs: number; rows: Row[]; models: Record<string, { provider: string; max_tokens: number; temperature: number }>; prices: Record<string, {inputPerMillion: number; outputPerMillion: number}> };
export function TokenPanel() {
  const [data, setData] = useState<Snapshot>(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    let closed = false; let timer: ReturnType<typeof setTimeout>; let abort: AbortController;
    async function poll() {
      abort = new AbortController();
      try { const response = await fetch('/api/tokens', { cache: 'no-store', signal: abort.signal }); if (!response.ok) throw new Error(); const value = await response.json(); if (!closed) setData(value); }
      catch { if (!closed) setError('Token controls unavailable. Check local configuration.'); }
      if (!closed) timer = setTimeout(poll, 1000);
    }
    void poll(); return () => { closed = true; clearTimeout(timer); abort?.abort(); };
  }, []);
  async function command(body: object) {
    setPending(true); setError('');
    try { const response = await fetch('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(); setData(await response.json()); }
    catch { setError('Control rejected. Check limits and unresolved usage before resuming.'); }
    finally { setPending(false); }
  }
  const total = data?.rows.find(row => row.scope === 'global');
  return <div className="project-actions">
    <Button variant="outline" disabled={pending} onClick={() => command({ action: 'kill' })}>Pause all agents</Button>
    <Dialog><DialogTrigger render={<Button variant="outline" />}>Tokens</DialogTrigger>
      <DialogContent className="token-panel">
        <DialogTitle>Token controls</DialogTitle>
        <DialogDescription>Server-enforced budgets. Reservations are approximate; reported consumption uses provider usage. Mock consumption is estimated separately.</DialogDescription>
        <p role="status">{!data ? 'Loading server token state…' : data.stopped ? '■ Global pause active' : '● Global execution enabled'} {error}</p>
        <p>Actual provider tokens: {total?.actual.total ?? 0} · Mock estimated tokens: {total?.mock.total ?? 0} · Saved tokens: {total?.saved ?? 0}</p>
        <p>Cost estimate (USD): {(total?.costEstimateUsd ?? 0).toFixed(6)} · Local price table date: {data?.priceDate ?? 'Unavailable'}</p>
        <p>Rows overlap: global, agent, model and session describe the same calls. Do not add rows together. 80% warns; 100% pauses. Increase a limit, then resume explicitly.</p>
        <div className="token-table"><table><caption>Budgets and consumption</caption><thead><tr><th>Scope / ID</th><th>Limit</th><th>Actual input / output / total</th><th>Mock estimated input / output / total</th><th>Reserved / unresolved</th><th>Budget status</th></tr></thead><tbody>
          {data?.rows.map(row => { const key = `${row.scope}:${row.id}`; return <tr key={key}>
            <th>{row.scope}<small>{row.id}</small></th>
            <td><input aria-label={`Budget ${key}`} type="number" min={0} value={drafts[key] ?? row.limit} onChange={event => setDrafts({ ...drafts, [key]: event.target.value })} /><Button disabled={pending} variant="outline" onClick={() => command({ action: 'limit', scope: row.scope, id: row.id, limit: Number(drafts[key] ?? row.limit) })}>Apply {row.scope}</Button></td>
            <td>{row.actual.prompt} / {row.actual.completion} / {row.actual.total}</td><td>{row.mock.prompt} / {row.mock.completion} / {row.mock.total}</td><td>{row.reserved} / {row.unresolved}</td><td>{row.state === 'warning' ? '⚠ Warning ≥80%' : row.state === 'stopped' ? '■ Hard stop' : '● Available'}</td>
          </tr>; })}
        </tbody></table></div>
        <p>Unresolved usage keeps its reservation after a real request fails; it is not shown as billed usage. Check provider billing before restarting the process.</p>
        <Button disabled={pending} variant="outline" onClick={() => command({ action: 'resume' })}>Resume eligible agents</Button>
        <h3>Model allowlist</h3>
        <p>Edit config/token-policy.json and config/prices.json, then restart. Cache TTL: {data?.cacheTtlMs ?? 0} ms; only temperature 0 is cached. Connection tests always bypass cache.</p>
        {Object.entries(data?.models ?? {}).map(([id, model]) => <p key={id}>{model.provider} / {id} · max_tokens {model.max_tokens} · temperature {model.temperature} · estimated USD per million input/output: {data?.prices[id]?.inputPerMillion} / {data?.prices[id]?.outputPerMillion}</p>)}
      </DialogContent>
    </Dialog>
    <span role="status">{error}</span>
  </div>;
}
