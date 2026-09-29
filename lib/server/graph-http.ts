import type { GraphEvent } from '../orchestrator';
import { safeJson, safeStringify } from '../security/redact';
import { localRequest } from './http';
import type { GraphService } from './graph-service';
import type { GraphStore } from './graph-store';

// The store exists only in the custom server's copy of the modules, so its state is served from here, read-only:
// the server answers 405 to anything but GET on these paths.
export function graphRoutes(graph: GraphService, store: Pick<GraphStore, 'persistence'>) {
  return new Map<string, (request: Request) => Response>([
    ['/api/graph/stream', request => graphStream(request, graph)],
    ['/api/graph/persistence', request => graphPersistence(request, store)],
  ]);
}

export function graphPersistence(request: Request, store: Pick<GraphStore, 'persistence'>) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  return safeJson(store.persistence());
}

export function graphStream(request: Request, graph: GraphService) {
  if (!localRequest(request, false)) return new Response(null, { status: 403 });
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder(); let closed = false;
      const send = (event: GraphEvent) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); return; }
        controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${safeStringify(event)}\n\n`));
      };
      const unsubscribe = graph.subscribe(send);
      const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); }
        else controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15000);
      const abort = () => { cleanup(); controller.close(); };
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); request.signal.removeEventListener('abort', abort); };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      else {
        const snapshot = graph.snapshot();
        send({ id: snapshot.revision, type: 'graph.snapshot', message: 'Current server state.', snapshot, at: Date.now() });
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
