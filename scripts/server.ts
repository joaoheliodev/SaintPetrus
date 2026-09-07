import { createServer } from 'node:http';
import { once } from 'node:events';
import next from 'next';
import { optionalEventRoutes } from '../lib/events/http';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
const app = next({ dev: process.argv[2] === 'dev', hostname: '127.0.0.1', port });
await app.prepare();
const handle = app.getRequestHandler();
// No Next route file exists for optional endpoints. Disabled means absent from this registry.
const routes = optionalEventRoutes();
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const route = routes.get(url.pathname);
    if (!route) { await handle(req, res); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const response = route(new Request(url, { headers, signal: controller.signal }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.flushHeaders();
    const reader = response.body?.getReader();
    if (reader) {
      try { while (!controller.signal.aborted) { const { value, done } = await reader.read(); if (done) break; if (!res.write(value)) await once(res, 'drain', { signal: controller.signal }); } }
      finally { await reader.cancel(); }
    }
    res.end();
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); void app.close().finally(() => process.exit(0)); });
