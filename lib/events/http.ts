import { localRequest } from '../server/http';
import { eventBus, type EventBus } from './bus';
export const feedEnabled = () => process.env.SAINTPETRUS_FEED === 'true';
export function optionalEventRoutes(enabled = feedEnabled(), bus: EventBus = eventBus()) {
  const routes = new Map<string, (request: Request) => Response>();
  if (enabled) routes.set('/api/events', request => eventStream(request, bus));
  return routes;
}
export function eventStream(request: Request, bus: EventBus) {
  if (!localRequest(request, false)) return new Response(null, { status: 403 });
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder(); let closed = false;
      const raw = Number(request.headers.get('last-event-id') ?? 0);
      let cursor = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
      if (cursor > bus.snapshot().cursor) cursor = 0;
      const send = () => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); return; }
        const batch = bus.snapshot(cursor); cursor = batch.cursor;
        controller.enqueue(encoder.encode(`id: ${cursor}\nevent: update\ndata: ${JSON.stringify(batch)}\n\n`));
      };
      const unsubscribe = bus.subscribe(send);
      const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); }
        else controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15000);
      const abort = () => { cleanup(); controller.close(); };
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); request.signal.removeEventListener('abort', abort); };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort(); else send();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
