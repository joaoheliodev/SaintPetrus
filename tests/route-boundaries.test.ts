import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as tokensGet, POST as tokensPost } from '../app/api/tokens/route';
import { GET as providerGet, POST as providerPost } from '../app/api/provider/route';
import { GET as pricesGet } from '../app/api/prices/route';
import { POST as credentialsPost } from '../app/api/credentials/route';
import { POST as graphPost } from '../app/api/graph/route';
import { optionalPreviewRoutes } from '../lib/preview/http';
import { ArtifactStore } from '../lib/preview/store';
import { TokenService } from '../lib/tokens/service';
import { runtime } from '../lib/server/runtime';
import type { TokenPolicy } from '../lib/tokens/config';
import { withRunMode } from './run-mode';

const origin = 'http://127.0.0.1:3000';
const post = (path: string, body: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body });
const flat = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 }, peak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 } };

async function withGlobal(name: string, value: unknown, run: () => Promise<void>) {
  const previous = Reflect.get(globalThis, name);
  Reflect.set(globalThis, name, value);
  try { await run(); } finally { Reflect.set(globalThis, name, previous); }
}

test('Q1 token controls refuse foreign requests and malformed commands, and fail closed on a broken owner', async () => {
  const policy: TokenPolicy = { global: 100, perAgent: 100, perModel: 100, perSession: 100, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'mock-v1': { provider: 'mock', max_tokens: 8, temperature: 0 } } };
  const service = new TokenService(policy, { date: '2026-09-27', currency: 'USD', models: { 'mock-v1': { ...flat, provider: 'mock' } } }, { ids: () => ['root'], pause: () => {}, pauseAll: () => {} });
  await withGlobal('saintpetrusTokens', service, async () => {
    assert.equal((await tokensGet(new Request('http://attacker.invalid/api/tokens'))).status, 403);
    assert.equal((await tokensPost(post('tokens', '{"action":"kill"}', { Origin: 'https://example.invalid' }))).status, 403);
    assert.equal((await tokensPost(post('tokens', '{"action":"kill"}', { 'Content-Type': 'text/plain' }))).status, 403);
    for (const body of ['not json', '[]', '{"action":"kill","extra":1}', '{"action":"explode"}', '{"action":"limit","scope":"global","id":"all","limit":-1}', '{"action":"reconcile","reservationId":"missing","prompt":1,"completion":1,"costUsd":0}']) {
      const response = await tokensPost(post('tokens', body));
      assert.equal(response.status, 400, body);
      assert.deepEqual(await response.json(), { error: 'Token control rejected. Check scope, limits and unverifiable usage.' });
    }
    assert.equal(service.isStopped(), false, 'a rejected command changes nothing');
    const limited = await tokensPost(post('tokens', '{"action":"limit","scope":"global","id":"all","limit":42}'));
    assert.equal(limited.status, 200); assert.equal((await limited.json()).rows.find((row: { scope: string }) => row.scope === 'global').limit, 42);
    assert.equal((await tokensPost(post('tokens', '{"action":"resume"}'))).status, 200);
  });
  await withGlobal('saintpetrusTokens', { snapshot: () => { throw new Error('Synthetic private configuration failure.'); } }, async () => {
    const broken = await tokensGet(new Request(`${origin}/api/tokens`));
    assert.equal(broken.status, 503); assert.deepEqual(await broken.json(), { error: 'Invalid local token configuration.' });
  });
  await withGlobal('saintpetrusTokens', { catalog: { snapshot: () => { throw new Error('Synthetic private catalog failure.'); } } }, async () => {
    const broken = await pricesGet(new Request(`${origin}/api/prices`));
    assert.equal(broken.status, 503); assert.deepEqual(await broken.json(), { error: 'Price catalog unavailable. Check local configuration.' });
  });
});

