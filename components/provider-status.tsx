'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
import type { ConnectionState, ProviderStatusSnapshot } from '../lib/providers/runtime';
const keyedProviders = ['openai', 'gemini', 'deepseek'];
type Status = ProviderStatusSnapshot & { mockAvailable?: boolean };
// "Connected" must mean a real call succeeded. A stored credential alone only earns "configured".
const badges: Record<ConnectionState, (status: Status) => string> = {
  verified: s => `● Connected · ${s.mocked ? 'MOCK' : s.provider} · ${s.model}`,
  rejected: s => `▲ Connection rejected · ${s.provider}`,
  configured: s => `◐ Configured, not verified · ${s.mocked ? 'MOCK' : s.provider} · ${s.model}`,
  incomplete: s => `△ Output budget exhausted · ${s.provider} · ${s.model}`,
  disconnected: () => '○ Disconnected',
};
export const connectionLabel = (status: ProviderStatusSnapshot) => badges[status.state](status);
// Exported so the distinct meaning of each failure is pinned by a test, not only by the panel.
export const verificationMessage = (status: number) => failures[status] ?? 'Connection verification failed.';
const failures: Record<number, string> = {
  401: 'The provider rejected the credential or model. Check the API key and model ID.',
  402: 'The provider account has no balance left. The key is valid and the service is up, so the connection is not rejected: top up the account and test again.',
  404: 'The provider did not find this model. Check the model ID.',
  409: 'Execution was paused or refused by the budget/model policy. Open Tokens.',
  422: 'The provider spent the output budget without returning visible text. Usage was charged; increase the allowed output only after reviewing the model policy.',
  429: 'The provider rate limited the request. Try again shortly.',
  502: 'Provider communication failed. The credential was neither verified nor rejected.',
  504: 'The provider request timed out. The credential was neither verified nor rejected.',
};
const configurationFailures: Record<string, string> = {
  invalid_model_format: 'Invalid model ID format. Use the provider model ID; Gemini also accepts the models/… prefix.',
  model_not_allowlisted: 'This model is not in the server token-policy allowlist.',
};
class ConfigurationFailure extends Error {}
export function ProviderStatus() {
  const [status, setStatus] = useState<Status>();
  const [result, setResult] = useState(''); const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false); const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(''); const [custom, setCustom] = useState('');
  const [show, setShow] = useState(false); const [remember, setRemember] = useState(false);
  // Uncontrolled, transient field: no credential in React state or browser storage.
  const keyField = useRef<HTMLInputElement>(null);
  const mounted = useRef(false); const refreshController = useRef<AbortController>(null);
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    try {
      const response = await fetch('/api/provider', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Provider status unavailable.');
      const next: Status = await response.json();
      if (mounted.current && refreshController.current === controller) setStatus(next);
    } finally { if (refreshController.current === controller) refreshController.current = null; }
  }, []);
  useEffect(() => {
    mounted.current = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); }
      catch { /* Do not display raw network errors. */ }
      if (mounted.current) timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { mounted.current = false; clearTimeout(timer); refreshController.current?.abort(); };
  }, [refresh]);
  function toggle(value: boolean) {
    if (keyField.current) keyField.current.value = '';
    setShow(false); setRemember(false); setOpen(value);
    if (value) { setProvider(status?.mocked ? 'mock' : status && keyedProviders.includes(status.provider) ? status.provider : 'openai'); setModel(status && keyedProviders.includes(status.provider) ? status.model : ''); setResult(''); }
  }
  async function configure(action: 'set' | 'disconnect') {
    const selected = action === 'disconnect' ? status?.provider ?? 'none' : provider;
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
    await refresh();
  }
  // One minimal live call. Its outcome, not the presence of a key, is what the badge reports.
  async function verify(mocked: boolean) {
    const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
    const data = await response.json();
    await refresh();
    setResult(response.ok
      ? `${mocked ? 'Mock verified' : 'Connection verified'} · ${data.latencyMs} ms`
      : verificationMessage(response.status));
  }
  async function run(action: 'connect' | 'test' | 'disconnect') {
    setPending(true); setResult('');
    try {
      if (action === 'disconnect') { await configure('disconnect'); setResult('Disconnected. Credential removed from the backend.'); return; }
      const selectedModel = provider === 'mock' ? 'mock-v1' : model || custom.trim();
      if (provider !== 'mock' && !keyField.current?.value && !status?.connected) { setResult('Enter an API key before connecting.'); return; }
      if (action === 'connect' || keyField.current?.value || !status?.connected || status.provider !== provider || status.model !== selectedModel) await configure('set');
      await verify(provider === 'mock');
    } catch (error) { setResult(error instanceof ConfigurationFailure ? error.message : 'Operation failed. Check the model, key, and local server; remembering a key requires an unlocked OS keyring.'); }
    finally { setPending(false); }
  }
  return <div className="project-actions">
    <span role="status" className={`provider-badge ${status ? `is-${status.state}` : 'is-loading'}`}>{status ? connectionLabel(status) : '◌ Loading connection state'}</span>
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger render={<Button variant="outline" />}>Connect AI</DialogTrigger>
      <DialogContent className="provider-panel">
        <DialogTitle>Connect AI</DialogTitle>
        <DialogDescription>Keys go only to this local backend. Connecting makes one minimal call to prove the key works, and can incur provider charges. Memory only by default.</DialogDescription>
        <label>Provider<select value={provider} disabled={pending} onChange={event => { setProvider(event.target.value); setModel(''); setCustom(''); if (keyField.current) keyField.current.value = ''; setShow(false); }}>
          <option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option>{status?.mockAvailable && <option value="mock">Mock — synthetic, no network</option>}
        </select></label>
        <p>Additional providers are not available in this adapter yet.</p>
        <label>Default model<select value={provider === 'mock' ? 'mock-v1' : model} disabled={pending || provider === 'mock'} onChange={event => setModel(event.target.value)}>
          {provider === 'mock' ? <option value="mock-v1">mock-v1</option> : <><option value="">Enter model ID…</option>{status?.provider === provider && status.model && <option value={status.model}>{status.model}</option>}</>}
        </select></label>
        {provider !== 'mock' && !model && <label>Model ID<input value={custom} onChange={event => setCustom(event.target.value)} maxLength={107} placeholder="Provider model ID" disabled={pending} /></label>}
        {provider !== 'mock' && <>
          <label>API key<input ref={keyField} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={4096} disabled={pending} /></label>
          <Button variant="outline" aria-pressed={show} disabled={pending} onClick={() => setShow(!show)}>{show ? 'Hide key' : 'Show key'}</Button>
          <label><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /> Remember key using encrypted OS keyring storage</label>
          <p>Closing or submitting clears this field. Terminal entry remains available with npm run key.</p>
        </>}
        <Button disabled={pending} onClick={() => run('connect')}>{pending ? 'Verifying…' : 'Connect and verify (1 call)'}</Button>
        <Button variant="outline" disabled={pending || !status?.connected} onClick={() => run('test')}>Test again</Button>
        <Button variant="outline" disabled={pending || !status?.connected} onClick={() => run('disconnect')}>Disconnect</Button>
        <p role="status">{result}</p>
      </DialogContent>
    </Dialog>
  </div>;
}
