import { localRequest } from '../server/http';
import { artifacts, previewEnabled, type ArtifactStore } from './store';
export function optionalPreviewRoutes(enabled = previewEnabled(), store: ArtifactStore = artifacts()) {
  const routes = new Map<string, (request: Request) => Response>();
  if (enabled) routes.set('/api/artifacts', request => {
    if (!localRequest(request, false)) return new Response(null, { status: 403 });
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      let closed = false; const encoder = new TextEncoder();
      const send = () => { if (closed) return; if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); return; } controller.enqueue(encoder.encode(`data: ${JSON.stringify(store.snapshot())}\n\n`)); };
      const off = store.subscribe(send); const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); }
        else controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15000);
      const abort = () => { if (!closed) { cleanup(); controller.close(); } };
      cleanup = () => { closed = true; off(); clearInterval(heartbeat); request.signal.removeEventListener('abort', abort); };
      request.signal.addEventListener('abort', abort, { once: true }); if (request.signal.aborted) abort(); else send();
    }, cancel() { cleanup(); } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  });
  return routes;
}
// Trusted outer document. Untrusted code runs ONLY in its opaque srcdoc child.
// frame-src 'none' on this parent also blocks the child's self-navigation to network URLs.
export function previewDocument(appPort: number) {
  const origin = `http://127.0.0.1:${appPort}`;
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors ${origin}; sandbox allow-scripts`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Isolated artifact host</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style></head><body><iframe title="Generated artifact" sandbox="allow-scripts"></iframe><script>
const frame = document.querySelector('iframe');
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== ${JSON.stringify(origin)}) return;
  if (event.data?.type !== 'artifact' || typeof event.data.source !== 'string' || event.data.source.length > 100000) return;
  frame.srcdoc = event.data.source;
});
parent.postMessage({type:'preview-ready'}, ${JSON.stringify(origin)});
</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-DNS-Prefetch-Control': 'off', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()' } });
}
