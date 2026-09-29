import { createServer } from 'node:http';
import { once } from 'node:events';
import next from 'next';
import { optionalPreviewRoutes, previewDocument } from '../lib/preview/http';
import { previewEnabled } from '../lib/preview/store';
import { optionalEventRoutes } from '../lib/events/http';
import { graphRoutes } from '../lib/server/graph-http';
import { runtime } from '../lib/server/runtime';
import { pinnedValidationTimeoutMs } from '../lib/providers/runtime';
import { pinnedRunMode, retiredModeVariables } from '../lib/server/runtime';
import { securityHeaders } from '../lib/server/security-headers';
import { legacyVaultDirectory, userDataDirectory, vaultDirectory } from '../lib/server/user-data';
import { GraphStore } from '../lib/server/graph-store';
import { migrateLegacyVault } from '../lib/security/vault-migration';
import { openAccountingJournal } from '../lib/tokens/runtime';
import { rebuildAccounting } from '../lib/tokens/accounting-journal';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
const app = next({ dev: process.argv[2] === 'dev', hostname: '127.0.0.1', port });
await app.prepare();
// Pinned once, after Next has loaded .env files; the proxy the routes build later keeps it for the process lifetime.
// Only the value: this file runs its own copy of the modules, so it must not build the proxy (lib/providers/runtime.ts).
// Next already traps uncaught errors here, so an invalid value has to end the process explicitly.
const retired = retiredModeVariables();
if (retired.length) { console.error(`${retired.join(' and ')} ${retired.length > 1 ? 'are' : 'is'} no longer supported: the mock is the default and SAINTPETRUS_MODE=real opts into real providers. Remove them and restart.`); await app.close(); process.exit(1); }
let mode: string;
try { mode = pinnedRunMode(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Invalid SAINTPETRUS_MODE.'); await app.close(); process.exit(1); }
console.warn(mode === 'real' ? 'REAL mode: calls can reach a provider and cost money.' : 'MOCK mode: no provider is reachable. Start with SAINTPETRUS_MODE=real for real providers.');
let validationTimeout: number | undefined;
try { validationTimeout = pinnedValidationTimeoutMs(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Invalid validation timeout.'); await app.close(); process.exit(1); }
if (validationTimeout !== undefined) console.warn(`Validation timeout active: provider calls abort after ${validationTimeout} ms and stay unverifiable.`);
// Remembered keys leave the checkout before any request can read or write them; only counts are printed.
try {
  const { moved, kept } = await migrateLegacyVault(legacyVaultDirectory(), vaultDirectory());
  if (moved.length) console.warn(`Moved ${moved.length} remembered key file(s) from the checkout to the user data directory.`);
  if (kept.length) console.warn(`${kept.length} remembered key file(s) exist in both places; the copy in data/vault was left for you to compare and delete.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Remembered keys could not be moved.'); await app.close(); process.exit(1); }
// The saved graph is restored before the routes can read it.
let graphStore: GraphStore;
try {
  graphStore = new GraphStore(userDataDirectory(), message => console.warn(message));
  const { restored, rejectedAs } = graphStore.restore(runtime().graph);
  if (restored) console.warn('Restored the saved graph.');
  if (rejectedAs) console.warn(`The saved graph could not be read and was set aside as ${rejectedAs}; starting with a new graph.`);
  graphStore.attach(runtime().graph);
} catch (error) { console.error(error instanceof Error ? error.message : 'The saved graph could not be opened.'); await app.close(); process.exit(1); }
// The accounting journal is read here, once; the token service rebuilds from what was read when a route first needs it.
// A journal that cannot be read or opened never stops the server: real calls stay blocked and Budgets says why.
try {
  const opened = openAccountingJournal(userDataDirectory());
  const rebuilt = rebuildAccounting(opened?.records ?? []);
  const lost = rebuilt.state?.reservations.filter(item => item.status === 'inflight').length ?? 0;
  if (opened?.rejectedAs) console.warn(`The accounting journal could not be read and was set aside as ${opened.rejectedAs}. Real calls are blocked until you check the provider invoice and start a new budget period in Budgets.`);
  else if (rebuilt.blocked) console.warn('An earlier accounting journal was set aside. Real calls stay blocked until you start a new budget period in Budgets.');
  else if (rebuilt.state) console.warn('Restored token accounting from the journal. The session budget starts empty.');
  if (opened?.droppedTornTail) console.warn('The last accounting record was cut short when the server stopped and was dropped; it never took effect.');
  if (lost) console.warn(`${lost} provider call(s) were in flight when the server stopped. They come back unverifiable and their agents stay paused: check the provider invoice.`);
} catch { console.error('The accounting journal cannot be opened. Real calls are blocked until access to it is fixed and the server restarts.'); }
const handle = app.getRequestHandler();
// No Next route file exists for optional endpoints. Disabled means absent from this registry.
const routes = new Map([...graphRoutes(runtime().graph, graphStore), ...optionalEventRoutes(), ...optionalPreviewRoutes()]);
const previewPort = Number(process.env.SAINTPETRUS_PREVIEW_PORT ?? port + 1);
if (previewEnabled() && (!Number.isInteger(previewPort) || previewPort < 1024 || previewPort > 65535 || previewPort === port)) { console.error('Invalid isolated preview port.'); await app.close(); process.exit(1); }
const previewServer = previewEnabled() ? createServer(async (req, res) => {
  if (req.method !== 'GET' || req.url !== '/preview' || req.headers.host !== `127.0.0.1:${previewPort}`) { res.writeHead(404); res.end(); return; }
  const response = previewDocument(port); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
}) : undefined;
previewServer?.listen(previewPort, '127.0.0.1');
const headersForEveryResponse = Object.entries(securityHeaders({ port, previewPort: previewEnabled() ? previewPort : undefined, dev: process.argv[2] === 'dev' }));
const server = createServer(async (req, res) => {
  for (const [name, value] of headersForEveryResponse) res.setHeader(name, value);
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
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { try { graphStore.flush(); } catch { console.warn('The last graph change could not be saved.'); } server.close(); previewServer?.close(); void app.close().finally(() => process.exit(0)); });
