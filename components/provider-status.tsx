'use client';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
type Status = { provider: string; model: string; connected: boolean; mocked: boolean };
export function ProviderStatus() {
  const [status, setStatus] = useState<Status>({ provider: 'none', model: '', connected: false, mocked: false });
  const [result, setResult] = useState(''); const [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>; let abort: AbortController;
    const poll = async () => {
      abort = new AbortController();
      try { const response = await fetch('/api/provider', { cache: 'no-store', signal: abort.signal }); if (response.ok && !disposed) setStatus(await response.json()); }
      catch { /* No key material or raw network errors are displayed. */ }
      if (!disposed) timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { disposed = true; clearTimeout(timer); abort?.abort(); };
  }, []);
  async function test() {
    setPending(true); setResult('');
    try {
      const response = await fetch('/api/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
      const data = await response.json();
      setResult(response.ok ? `${data.mocked ? 'Mock verified' : 'Connection verified'} · ${data.latencyMs} ms` : 'Connection test failed.');
    } catch { setResult('Local server unavailable.'); }
    finally { setPending(false); }
  }
  return <div className="project-actions"><span>{status.connected ? `${status.mocked ? 'MOCK' : status.provider} · ${status.model}` : 'No provider connected'}</span>
    {status.connected && <Button variant="outline" disabled={pending} onClick={test}>{pending ? 'Testing…' : status.mocked ? 'Test mock' : 'Test connection (1 API call)'}</Button>}
    <span role="status">{result}</span>
  </div>;
}
