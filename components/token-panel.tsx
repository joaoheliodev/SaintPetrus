'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TokenSnapshot } from '../lib/tokens/service';
import { Button } from './ui/button';
import { PricePanel } from './price-panel';
import { Gauge } from 'lucide-react';
import { budgetMeter } from '../lib/budget-summary';
import { cn } from '../lib/utils';
// The one GET reader for accounting evidence: the token snapshot and the receipts behind it.
export function readAccounting(path: '/api/tokens', signal?: AbortSignal): Promise<TokenSnapshot>;
export function readAccounting(path: '/api/receipts', signal?: AbortSignal): Promise<unknown>;
export async function readAccounting(path: '/api/tokens' | '/api/receipts', signal?: AbortSignal) {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Accounting unavailable.');
  return response.json();
}
// The one reader of /api/tokens. The workspace holds it once; the top meter, Budgets and Prices share its snapshot.
export function useTokenSnapshot() {
  const [data, setData] = useState<TokenSnapshot>(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [priceError, setPriceError] = useState('');
  const mounted = useRef(false); const refreshSequence = useRef(0); const refreshController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    try {
      const value = await readAccounting('/api/tokens', controller.signal);
      if (mounted.current && sequence === refreshSequence.current) { setData(value); setError(''); }
    } catch {
      if (mounted.current && sequence === refreshSequence.current && !controller.signal.aborted) setError('Token controls unavailable. Check local configuration.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (mounted.current) timer = setTimeout(() => { void poll(); }, 1000); };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); refreshController.current?.abort(); };
  }, [refresh]);
  async function command(body: object, endpoint: '/api/tokens' | '/api/prices' = '/api/tokens') {
    setPending(true); setError('');
    if (endpoint === '/api/prices') setPriceError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok && endpoint === '/api/prices') {
        const body: unknown = await response.json();
        setPriceError(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Price request failed.');
        return false;
      }
      if (!response.ok) throw new Error(); await refresh();
      return true;
    }
    catch {
      if (endpoint === '/api/prices') setPriceError('Price request unavailable. Check the local server.');
      else setError('Control rejected. Check limits and unverifiable usage before resuming.');
      return false;
    }
    finally { setPending(false); }
  }
  return { data, error, pending, priceError, command };
}
export type TokenSource = ReturnType<typeof useTokenSnapshot>;
export function PauseAllButton({ tokens }: { tokens: TokenSource }) {
  const { pending, command } = tokens;
  return <Button variant="outline" disabled={pending} onClick={() => { if (window.confirm('Pause every agent? A provider call in flight is cancelled and stays unverifiable until its reservation expires.')) void command({ action: 'kill' }); }}>Pause all agents</Button>;
}
const meterStates: Record<string, string> = { available: '', warning: ' · warning', stopped: ' · stopped' };
// The top-bar meter, from the same snapshot as Budgets: the fullest of the global and session scopes.
export function BudgetMeter({ snapshot, open }: { snapshot: Pick<TokenSnapshot, 'rows' | 'stopped'> | undefined; open: () => void }) {
  const meter = snapshot ? budgetMeter(snapshot.rows) : undefined;
  const text = !snapshot ? 'Budget …' : snapshot.stopped ? 'Budget · all paused' : meter ? `Budget ${meter.percent}%${meterStates[meter.state] ?? ''}` : 'Budget —';
  return <button type="button" className={cn('budget-meter', meter && `is-${snapshot?.stopped ? 'stopped' : meter.state}`)} onClick={open} title={meter ? `Fullest budget: ${meter.scope}, in ${meter.dimension}. Open Budgets.` : 'Open Budgets.'}>
    <Gauge size={15} aria-hidden="true" /><span>{text}</span><span className="meter-track" aria-hidden="true"><span style={{ width: `${Math.min(100, meter?.percent ?? 0)}%` }} /></span>
  </button>;
}
export function BudgetsView({ tokens }: { tokens: TokenSource }) {
  const { data, error, pending, command } = tokens;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [reconciliation, setReconciliation] = useState<Record<string, { prompt: string; completion: string; costUsd: string }>>({});
  const total = data?.rows.find(row => row.scope === 'global');
  return <section className="view token-panel" aria-labelledby="budgets-title">
        <h1 id="budgets-title">Budgets</h1>
        <p className="helper">Server-enforced token and USD budgets. Preflight reserves peak, cache-miss cost; reported usage reconciles against the configured local table. Mock consumption is estimated separately.</p>
        <p role="status">{!data ? 'Loading server token state…' : data.stopped ? '■ Global pause active' : '● Global execution enabled'} {error}</p>

        <p>Actual provider tokens: {total?.actual.total ?? 0} · Mock estimated tokens: {total?.mock.total ?? 0} · Saved tokens: {total?.saved ?? 0}</p>
        <p>Accounted cost (USD): {(total?.costAccountedUsd ?? 0).toFixed(9)} · Reserved worst-case cost: {(total?.costReservedUsd ?? 0).toFixed(9)} · Local price table date: {data?.priceDate ?? 'Unavailable'}</p>
        <p>Rows overlap: global, agent, model and session describe the same calls. Do not add rows together. Either dimension warns at 80% and pauses at 100%. Increase a limit, then resume explicitly.</p>
        <div className="token-table"><table><caption>Budgets and consumption</caption><thead><tr><th>Scope / ID</th><th>Token limit</th><th>USD limit</th><th>Actual input / output / total</th><th>Mock estimated input / output / total</th><th>Reserved / unverifiable / expired estimate</th><th>USD used / reserved / expired estimate</th><th>Budget status</th></tr></thead><tbody>
          {data?.rows.map(row => { const key = `${row.scope}:${row.id}`; return <tr key={key}>
            <th>{row.scope}<small>{row.id}{'removed' in row && row.removed ? ' · removed agent' : ''}</small></th>
            <td><input aria-label={`Budget ${key}`} type="number" min={0} value={drafts[key] ?? row.limit} onChange={event => setDrafts({ ...drafts, [key]: event.target.value })} /><Button disabled={pending} variant="outline" onClick={() => command({ action: 'limit', scope: row.scope, id: row.id, limit: Number(drafts[key] ?? row.limit) })}>Apply {row.scope}</Button></td>
            <td><input aria-label={`USD budget ${key}`} type="number" min={0} step="any" value={costDrafts[key] ?? row.costLimitUsd} onChange={event => setCostDrafts({ ...costDrafts, [key]: event.target.value })} /><Button disabled={pending} variant="outline" onClick={() => command({ action: 'cost-limit', scope: row.scope, id: row.id, limit: Number(costDrafts[key] ?? row.costLimitUsd) })}>Apply USD</Button></td>
            <td>{row.actual.prompt} / {row.actual.completion} / {row.actual.total}{row.conservativeCachedInput > 0 && <small>{row.conservativeCachedInput} cached input tokens reported</small>}</td><td>{row.mock.prompt} / {row.mock.completion} / {row.mock.total}</td><td>{row.reserved} / {row.unverifiable} / {row.estimated}</td><td>{row.costAccountedUsd.toFixed(9)} / {row.costReservedUsd.toFixed(9)} / {row.costUnmeasuredUsd.toFixed(9)}</td><td>{row.state === 'warning' ? '⚠ Warning ≥80%' : row.state === 'stopped' ? '■ Hard stop' : '● Available'}</td>
          </tr>; })}
        </tbody></table></div>
        <p>Per-call accounting evidence: <a href="/api/receipts" target="_blank" rel="noreferrer">receipts (JSON)</a>, newest first, process-local and bounded.</p>
        <p>Unverifiable usage keeps both reservations for {data?.reservationTtlMs ?? 0} ms. At expiry the worst-case token and USD amounts become conservative usage. Manual reconciliation requires provider-confirmed tokens and invoice cost.</p>
        {data && data.reservations.length === 0 && <p>No held or expired reservations.</p>}
        {data?.reservations.map(item => { const values = reconciliation[item.id] ?? { prompt: '', completion: '', costUsd: '' }; return <section key={item.id} className="context-note">
          <span>{item.status === 'estimated' ? '⚠ Expired estimate' : '■ Awaiting usage'} · {item.agent} · {item.model}{item.servedModel && item.servedModel !== item.model ? ` · served by ${item.servedModel}` : ''} · {item.tokens} tokens and USD {item.costUsd.toFixed(9)} reserved · ID {item.id}</span>
          {item.status === 'estimated' && <><input aria-label={`Confirmed prompt tokens ${item.id}`} type="number" min={0} value={values.prompt} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, prompt: event.target.value } })} /><input aria-label={`Confirmed completion tokens ${item.id}`} type="number" min={0} value={values.completion} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, completion: event.target.value } })} /><input aria-label={`Confirmed cost USD ${item.id}`} type="number" min={0} step="any" value={values.costUsd} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, costUsd: event.target.value } })} /><Button disabled={pending || values.prompt === '' || values.completion === '' || values.costUsd === ''} variant="outline" onClick={() => { if (window.confirm(`Replace the expired estimate ${item.id} with this confirmed usage and cost? This cannot be undone.`)) void command({ action: 'reconcile', reservationId: item.id, prompt: Number(values.prompt), completion: Number(values.completion), costUsd: Number(values.costUsd) }); }}>Apply confirmed usage</Button></>}
        </section>; })}
        <Button disabled={pending} variant="outline" onClick={() => command({ action: 'resume' })}>Resume eligible agents</Button>
        <h3>Model allowlist</h3>
        <p>Edit config/token-policy.json and restart to change the allowlist. Manage tariffs in Prices without restarting. Cache TTL: {data?.cacheTtlMs ?? 0} ms; only temperature 0 is cached. Connection tests always bypass cache.</p>
        {Object.entries(data?.models ?? {}).map(([id, model]) => { const price = data?.prices[id]; return <p key={id}>{model.provider} / {id} · max_tokens {model.max_tokens} · temperature {model.temperature} · {price ? <>verified {price.verifiedAt} · off-peak hit/miss/output {price.offPeak.inputCacheHitPerMillion} / {price.offPeak.inputCacheMissPerMillion} / {price.offPeak.outputPerMillion} · peak {price.peak.inputCacheHitPerMillion} / {price.peak.inputCacheMissPerMillion} / {price.peak.outputPerMillion}{price.note && <small>{price.note}</small>}</> : <strong>price missing — execution refused</strong>}</p>; })}
  </section>;
}
export function PricesView({ tokens }: { tokens: TokenSource }) {
  const { data, pending, priceError, command } = tokens;
  return <section className="view" aria-labelledby="prices-title"><h1 id="prices-title">Prices</h1>
    <PricePanel catalog={data?.catalog} pending={pending} error={priceError} onAppend={body => command(body, '/api/prices')} />
  </section>;
}
