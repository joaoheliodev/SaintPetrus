'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
type Counts = { prompt: number; completion: number; total: number };
type RateBand = { inputCacheHitPerMillion: number; inputCacheMissPerMillion: number; outputPerMillion: number };
type ModelPrice = { effectiveAt: string; verifiedAt: string; peakWindowsUtc: { weekdays: number[]; startMinute: number; endMinute: number }[]; offPeak: RateBand; peak: RateBand; note?: string };
type Row = { scope: string; id: string; limit: number; used: number; reserved: number; estimated: number; conservativeCachedInput: number; actual: Counts; mock: Counts; costLimitUsd: number; costReservedUsd: number; costEstimateUsd: number; costEstimatedUsd: number; saved: number; unresolved: number; state: string };
type Reservation = { id: string; agent: string; model: string; tokens: number; costUsd: number; createdAt: number; expiresAt: number | null; status: 'unresolved' | 'estimated' };
type Snapshot = { stopped: boolean; sessionId: string; priceDate: string; cacheTtlMs: number; reservationTtlMs: number; reservations: Reservation[]; rows: Row[]; models: Record<string, { provider: string; max_tokens: number; temperature: number }>; prices: Record<string, ModelPrice> };
export function TokenPanel() {
  const [data, setData] = useState<Snapshot>(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [reconciliation, setReconciliation] = useState<Record<string, { prompt: string; completion: string; costUsd: string }>>({});
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
        <DialogDescription>Server-enforced token and USD budgets. Preflight reserves peak, cache-miss cost; reported usage reconciles against the configured local table. Mock consumption is estimated separately.</DialogDescription>
        <p role="status">{!data ? 'Loading server token state…' : data.stopped ? '■ Global pause active' : '● Global execution enabled'} {error}</p>
        <p>Actual provider tokens: {total?.actual.total ?? 0} · Mock estimated tokens: {total?.mock.total ?? 0} · Saved tokens: {total?.saved ?? 0}</p>
        <p>Accounted cost (USD): {(total?.costEstimateUsd ?? 0).toFixed(9)} · Reserved worst-case cost: {(total?.costReservedUsd ?? 0).toFixed(9)} · Local price table date: {data?.priceDate ?? 'Unavailable'}</p>
        <p>Rows overlap: global, agent, model and session describe the same calls. Do not add rows together. Either dimension warns at 80% and pauses at 100%. Increase a limit, then resume explicitly.</p>
        <div className="token-table"><table><caption>Budgets and consumption</caption><thead><tr><th>Scope / ID</th><th>Token limit</th><th>USD limit</th><th>Actual input / output / total</th><th>Mock estimated input / output / total</th><th>Reserved / unresolved / expired estimate</th><th>USD used / reserved / expired estimate</th><th>Budget status</th></tr></thead><tbody>
          {data?.rows.map(row => { const key = `${row.scope}:${row.id}`; return <tr key={key}>
            <th>{row.scope}<small>{row.id}</small></th>
            <td><input aria-label={`Budget ${key}`} type="number" min={0} value={drafts[key] ?? row.limit} onChange={event => setDrafts({ ...drafts, [key]: event.target.value })} /><Button disabled={pending} variant="outline" onClick={() => command({ action: 'limit', scope: row.scope, id: row.id, limit: Number(drafts[key] ?? row.limit) })}>Apply {row.scope}</Button></td>
            <td><input aria-label={`USD budget ${key}`} type="number" min={0} step="any" value={costDrafts[key] ?? row.costLimitUsd} onChange={event => setCostDrafts({ ...costDrafts, [key]: event.target.value })} /><Button disabled={pending} variant="outline" onClick={() => command({ action: 'cost-limit', scope: row.scope, id: row.id, limit: Number(costDrafts[key] ?? row.costLimitUsd) })}>Apply USD</Button></td>
            <td>{row.actual.prompt} / {row.actual.completion} / {row.actual.total}{row.conservativeCachedInput > 0 && <small>{row.conservativeCachedInput} cached input tokens reported</small>}</td><td>{row.mock.prompt} / {row.mock.completion} / {row.mock.total}</td><td>{row.reserved} / {row.unresolved} / {row.estimated}</td><td>{row.costEstimateUsd.toFixed(9)} / {row.costReservedUsd.toFixed(9)} / {row.costEstimatedUsd.toFixed(9)}</td><td>{row.state === 'warning' ? '⚠ Warning ≥80%' : row.state === 'stopped' ? '■ Hard stop' : '● Available'}</td>
          </tr>; })}
        </tbody></table></div>
        <p>Unresolved usage keeps both reservations for {data?.reservationTtlMs ?? 0} ms. At expiry the worst-case token and USD amounts become conservative usage. Manual reconciliation requires provider-confirmed tokens and invoice cost.</p>
        {data?.reservations.map(item => { const values = reconciliation[item.id] ?? { prompt: '', completion: '', costUsd: '' }; return <section key={item.id} className="context-note">
          <span>{item.status === 'estimated' ? '⚠ Expired estimate' : '■ Awaiting usage'} · {item.agent} · {item.model} · {item.tokens} tokens and USD {item.costUsd.toFixed(9)} reserved · ID {item.id}</span>
          {item.status === 'estimated' && <><input aria-label={`Confirmed prompt tokens ${item.id}`} type="number" min={0} value={values.prompt} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, prompt: event.target.value } })} /><input aria-label={`Confirmed completion tokens ${item.id}`} type="number" min={0} value={values.completion} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, completion: event.target.value } })} /><input aria-label={`Confirmed cost USD ${item.id}`} type="number" min={0} step="any" value={values.costUsd} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, costUsd: event.target.value } })} /><Button disabled={pending || values.prompt === '' || values.completion === '' || values.costUsd === ''} variant="outline" onClick={() => command({ action: 'reconcile', reservationId: item.id, prompt: Number(values.prompt), completion: Number(values.completion), costUsd: Number(values.costUsd) })}>Apply confirmed usage</Button></>}
        </section>; })}
        <Button disabled={pending} variant="outline" onClick={() => command({ action: 'resume' })}>Resume eligible agents</Button>
        <h3>Model allowlist</h3>
        <p>Edit config/token-policy.json and config/prices.json, then restart. Cache TTL: {data?.cacheTtlMs ?? 0} ms; only temperature 0 is cached. Connection tests always bypass cache.</p>
        {Object.entries(data?.models ?? {}).map(([id, model]) => { const price = data?.prices[id]; return <p key={id}>{model.provider} / {id} · max_tokens {model.max_tokens} · temperature {model.temperature} · {price ? <>verified {price.verifiedAt} · off-peak hit/miss/output {price.offPeak.inputCacheHitPerMillion} / {price.offPeak.inputCacheMissPerMillion} / {price.offPeak.outputPerMillion} · peak {price.peak.inputCacheHitPerMillion} / {price.peak.inputCacheMissPerMillion} / {price.peak.outputPerMillion}{price.note && <small>{price.note}</small>}</> : <strong>price missing — execution refused</strong>}</p>; })}
      </DialogContent>
    </Dialog>
    <span role="status">{error}</span>
  </div>;
}
