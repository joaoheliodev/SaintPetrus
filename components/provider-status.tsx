'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { useConfirm } from './confirm-dialog';
import type { ConnectionState, ProviderStatusSnapshot } from '../lib/providers/runtime';
const keyedProviders = ['openai', 'gemini', 'deepseek'];
type RefreshPriority = 'poll' | 'explicit';
type ActiveRefresh = { priority: RefreshPriority; controller: AbortController; promise: Promise<void> };
export function createProviderStatusRefresher(
  load: (signal: AbortSignal) => Promise<ProviderStatusSnapshot>,
  project: (status: ProviderStatusSnapshot) => void,
) {
  let active: ActiveRefresh | undefined;
  return {
    refresh(priority: RefreshPriority) {
      if (active) {
        if (priority === 'poll' || active.priority === 'explicit') return active.promise;
        active.controller.abort();
      }
      const controller = new AbortController();
      const request: ActiveRefresh = { priority, controller, promise: Promise.resolve() };
      request.promise = load(controller.signal)
        .then(next => { if (active === request && !controller.signal.aborted) project(next); })
        .finally(() => { if (active === request) active = undefined; });
      active = request;
      return request.promise;
    },
    abort() { active?.controller.abort(); },
  };
}
// "Connected" must mean a real call succeeded. A stored credential alone only earns "configured".
// The mode badge already says MOCK or REAL, so the chip names only what Run once uses: the mock by its model alone.
export const connectionTarget = (s: Pick<ProviderStatusSnapshot, 'mocked' | 'provider' | 'model'>) => s.mocked ? s.model : `${s.provider} · ${s.model}`;
const badges: Record<ConnectionState, (status: ProviderStatusSnapshot) => string> = {
  verified: s => `● Connected · ${connectionTarget(s)}`,
  rejected: s => `▲ Connection rejected · ${s.provider}`,
  configured: s => `◐ Configured, not verified · ${connectionTarget(s)}`,
  incomplete: s => `△ ${s.failureCode === 'empty_output' ? 'No visible output' : 'Output budget exhausted'} · ${connectionTarget(s)}`,
  disconnected: () => '○ Disconnected',
};
export const connectionLabel = (status: ProviderStatusSnapshot) => badges[status.state](status);
// Exported so the distinct meaning of each failure is pinned by a test, not only by the panel.
export const verificationMessage = (status: number, code?: unknown) => (typeof code === 'string' ? codeFailures[code] : undefined) ?? failures[status] ?? 'Connection verification failed.';
// A 409 carries either a known code or the server's own fixed refusal sentence, never input; both are safe to show.
// Run once and the connection test word a refusal alike, so a budget that pauses an agent names itself (Round 5, R5-8).
export const refusalMessage = (status: number, error: unknown) => status === 409 && typeof error === 'string' && !/^[a-z_]+$/.test(error) ? `Stopped by the server: ${error}` : verificationMessage(status, typeof error === 'string' ? error : undefined);
const failures: Record<number, string> = {
  401: 'The provider rejected the credential or model. Check the API key and model ID.',
  402: 'The provider account has no balance left. The key is valid and the service is up, so the connection is not rejected: top up the account and test again.',
  404: 'The provider did not find this model. Check the model ID.',
  409: 'Execution was paused or refused by the budget/model policy. Open Budgets.',
  422: 'The provider spent the output budget without returning visible text. Usage was charged; increase the allowed output only after reviewing the model policy.',
  429: 'The provider rate limited the request. Try again shortly.',
  502: 'Provider communication failed. The credential was neither verified nor rejected.',
  504: 'The provider request timed out. The credential was neither verified nor rejected.',
};
const codeFailures: Record<string, string> = {
  unconfigured: 'No provider is connected. Open Connection and connect one first.',
  disabled: 'Real providers are off in MOCK mode. Restart the server with SAINTPETRUS_MODE=real to use one.',
  // The proxy runs one call at a time; a second one is refused before it leaves and holds nothing.
  busy: 'Another provider call is still running. Nothing was sent or charged; try again when it finishes.',
  empty_output: 'The provider answered without visible text, so the connection is not verified. Usage was charged; check the model and prompt before testing again.',
  served_model_unpriced: 'The provider answered with a model that has no verified price. The call may have been billed, so its reservation stays held and the agent is paused. Add that model in Prices, then reconcile the expired estimate with provider-confirmed usage.',
};
const configurationFailures: Record<string, string> = {
  invalid_model_format: 'Invalid model ID format. Use the provider model ID; Gemini also accepts the models/… prefix.',
  model_not_allowlisted: 'This model is not in the server token-policy allowlist.',
};
class ConfigurationFailure extends Error {}
// The one client of /api/provider actions: a body carries the action and, to execute, only the input and agent.
export async function postProviderAction(body: string) {
  const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { ok: response.ok, status: response.status, data: await response.json() };
}
// The one reader of /api/provider status. The workspace holds it once and hands it to every view that shows the connection.
export function useProviderStatus() {
  const [status, setStatus] = useState<ProviderStatusSnapshot>();
  const [unavailable, setUnavailable] = useState(false);
  const mounted = useRef(false); const refresher = useRef<ReturnType<typeof createProviderStatusRefresher> | null>(null);
  const refresh = useCallback((priority: RefreshPriority) => {
    if (!refresher.current) refresher.current = createProviderStatusRefresher(async signal => {
      const response = await fetch('/api/provider', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Provider status unavailable.');
      return response.json();
    }, next => { if (mounted.current) setStatus(next); });
    return refresher.current.refresh(priority);
  }, []);
  useEffect(() => {
    mounted.current = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh('poll'); if (mounted.current) setUnavailable(false); }
      // Raw network errors are never shown; an explicit refresh that retires this poll is not an outage.
      catch (error) { if (mounted.current && !(error instanceof DOMException && error.name === 'AbortError')) setUnavailable(true); }
      if (mounted.current) timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { mounted.current = false; clearTimeout(timer); refresher.current?.abort(); };
  }, [refresh]);
  return { status, unavailable, refresh };
}
export type ProviderStatusSource = ReturnType<typeof useProviderStatus>;
// What each state means, for the chip's tooltip: configured is not verified (docs/reference/connection-state.md).
export const connectionHints: Record<ConnectionState, string> = {
  verified: 'Verified: a connection test with this provider and model succeeded.',
  configured: 'Configured: Run once can use this provider and model, but no connection test has succeeded yet. Connect and verify in Connection proves it.',
  incomplete: 'The last connection test came back without visible text, so the connection is not verified.',
  rejected: 'The provider rejected the key or the model in the last connection test.',
  disconnected: 'No provider is connected, so Run once cannot run.',
};
export const statusText = (source: ProviderStatusSource) => source.status ? `${connectionLabel(source.status)}${source.unavailable ? ' · server unreachable' : ''}` : source.unavailable ? '○ Local server unavailable' : '◌ Loading connection state';
// The top-bar chip: the connection in one line, and the way to the Connection view.
export function ConnectionChip({ source, open }: { source: ProviderStatusSource; open: () => void }) {
  const { status } = source;
  return <>
    <button type="button" className={`provider-badge ${status ? `is-${status.state}` : 'is-loading'}`} title={`${status ? `${connectionHints[status.state]} ` : ''}Click to open Connection.`} onClick={open}><span role="status">{statusText(source)}</span></button>
    {status?.validationTimeoutMs !== undefined && <span className="provider-badge is-incomplete" title="Set at server startup with SAINTPETRUS_VALIDATION_TIMEOUT_MS">⏱ Validation timeout · {status.validationTimeoutMs} ms</span>}
  </>;
}
// Where the form starts: the current keyed pair, or the mock while it is on offer.
const initialProvider = (status: ProviderStatusSnapshot | undefined) => status && keyedProviders.includes(status.provider) ? status.provider : status?.mockAvailable === false ? 'gemini' : 'mock';
export function ConnectionView({ source, children }: { source: ProviderStatusSource; children?: React.ReactNode }) {
  const { status, refresh } = source;
  const [result, setResult] = useState(''); const [pending, setPending] = useState(false);
  const [provider, setProvider] = useState(() => initialProvider(status));
  const [model, setModel] = useState(() => status && keyedProviders.includes(status.provider) ? status.model : ''); const [custom, setCustom] = useState('');
  const [show, setShow] = useState(false); const [remember, setRemember] = useState(false);
  const realMode = status?.mode === 'real'; const confirm = useConfirm();
  // Uncontrolled, transient field: no credential in React state or browser storage. Leaving the view removes it with its value.
  const keyField = useRef<HTMLInputElement>(null);
  async function configure(action: 'set' | 'disconnect' | 'forget') {
    const selected = action === 'set' ? provider : status?.provider ?? 'none';
    const body: Record<string, unknown> = { action, provider: selected };
    if (action === 'set') {
      body.model = selected === 'mock' ? 'mock-v1' : model || custom.trim();
      if (selected !== 'mock') { body.key = keyField.current?.value ?? ''; body.remember = remember; }
    }
    const payload = JSON.stringify(body); delete body.key;
    if (keyField.current) keyField.current.value = ''; setShow(false);
    // Only this local configuration request may carry a key; never provider execution.
    const response = await fetch('/api/credentials', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'browser' }, body: payload });
    if (!response.ok) {
      const data = await response.json();
      throw new ConfigurationFailure(configurationFailures[data?.error] ?? 'Configuration failed. Check model/key; remembering requires an unlocked OS keyring.');
    }
    await refresh('explicit');
  }
  // One minimal live call. Its outcome, not the presence of a key, is what the badge reports.
  async function verify(mocked: boolean) {
    const { ok, status, data } = await postProviderAction(JSON.stringify({ action: 'test' }));
    await refresh('explicit');
    setResult(ok
      ? `${mocked ? 'Mock verified' : 'Connection verified'} · ${data.latencyMs} ms`
      : refusalMessage(status, data?.error));
  }
  async function run(action: 'connect' | 'test' | 'disconnect' | 'forget') {
    if (action === 'disconnect' && !await confirm({ message: `Disconnect the ${status?.provider ?? ''} key? It is cleared from backend memory and a call in flight is cancelled.`, confirmLabel: 'Disconnect', destructive: true })) return;
    if (action === 'forget' && !await confirm({ message: `Forget the ${status?.provider ?? ''} key? This clears it from backend memory and deletes any encrypted copy saved on this machine. It cannot be undone.`, confirmLabel: 'Forget key', destructive: true })) return;
    setPending(true); setResult('');
    try {
      if (action === 'disconnect') { await configure('disconnect'); setResult('Disconnected. Credential removed from the backend.'); return; }
      if (action === 'forget') { await configure('forget'); setResult('Key forgotten: cleared from memory and any saved encrypted copy deleted.'); return; }
      const selectedModel = provider === 'mock' ? 'mock-v1' : model || custom.trim();
      if (provider !== 'mock' && !keyField.current?.value && !status?.connected) { setResult('Enter an API key before connecting.'); return; }
      if (action === 'connect' || keyField.current?.value || !status?.connected || status.provider !== provider || status.model !== selectedModel) await configure('set');
      await verify(provider === 'mock');
    } catch (error) { setResult(error instanceof ConfigurationFailure ? error.message : 'Operation failed. Check the model, key, and local server; remembering a key requires an unlocked OS keyring.'); }
    finally { setPending(false); }
  }
  return <section className="view provider-panel" aria-labelledby="connection-title">
        <h1 id="connection-title">Connection</h1>
        <p className="helper">Keys go only to this local backend and stay in its memory unless you tick Remember. Connecting makes one minimal call to prove the key works, and can incur provider charges.</p>
        <p className="connection-now">Now: <strong>{statusText(source)}</strong></p>
        <label>Provider<select value={provider} disabled={pending} onChange={event => { setProvider(event.target.value); setModel(''); setCustom(''); if (keyField.current) keyField.current.value = ''; setShow(false); }}>
          {status?.mockAvailable && <option value="mock">Mock — synthetic, no network</option>}
          <option value="openai" disabled>OpenAI (not supported until validated)</option><option value="gemini" disabled={!realMode}>Google Gemini{realMode ? '' : ' (REAL mode only)'}</option><option value="deepseek" disabled={!realMode}>DeepSeek{realMode ? '' : ' (REAL mode only)'}</option>
        </select></label>
        <p>{realMode ? 'REAL mode: a connected provider is called for real and can charge you.' : 'MOCK mode: only the free mock is available and no key is stored. Connect and verify checks the mock without any network call. Real providers need a server restart with SAINTPETRUS_MODE=real.'}</p>
        <label>Default model<select value={provider === 'mock' ? 'mock-v1' : model} disabled={pending || provider === 'mock'} onChange={event => setModel(event.target.value)}>
          {provider === 'mock' ? <option value="mock-v1">mock-v1</option> : <><option value="">Enter model ID…</option>{status?.provider === provider && status.model && <option value={status.model}>{status.model}</option>}</>}
        </select></label>
        {provider !== 'mock' && !model && <label>Model ID<input value={custom} onChange={event => setCustom(event.target.value)} maxLength={107} placeholder="Provider model ID" disabled={pending} /></label>}
        {provider !== 'mock' && <>
          <label>API key<input ref={keyField} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={4096} disabled={pending} /></label>
          <Button variant="outline" aria-pressed={show} disabled={pending} onClick={() => setShow(!show)}>{show ? 'Hide key' : 'Show key'}</Button>
          <label className="checkbox-row"><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /> Remember key using encrypted OS keyring storage</label>
          <p>Leaving this view or submitting clears this field. Terminal entry remains available with npm run key.</p>
        </>}
        <div className="project-actions">
          <Button disabled={pending} onClick={() => run('connect')}>{pending ? 'Verifying…' : 'Connect and verify (1 call)'}</Button>
          <Button variant="outline" disabled={pending || !status?.connected} onClick={() => run('test')}>Test connection (1 call)</Button>
          <Button variant="outline" disabled={pending || !status?.connected} onClick={() => run('disconnect')}>Disconnect</Button>
          <Button variant="outline" disabled={pending || !status || !keyedProviders.includes(status.provider)} onClick={() => run('forget')}>Forget key</Button>
        </div>
        {status?.remembered && <p>An encrypted copy of this key is saved on this machine. Forget key deletes it.</p>}
        <p role="status">{result}</p>
        {children}
  </section>;
}
