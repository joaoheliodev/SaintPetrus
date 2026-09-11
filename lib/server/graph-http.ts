import type { GraphEvent } from '../orchestrator';
import { safeStringify } from '../security/redact';
import { localRequest } from './http';
import type { GraphService } from './graph-service';

export function graphRoutes(graph: GraphService) {
  return new Map<string, (request: Request) => Response>([
    ['/api/graph/stream', request => graphStream(request, graph)],
  ]);
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
        send({ id: snapshot.revision, type: 'graph.snapshot', message: 'Current server state.', snapshot });
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
