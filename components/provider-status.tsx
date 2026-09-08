'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
type Status = { provider: string; model: string; connected: boolean; mocked: boolean; mockAvailable?: boolean };
export function ProviderStatus() {
  const [status, setStatus] = useState<Status>({ provider: 'none', model: '', connected: false, mocked: false });
  const [result, setResult] = useState(''); const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false); const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(''); const [custom, setCustom] = useState('');
  const [show, setShow] = useState(false); const [remember, setRemember] = useState(false);
  // Uncontrolled, transient field: no credential in React state or browser storage.
  const keyField = useRef<HTMLInputElement>(null);
  async function refresh() {
    const response = await fetch('/api/provider', { cache: 'no-store' });
    if (response.ok) setStatus(await response.json());
  }
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>; let abort: AbortController;
    const poll = async () => {
      abort = new AbortController();
      try { const response = await fetch('/api/provider', { cache: 'no-store', signal: abort.signal }); const data = response.ok ? await response.json() : null; if (data && !disposed) setStatus(data); }
      catch { /* Do not display raw network errors. */ }
      if (!disposed) timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { disposed = true; clearTimeout(timer); abort?.abort(); };
  }, []);
  function toggle(value: boolean) {
    if (keyField.current) keyField.current.value = '';
    setShow(false); setRemember(false); setOpen(value);
    if (value) { setProvider(status.mocked ? 'mock' : status.provider === 'gemini' ? 'gemini' : 'openai'); setModel(['openai', 'gemini'].includes(status.provider) ? status.model : ''); setResult(''); }
  }
  async function configure(action: 'set' | 'disconnect') {
    const selected = action === 'disconnect' ? status.provider : provider;
    const body: Record<string, unknown> = { action, provider: selected };
    if (action === 'set') {
      body.model = selected === 'mock' ? 'mock-v1' : model || custom.trim();
      if (selected !== 'mock') { body.key = keyField.current?.value ?? ''; body.remember = remember; }
    }
    const payload = JSON.stringify(body); delete body.key;
    if (keyField.current) keyField.current.value = ''; setShow(false);
    // Only this local configuration request may carry a key; never provider execution.
    const response = await fetch('/api/credentials', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'browser' }, body: payload });
    if (!response.ok) throw new Error('Configuration failed. Check model/key; remembering requires an unlocked OS keyring.');
    await refresh();
  }
  async function run(action: 'connect' | 'test' | 'disconnect') {
    setPending(true); setResult('');
    try {
      if (action === 'disconnect') { await configure('disconnect'); setResult('Disconnected. Backend credential cleared.'); }
      else {
        const selectedModel = provider === 'mock' ? 'mock-v1' : model || custom.trim();
        if (action === 'connect' || keyField.current?.value || !status.connected || status.provider !== provider || status.model !== selectedModel) await configure('set');
        if (action === 'test') {
          const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
          const data = await response.json();
          setResult(response.ok ? `${data.mocked ? 'Mock verified' : 'Connection verified'} · ${data.latencyMs} ms` : response.status === 409 ? 'Execution paused or budget/model policy rejected the test. Open Tokens.' : 'Connection test failed.');
        } else setResult('Configured. Connection has not been tested.');
      }
    } catch { setResult('Operation failed. Check model/key and local server; remembering requires an unlocked OS keyring.'); }
    finally { setPending(false); }
  }
  return <div className="project-actions">
    <span role="status">{status.connected ? `● Configured · ${status.mocked ? 'MOCK' : status.provider} · ${status.model}` : '○ Disconnected'}</span>
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger render={<Button variant="outline" />}>Connect AI</DialogTrigger>
      <DialogContent className="provider-panel">
        <DialogTitle>Connect AI</DialogTitle>
        <DialogDescription>Keys go only to this local backend. Testing makes one minimal call and can incur provider charges. Memory only by default.</DialogDescription>
        <label>Provider<select value={provider} disabled={pending} onChange={event => { setProvider(event.target.value); setModel(''); setCustom(''); if (keyField.current) keyField.current.value = ''; setShow(false); }}>
          <option value="openai">OpenAI</option><option value="gemini">Google Gemini</option>{status.mockAvailable && <option value="mock">Mock — synthetic, no network</option>}
        </select></label>
        <p>Additional providers are not available in this adapter yet.</p>
        <label>Default model<select value={provider === 'mock' ? 'mock-v1' : model} disabled={pending || provider === 'mock'} onChange={event => setModel(event.target.value)}>
          {provider === 'mock' ? <option value="mock-v1">mock-v1</option> : <><option value="">Enter model ID…</option>{status.provider === provider && status.model && <option value={status.model}>{status.model}</option>}</>}
        </select></label>
        {provider !== 'mock' && !model && <label>Model ID<input value={custom} onChange={event => setCustom(event.target.value)} maxLength={100} placeholder="Provider model ID" disabled={pending} /></label>}
        {provider !== 'mock' && <>
          <label>API key<input ref={keyField} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={4096} disabled={pending} /></label>
          <Button variant="outline" aria-pressed={show} disabled={pending} onClick={() => setShow(!show)}>{show ? 'Hide key' : 'Show key'}</Button>
          <label><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /> Remember key using encrypted OS keyring storage</label>
          <p>Closing or submitting clears this field. Terminal entry remains available with npm run key.</p>
        </>}
        <Button disabled={pending} onClick={() => run('connect')}>Connect</Button>
        <Button disabled={pending} onClick={() => run('test')}>{pending ? 'Working…' : provider === 'mock' ? 'Test mock' : 'Test connection (1 API call)'}</Button>
        <Button variant="outline" disabled={pending || !status.connected} onClick={() => run('disconnect')}>Disconnect</Button>
        <p role="status">{result}</p>
      </DialogContent>
    </Dialog>
  </div>;
}