test('Q1 the provider route refuses foreign requests and malformed bodies before any execution', async () => {
  assert.equal((await providerGet(new Request('http://attacker.invalid/api/provider'))).status, 403);
  assert.equal((await providerPost(post('provider', '{"action":"test"}', { Origin: 'https://example.invalid' }))).status, 403);
  assert.equal((await providerPost(post('provider', '{"action":"test"}', { 'Content-Type': 'text/plain' }))).status, 403);
  for (const body of ['not json', '[]', '"test"', '{"action":"delete"}', JSON.stringify({ action: 'complete', input: 'x'.repeat(17000) })]) {
    const response = await providerPost(post('provider', body));
    assert.equal(response.status, 400, body.slice(0, 40)); assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
});

test('Q1 credential configuration refuses malformed, unknown and mixed-client requests without echoing them', async () => {
  const browser = { 'X-SaintPetrus-Client': 'browser', 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await credentialsPost(post('credentials', '{}', { 'X-SaintPetrus-Client': 'browser' }))).status, 403, 'a browser request must carry fetch metadata');
  assert.equal((await credentialsPost(post('credentials', '{}', { 'X-SaintPetrus-Client': 'terminal', 'Sec-Fetch-Site': 'same-origin' }))).status, 403, 'a terminal request cannot come from a page');
  assert.equal((await credentialsPost(post('credentials', '{}'))).status, 403, 'a client header is required');
  const invalid = await credentialsPost(post('credentials', 'PRIVATE-NOT-JSON', browser));
  assert.equal(invalid.status, 400); assert.ok(!(await invalid.text()).includes('PRIVATE'));
  for (const body of [{ action: 'set', provider: 'openai', model: 'test-model', key: 'k', extra: true }, { action: 'explode', provider: 'openai' }, { action: 'set', provider: 'mock', model: 'mock-v1', key: 'k' }]) {
    const response = await credentialsPost(post('credentials', JSON.stringify(body), browser));
    assert.equal(response.status, 400, JSON.stringify(body)); assert.match((await response.json()).error, /Credential operation failed/);
  }
  const previous = process.env.SAINTPETRUS_MOCK; process.env.SAINTPETRUS_MOCK = 'true';
  const selection = Reflect.get(globalThis, 'saintpetrusSelection');
  try {
    assert.deepEqual(await (await credentialsPost(post('credentials', JSON.stringify({ action: 'set', provider: 'mock', model: 'mock-v1' }), browser))).json(), { provider: 'mock', connected: true, remembered: false });
    assert.deepEqual(await (await credentialsPost(post('credentials', JSON.stringify({ action: 'disconnect', provider: 'mock' }), browser))).json(), { provider: 'mock', connected: false, remembered: false });
  } finally {
    Reflect.set(globalThis, 'saintpetrusSelection', selection);
    if (previous === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = previous;
  }
});

test('Q1 graph commands validate moves, limits and mock runs on the server', async () => {
  runtime().mock.reset();
  const graph = runtime().graph;
  const command = async (body: object) => graphPost(post('graph', JSON.stringify(body)));
  assert.equal((await command({ action: 'move', id: 'root', x: 100.5, y: -20 })).status, 200);
  assert.deepEqual(graph.snapshot().agents[0].position, { x: 100.5, y: -20 });
  // The mock runs are refused only in REAL mode.
  await withRunMode('real', async () => {
    for (const body of [{ action: 'move', id: 'root', x: '1', y: 2 }, { action: 'move', id: 'root', x: 1e9, y: 0 }, { action: 'budget', depth: 2, nodes: 5 }, { action: 'budget', depth: 99, nodes: 5, cents: 10 }, { action: 'preview-mock' }, { action: 'start', objective: 'Mock disabled' }]) {
      assert.equal((await command(body)).status, 400, JSON.stringify(body));
    }  });

  assert.equal((await command({ action: 'budget', depth: 2, nodes: 5, cents: 10 })).status, 200);
  assert.deepEqual(graph.snapshot().budget, { maxDepth: 2, maxNodes: 5, maxCostCents: 10 });
  try {
    assert.equal((await command({ action: 'start', objective: 'Mock run' })).status, 200); assert.equal(graph.snapshot().status, 'running');
    assert.equal((await command({ action: 'pause' })).status, 200); assert.equal(graph.snapshot().status, 'paused');
    assert.equal((await command({ action: 'resume' })).status, 200); assert.equal(graph.snapshot().status, 'running');
  } finally { runtime().mock.reset(); }
});

test('Q1 the artifact stream is local only and opens with the current versions', async () => {
  const store = new ArtifactStore();
  store.update('root', 'Designer', '<html><p>Synthetic</p></html>'); store.flush();
  const route = optionalPreviewRoutes(true, store).get('/api/artifacts')!;
  assert.equal(route(new Request('http://attacker.invalid/api/artifacts')).status, 403);
  const controller = new AbortController();
  const response = route(new Request(`${origin}/api/artifacts`, { signal: controller.signal }));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^data: \[\{"id":1,"agent_id":"root","role":"Designer"/);
  controller.abort(); await reader.cancel();
  assert.equal(optionalPreviewRoutes(false, store).size, 0, 'disabled means absent');
});
