'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TokenSnapshot } from '../lib/tokens/service';
import { Button } from './ui/button';
import { PricePanel } from './price-panel';
import { useConfirm } from './confirm-dialog';
import { Gauge } from 'lucide-react';
import { budgetMeter, budgetStatus, callCount, idle, journalWarning, percent, periodNotice, rowUsage, scopes, usd, type BudgetRow } from '../lib/budget-summary';
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
    setPending(true); setError(''); let rejection: string | undefined;
    if (endpoint === '/api/prices') setPriceError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reply: unknown = response.ok ? undefined : await response.json();
      const message = reply && typeof reply === 'object' && 'error' in reply && typeof reply.error === 'string' ? reply.error : undefined;
      if (!response.ok && endpoint === '/api/prices') {
        setPriceError(message ?? 'Price request failed.');
        return false;
      }
      // The server's reason, when it gives one (a refused new budget period), replaces the generic sentence.
      rejection = message;
      if (!response.ok) throw new Error(); await refresh();
      return true;
    }
    catch {
      if (endpoint === '/api/prices') setPriceError('Price request unavailable. Check the local server.');
      else setError(rejection ?? 'Control rejected. Check limits and unverifiable usage before resuming.');
      return false;
    }
    finally { setPending(false); }
  }
  return { data, error, pending, priceError, command };
}
export type TokenSource = ReturnType<typeof useTokenSnapshot>;
// The kill switch, shared by the top-bar button and the command palette.
export async function askToPauseAll(command: TokenSource['command'], confirm: ReturnType<typeof useConfirm>) {
  if (await confirm({ message: 'Pause every agent? A provider call in flight is cancelled and stays unverifiable until its reservation expires.', confirmLabel: 'Pause all agents', destructive: true })) void command({ action: 'kill' });
}
export function PauseAllButton({ tokens }: { tokens: TokenSource }) {
  const { pending, command } = tokens; const confirm = useConfirm();
  return <Button variant="outline" disabled={pending} onClick={() => void askToPauseAll(command, confirm)}>Pause all agents</Button>;
}
const meterStates: Record<string, string> = { available: '', warning: ' · warning', stopped: ' · stopped' };
// The top-bar meter, from the same snapshot as Budgets: the fullest of the global and session scopes.
export function BudgetMeter({ snapshot, open }: { snapshot: Pick<TokenSnapshot, 'rows' | 'stopped'> | undefined; open: () => void }) {
  const meter = snapshot ? budgetMeter(snapshot.rows) : undefined;
  const text = !snapshot ? 'Budget …' : snapshot.stopped ? 'Budget · all paused' : meter ? `Budget ${meter.percent}% used${meterStates[meter.state] ?? ''}` : 'Budget —';
  return <button type="button" className={cn('budget-meter', meter && `is-${snapshot?.stopped ? 'stopped' : meter.state}`)} onClick={open} title={meter ? `Fullest budget: ${meter.scope}, in ${meter.dimension}. Open Budgets.` : 'Open Budgets.'}>
    <Gauge size={15} aria-hidden="true" /><span>{text}</span><span className="meter-track" aria-hidden="true"><span style={{ width: `${Math.min(100, meter?.percent ?? 0)}%` }} /></span>
  </button>;
}
function UsageBar({ label, value, limit, share, unit }: { label: string; value: string; limit: string; share: number; unit: string }) {
  return <div className="usage-bar"><span>{label}</span><span className="mono">{value} of {limit} {unit}</span>
    <span className="meter-track" aria-hidden="true"><span style={{ width: `${Math.min(100, percent(share))}%` }} /></span><span className="mono">{percent(share)}%</span></div>;
}
function ScopeRow({ row, name }: { row: BudgetRow; name: string }) {
  const usage = rowUsage(row);
  return <div className={cn('scope-row', `is-${row.state}`)}>
    <p className="scope-row-name">{name}{'removed' in row && row.removed ? ' · removed agent' : ''}<span>{row.state === 'stopped' ? '■ Stopped' : row.state === 'warning' ? '▲ Warning' : '● Available'}</span></p>
    <UsageBar label="Tokens" value={(row.used + row.reserved).toLocaleString('en-US')} limit={row.limit.toLocaleString('en-US')} share={usage.tokens} unit="" />
    <UsageBar label="Dollars" value={usd(row.costAccountedUsd + row.costReservedUsd)} limit={usd(row.costLimitUsd)} share={usage.dollars} unit="" />
  </div>;
}
// Resolves true only when the server started the period.
export async function askToStartBudgetPeriod(command: TokenSource['command'], confirm: ReturnType<typeof useConfirm>) {
  if (!await confirm({ message: 'Start a new budget period? Consumption in the global, agent and model budgets starts again from zero. The journal keeps everything recorded before, and limits and pauses stay as they are. Do this only after checking the provider invoice.', confirmLabel: 'Start a new budget period', destructive: true })) return false;
  return command({ action: 'new-period' });
}
export function BudgetsView({ tokens, agents = [] }: { tokens: TokenSource; agents?: readonly { id: string; name: string }[] }) {
  const { data, error, pending, command } = tokens;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [reconciliation, setReconciliation] = useState<Record<string, { prompt: string; completion: string; costUsd: string }>>({});
  const confirm = useConfirm(); const [allScopes, setAllScopes] = useState(false); const [periodStarted, setPeriodStarted] = useState(false);
  const startPeriod = () => { void askToStartBudgetPeriod(command, confirm).then(started => { if (started) setPeriodStarted(true); }); }; const [calls, setCalls] = useState<ReturnType<typeof callCount>>();
  const total = data?.rows.find(row => row.scope === 'global');
  const name = (row: BudgetRow) => row.scope === 'agent' ? agents.find(agent => agent.id === row.id)?.name ?? row.id : row.scope === 'global' ? 'All calls' : row.scope === 'session' ? 'This server run' : row.id;
  // Receipts are read again only when the global counters move, i.e. after a call settles.
  const moved = total ? `${total.used}:${total.reserved}:${total.estimated}:${total.saved}` : '';
  useEffect(() => { let live = true; readAccounting('/api/receipts').then(value => { if (live) setCalls(callCount(value)); }).catch(() => {}); return () => { live = false; }; }, [moved]);
  const status = data ? budgetStatus(data, name) : undefined;
  const journal = data ? journalWarning(data.accounting) : undefined;
  const resumable = !!data && (data.stopped || data.paused.length > 0);
  return <section className="view token-panel" aria-labelledby="budgets-title">
        <h1 id="budgets-title">Budgets</h1>
        <p className="helper">Every call reserves its worst case before it leaves: peak price, no cache hits, full output. The mock&apos;s estimated tokens count against the token limits too, so the mock can reach a limit; its dollars are $0.</p>
        {!data ? <p role="status">Loading server token state… {error}</p> : <>
          <section className="budget-summary" aria-label="Budget summary">
            {journal && <div role="alert" className="journal-warning"><p>{journal.text}</p>{journal.canStartPeriod && <Button disabled={pending} variant="outline" onClick={startPeriod}>Start a new budget period</Button>}</div>}
            {!!data.accounting.recoveredReservations && data.reservations.some(item => item.status === 'unverifiable') && <p className="helper tone-red">{data.accounting.recoveredReservations} provider {data.accounting.recoveredReservations === 1 ? 'call was' : 'calls were'} in flight when the server stopped. {data.accounting.recoveredReservations === 1 ? 'It came' : 'They came'} back unverifiable and {data.accounting.recoveredReservations === 1 ? 'its agent is' : 'their agents are'} paused.</p>}
            {periodStarted && <p role="status" className="helper">{periodNotice(data)}</p>}
            <p role="status" className={`budget-status tone-${status?.tone}`}>{status?.text} {error}</p>
            {total && <><UsageBar label="Tokens" value={(total.used + total.reserved).toLocaleString('en-US')} limit={total.limit.toLocaleString('en-US')} share={rowUsage(total).tokens} unit="tokens" />
              <UsageBar label="Dollars" value={usd(total.costAccountedUsd + total.costReservedUsd)} limit={usd(total.costLimitUsd)} share={rowUsage(total).dollars} unit="" /></>}
            <p className="helper">{calls ? `${calls.truncated ? 'At least ' : ''}${calls.calls} ${calls.calls === 1 ? 'call' : 'calls'}` : 'Counting calls…'} · {data.reservations.length} held or expired {data.reservations.length === 1 ? 'reservation' : 'reservations'}{total && total.reserved > 0 ? ' · a call in flight' : ''}</p>
            <p className="helper">Limits are changed under Details, below.</p>
            {/* Resume only has something to do after a pause or the kill switch. */}
            <div className="project-actions"><Button disabled={pending || !resumable} variant="outline" onClick={() => command({ action: 'resume' })}>Resume eligible agents</Button>{!resumable && <span className="helper">Nothing is paused.</span>}</div>
          </section>
          {scopes.map(({ scope, title, meaning }) => { const rows = data.rows.filter(row => row.scope === scope && (allScopes || !idle(row) || scope === 'global')); return rows.length ? <section key={scope} className="scope-block" aria-label={`${title} budgets`}>
            <h2>{title}</h2><p className="helper">{meaning}</p>{rows.map(row => <ScopeRow key={`${row.scope}:${row.id}`} row={row} name={name(row)} />)}
          </section> : null; })}
          <Button variant="ghost" aria-pressed={allScopes} onClick={() => setAllScopes(!allScopes)}>{allScopes ? 'Hide unused scopes' : 'Show all scopes'}</Button>
        </>}
        <details className="budget-details"><summary>Details</summary>

        <p>Actual provider tokens: {total?.actual.total ?? 0} · Mock estimated tokens: {total?.mock.total ?? 0} · Saved tokens: {total?.saved ?? 0}</p>
        <p>Accounted cost (USD): {(total?.costAccountedUsd ?? 0).toFixed(9)} · Reserved worst-case cost: {(total?.costReservedUsd ?? 0).toFixed(9)} · Local price table date: {data?.priceDate ?? 'Unavailable'}</p>
        <p>Global, agent and model consumption, limits changed here, pauses and held reservations are journaled in the user data directory and survive a restart. The session budget and the mock&apos;s usage start empty with each server run. A call in flight when the server stops comes back unverifiable, with its agent paused.</p>
        {data?.accounting.journal === 'recorded' && <p><Button disabled={pending} variant="outline" onClick={startPeriod}>Start a new budget period</Button> <span className="helper">Consumption starts again from zero; the journal keeps the history. Refused while a reservation is open.</span></p>}
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
          {item.status === 'estimated' && <><input aria-label={`Confirmed prompt tokens ${item.id}`} type="number" min={0} value={values.prompt} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, prompt: event.target.value } })} /><input aria-label={`Confirmed completion tokens ${item.id}`} type="number" min={0} value={values.completion} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, completion: event.target.value } })} /><input aria-label={`Confirmed cost USD ${item.id}`} type="number" min={0} step="any" value={values.costUsd} onChange={event => setReconciliation({ ...reconciliation, [item.id]: { ...values, costUsd: event.target.value } })} /><Button disabled={pending || values.prompt === '' || values.completion === '' || values.costUsd === ''} variant="outline" onClick={async () => { if (await confirm({ message: `Replace the expired estimate ${item.id} with this confirmed usage and cost? This cannot be undone.`, confirmLabel: 'Apply confirmed usage', destructive: true })) void command({ action: 'reconcile', reservationId: item.id, prompt: Number(values.prompt), completion: Number(values.completion), costUsd: Number(values.costUsd) }); }}>Apply confirmed usage</Button></>}
        </section>; })}
        <p>Resume eligible agents is in the summary above.</p>
        <h3>Model allowlist</h3>
        <p>Edit config/token-policy.json and restart to change the allowlist. Manage tariffs in Prices without restarting. Cache TTL: {data?.cacheTtlMs ?? 0} ms; only temperature 0 is cached. Connection tests always bypass cache.</p>
        {Object.entries(data?.models ?? {}).map(([id, model]) => { const price = data?.prices[id]; return <p key={id}>{model.provider} / {id} · max_tokens {model.max_tokens} · temperature {model.temperature} · {price ? <>verified {price.verifiedAt} · off-peak hit/miss/output {price.offPeak.inputCacheHitPerMillion} / {price.offPeak.inputCacheMissPerMillion} / {price.offPeak.outputPerMillion} · peak {price.peak.inputCacheHitPerMillion} / {price.peak.inputCacheMissPerMillion} / {price.peak.outputPerMillion}{price.note && <small>{price.note}</small>}</> : <strong>price missing — execution refused</strong>}</p>; })}
        </details>
  </section>;
}
export function PricesView({ tokens }: { tokens: TokenSource }) {
  const { data, pending, priceError, command } = tokens;
  return <section className="view" aria-labelledby="prices-title"><h1 id="prices-title">Prices</h1>
    <PricePanel catalog={data?.catalog} allowlisted={data ? Object.keys(data.models) : undefined} pending={pending} error={priceError} onAppend={body => command(body, '/api/prices')} />
  </section>;
}
