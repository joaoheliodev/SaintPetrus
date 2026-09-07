'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { ArtifactVersion } from '../lib/preview/store';
export function ArtifactFrame({ url, frameRef, loaded }: { url: string; frameRef: React.RefObject<HTMLIFrameElement | null>; loaded: () => void }) {
  return <iframe ref={frameRef} title="Isolated artifact preview" sandbox="allow-scripts" referrerPolicy="no-referrer" src={url} onLoad={loaded} />;
}
export function ArtifactPreview({ port }: { port: number }) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([]); const [current, setCurrent] = useState<ArtifactVersion>();
  const [paused, setPaused] = useState(false); const pausedRef = useRef(false); const [code, setCode] = useState(false);
  const [status, setStatus] = useState('Connecting'); const frame = useRef<HTMLIFrameElement>(null); const currentRef = useRef<ArtifactVersion>(undefined);
  const send = () => { if (currentRef.current) frame.current?.contentWindow?.postMessage({ type: 'artifact', source: currentRef.current.source }, '*'); };
  useEffect(() => {
    const stream = new EventSource('/api/artifacts');
    stream.onmessage = event => { const values = JSON.parse(event.data) as ArtifactVersion[]; setVersions(values); setStatus('Live · SSE'); if (!pausedRef.current && values[0]) { currentRef.current = values[0]; setCurrent(values[0]); send(); } };
    stream.onerror = () => setStatus('Reconnecting');
    const ready = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow && event.origin === 'null' && event.data?.type === 'preview-ready') send(); };
    window.addEventListener('message', ready);
    return () => { stream.close(); window.removeEventListener('message', ready); };
  }, []);
  function pause() { const next = !pausedRef.current; pausedRef.current = next; setPaused(next); if (!next && versions[0]) { currentRef.current = versions[0]; setCurrent(versions[0]); send(); } }
  function select(id: number) { const version = versions.find(v => v.id === id); if (version) { pausedRef.current = true; setPaused(true); currentRef.current = version; setCurrent(version); send(); } }
  return <section className="artifact-preview" aria-label="Artifact preview">
    <h2>Artifact preview · {status}</h2>
    <p>Off by default because it executes LLM-generated code inside an isolated sandbox.</p>
    <p>Producer: {current?.role ?? 'No artifact'} · Version: {current?.id ?? '—'}</p>
    <button onClick={pause}>{paused ? 'Resume updates' : 'Pause updates'}</button>
    <button onClick={() => setCode(!code)}>{code ? 'Show preview' : 'Show source'}</button>
    <button disabled={!current || !versions.some(v => v.id < current.id)} onClick={() => { const older = versions.find(v => current && v.id < current.id); if (older) select(older.id); }}>Previous version</button>
    <label>Artifact version<select value={current?.id ?? ''} onChange={e => select(Number(e.target.value))}><option value="" disabled>No version</option>{versions.map(v => <option key={v.id} value={v.id}>{v.id} · {v.role} · {v.timestamp}</option>)}</select></label>
    <div hidden={code}><ArtifactFrame url={`http://127.0.0.1:${port}/preview`} frameRef={frame} loaded={send} /></div>
    {code && <pre>{current?.source ?? 'Waiting for generated HTML/CSS/JS.'}</pre>}
    <p>Last 20 versions, process-local. Updates are debounced; paused versions stay visible until resumed.</p>
  </section>;
}
