import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { ProviderProxy } from '../lib/providers/proxy';
import { providerProxy } from '../lib/providers/runtime';
import { TokenService, failureBillingVerdict } from '../lib/tokens/service';
import type { TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { POST as graphPost } from '../app/api/graph/route';

// The custom server loads lib/ through tsx while Next bundles its own copy, and both reach the same singletons through
// globalThis. A copy of lib/ under another path is a second module graph in this process, exactly like that pair.
async function withForeignCopy(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'saintpetrus-copy-'));
  try {
    await cp('lib', join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{ "type": "module" }');
    await run(path => import(pathToFileURL(join(dir, 'lib', path)).href));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function withGlobals(names: string[], run: () => Promise<void>) {
  const saved = new Map(names.map((name): [string, unknown] => [name, Reflect.get(globalThis, name)]));
  const env = process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS;
  for (const name of names) Reflect.set(globalThis, name, undefined);
  try { await run(); }
  finally {
    for (const [name, value] of saved) Reflect.set(globalThis, name, value);
    if (env === undefined) delete process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS; else process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = env;
  }
}
const price = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 }, peak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 } };
const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
const isFailureClass = (value: unknown): value is new (code: string, fields?: string[]) => Error => typeof value === 'function';
const isProxyClass = (value: unknown): value is new (timeoutMs?: number) => ProviderProxy => typeof value === 'function';
const isTimeoutPin = (value: unknown): value is () => number | undefined => typeof value === 'function';
const isRuntimeFactory = (value: unknown): value is () => { graph: { snapshot(): { agents: { id: string }[] } } } => typeof value === 'function';

test('R1 a provider failure built by another copy of the modules keeps its code, fields and verdict', async () => {
  await withForeignCopy(async load => {
    const { ProviderFailure: ForeignFailure } = await load('providers/adapter.ts');
    const { ProviderProxy: ForeignProxy } = await load('providers/proxy.ts');
    assert.ok(isFailureClass(ForeignFailure) && isProxyClass(ForeignProxy));
    const rejected = new ForeignFailure('unauthorized');
    assert.equal(rejected instanceof ProviderFailure, false, 'the copies really are distinct classes');
    assert.equal(ProviderFailure.is(rejected), true);
    assert.equal(ProviderFailure.is(new Error('unauthorized')), false); assert.equal(ProviderFailure.is({ code: 'unauthorized' }), false);
    assert.equal(failureBillingVerdict(rejected), 'unbilled');
    // A proxy from the other copy, as the server used to build, passes this copy's failures through untouched.
    const unparsed = new ProviderFailure('upstream', ['candidates', 'usageMetadata']);
    const broken: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); throw unparsed; } };
    await assert.rejects(new ForeignProxy().execute(broken, 'Hi', new AbortController().signal), error => error === unparsed);
    // Through the service: a proven rejection releases its hold, and a call the busy proxy never sent is not charged.
    const service = new TokenService(policy, { date: '2026-09-27', currency: 'USD', models: { 'test-model': price } }, { ids: () => ['a', 'b'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => 0);
    const foreignProxy = new ForeignProxy();
    const refused: ProviderAdapter = { id: 'openai', model: 'test-model', complete: async (_input, _signal, _options, onDispatch) => { onDispatch?.(); throw new ProviderFailure('unauthorized'); } };
    await assert.rejects(service.execute(foreignProxy, refused, 'Question', new AbortController().signal, 'a', 'System'), /unauthorized/);
    const stalled: ProviderAdapter = { id: 'openai', model: 'test-model', complete: (_input, signal, _options, onDispatch) => new Promise((_resolve, reject) => { onDispatch?.(); signal.addEventListener('abort', () => reject(new ProviderFailure('cancelled')), { once: true }); }) };
    const running = service.execute(foreignProxy, stalled, 'Question', new AbortController().signal, 'a', 'System').catch(() => undefined);
    await assert.rejects(service.execute(foreignProxy, refused, 'Question', new AbortController().signal, 'b', 'System'), /busy/);
    foreignProxy.cancel(); await running;
    const receipts = service.receiptSnapshot().receipts.filter(receipt => receipt.kind === 'call');
    assert.deepEqual(receipts.map(receipt => [receipt.agent, receipt.verdict, receipt.outcome, receipt.dispatch === null]), [['a', 'unverifiable', 'cancelled', false], ['b', 'unbilled', 'busy', true], ['a', 'unbilled', 'unauthorized', false]]);
    assert.equal(service.snapshot().rows.find(row => row.scope === 'agent' && row.id === 'b')?.reserved, 0, 'the busy refusal holds nothing');
  });
});

test('R1 the server pins the validation timeout as plain data and leaves the proxy to the routes', async () => {
  await withGlobals(['saintpetrusProxy', 'saintpetrusTimeoutPin'], () => withForeignCopy(async load => {
    const { pinnedValidationTimeoutMs: serverPin } = await load('providers/runtime.ts');
    assert.ok(isTimeoutPin(serverPin));
    process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = '40';
    assert.equal(serverPin(), 40);
    assert.equal(Reflect.get(globalThis, 'saintpetrusProxy'), undefined, 'pinning builds no proxy');
    process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = '9000';
    const proxy = providerProxy();
    assert.ok(proxy instanceof ProviderProxy, 'the routes build the proxy from their own copy');
    assert.equal(proxy.timeoutMs, 40, 'the value pinned at startup, not a later environment');
  }));
  const server = await readFile('scripts/server.ts', 'utf8');
  assert.match(server, /pinnedValidationTimeoutMs\(\)/);
  for (const factory of ['providerProxy(', 'tokenService(', 'credentials(']) assert.ok(!server.includes(factory), `scripts/server.ts must not build ${factory}); the routes own it`);
});

test('R1 a refusal from the graph the server built reaches the browser with its own message', async () => {
  await withGlobals(['saintpetrus'], () => withForeignCopy(async load => {
    // As at startup: the server's copy builds the graph singleton that the route bundle then uses.
    const { runtime: serverRuntime } = await load('server/runtime.ts');
    assert.ok(isRuntimeFactory(serverRuntime));
    const [root] = serverRuntime().graph.snapshot().agents;
    const post = (body: object) => graphPost(new Request('http://127.0.0.1:3000/api/graph', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const refusals: [object, string][] = [[{ action: 'connect', source: root.id, target: root.id }, 'Self-connections are not allowed.'], [{ action: 'update', id: 'missing', name: 'x', objective: 'y' }, 'Agent not found.']];
    for (const [body, message] of refusals) {
      const response = await post(body);
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: message });
    }
  }));
});
