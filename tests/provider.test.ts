import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { ProviderProxy } from '../lib/providers/proxy';
import { OpenAIAdapter } from '../lib/providers/openai';
import { MockLLMAdapter } from '../lib/providers/mock-provider';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';
import { safeLog, safeStringify } from '../lib/security/redact';
import { POST } from '../app/api/provider/route';
import { GET as exportGraph } from '../app/api/graph/export/route';
import { runtime } from '../lib/server/runtime';
const signal = () => new AbortController().signal;
const request = (body: unknown) => new Request('http://127.0.0.1:3000/api/provider', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('M2 proxy mock, input validation, busy, timeout and cancellation', async () => {
  const proxy = new ProviderProxy(20);
  const result = await proxy.execute(new MockLLMAdapter(), 'Hello', signal());
  assert.equal(result.mocked, true); assert.ok(result.latencyMs >= 0);
  await assert.rejects(proxy.execute(new MockLLMAdapter(), '', signal()), /invalid_request/);
  const waiting = { id: 'mock' as const, model: 'mock-v1', complete: async (_input: string, abort: AbortSignal): Promise<{text: string}> => new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) };
  const pending = proxy.execute(waiting, 'Hello', signal());
  const timedOut = assert.rejects(pending, /timeout/);
  await assert.rejects(proxy.execute(waiting, 'Hello', signal()), /busy/);
  await timedOut;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(proxy.execute(waiting, 'Hello', controller.signal), /cancelled/);
  assert.equal((await proxy.execute(new MockLLMAdapter(), 'Again', signal())).mocked, true);
});

test('M2 frontend test request carries no credential; server rejects credential fields', async () => {
  const previous = process.env.SAINTPETRUS_MOCK, selected = process.env.SAINTPETRUS_PROVIDER;
  process.env.SAINTPETRUS_MOCK = 'true'; process.env.SAINTPETRUS_PROVIDER = 'mock';
  try {
    const req = request({ action: 'test' });
    assert.deepEqual(await req.clone().json(), { action: 'test' });
    assert.equal(req.headers.has('authorization'), false);
    assert.equal(new URL(req.url).search, '');
    assert.equal((await POST(req)).status, 200);
    assert.equal((await POST(request({ action: 'test', key: 'sk-REPLACE_ME' }))).status, 400);
    assert.equal((await POST(request({ action: 'test', url: 'https://example.invalid' }))).status, 400);
    process.env.SAINTPETRUS_MOCK = 'false';
    assert.equal((await POST(request({ action: 'test' }))).status, 409);
    const client = await readFile('components/provider-status.tsx', 'utf8');
    assert.ok(client.includes("JSON.stringify({ action: 'test' })"));
    assert.ok(!/Authorization|localStorage|sessionStorage/.test(client));
  } finally {
    if (previous === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = previous;
    if (selected === undefined) delete process.env.SAINTPETRUS_PROVIDER; else process.env.SAINTPETRUS_PROVIDER = selected;
  }
});

test('M2 adapter keeps credentials in backend header; proxy redacts output, log, stack, API error and export', async () => {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/proxy-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden in this test'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials };
  const previousStore = host.saintpetrusCredentials, oldFetch = globalThis.fetch;
  const previousProvider = process.env.SAINTPETRUS_PROVIDER, previousModel = process.env.SAINTPETRUS_MODEL;
  let calls = 0;
  try {
    await store.configure('openai', secret); host.saintpetrusCredentials = store;
    const transport: typeof fetch = async (url, options) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options?.redirect, 'error');
      assert.ok(new Headers(options?.headers).get('authorization') === `Bearer ${secret.toString()}`);
      assert.ok(!String(options?.body).includes(secret.toString()));
      const body = JSON.parse(String(options?.body)); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 64);
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: secret.toString() }] }] });
    };
    const output = await new ProviderProxy().execute(new OpenAIAdapter('test-model', store, transport), secret.toString(), signal());
    assert.equal(calls, 1); assert.ok(!JSON.stringify(output).includes(secret.toString()));
    runtime().graph.add({ name: 'Proxy export', provider: 'Unconfigured', context: { objective: 'Test', summary: output.text, artifacts: [] } });
    assert.ok(!(await (await exportGraph(new Request('http://127.0.0.1:3000/api/graph/export'))).text()).includes(secret.toString()));
    const failing: typeof fetch = async () => { throw new Error(secret.toString()); };
    let caught: unknown;
    try { await new ProviderProxy().execute(new OpenAIAdapter('test-model', store, failing), 'Hello', signal()); } catch (error) { caught = error; }
    assert.ok(caught instanceof Error); assert.ok(!String(caught.stack).includes(secret.toString()));
    let logged = ''; safeLog(caught, text => { logged = text; });
    assert.ok(!logged.includes(secret.toString())); assert.ok(!safeStringify(caught).includes(secret.toString()));
    globalThis.fetch = failing; process.env.SAINTPETRUS_PROVIDER = 'openai'; process.env.SAINTPETRUS_MODEL = 'test-model';
    const errorResponse = await POST(request({ action: 'test' }));
    assert.equal(errorResponse.status, 502); assert.ok(!(await errorResponse.text()).includes(secret.toString()));
    for (const response of [Response.json({ error: secret.toString() }, { status: 401 }), Response.json({ unexpected: true }), new Response('x'.repeat(262145))]) {
      await assert.rejects(new OpenAIAdapter('test-model', store, async () => response).complete('Hi', signal()), /upstream/);
    }
  } finally {
    globalThis.fetch = oldFetch; host.saintpetrusCredentials = previousStore; store.disconnect('openai'); secret.fill(0); runtime().mock.reset();
    if (previousProvider === undefined) delete process.env.SAINTPETRUS_PROVIDER; else process.env.SAINTPETRUS_PROVIDER = previousProvider;
    if (previousModel === undefined) delete process.env.SAINTPETRUS_MODEL; else process.env.SAINTPETRUS_MODEL = previousModel;
    await rm(dir, { recursive: true });
  }
});

test('RF-01 same-origin UI configures memory-only credentials, tests once, and disconnects', async () => {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/ui-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const { POST: configure } = await import('../app/api/credentials/route');
  const { providerStatus } = await import('../lib/providers/runtime');
  const host = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials; saintpetrusSelection?: {provider: string; model: string} };
  const previous = host.saintpetrusCredentials, selection = host.saintpetrusSelection, transport = globalThis.fetch;
  host.saintpetrusCredentials = store;
  const key = randomBytes(32).toString('hex'); let calls = 0;
  const browserRequest = (body: unknown, origin = 'http://127.0.0.1:3000') => new Request('http://127.0.0.1:3000/api/credentials', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'browser', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body) });
  try {
    const body = { action: 'set', provider: 'openai', model: 'test-model', key };
    assert.equal((await configure(browserRequest(body, 'https://example.invalid'))).status, 403);
    assert.equal((await configure(browserRequest({ ...body, model: 'invalid model' }))).status, 400);
    assert.equal(store.status('openai').connected, false);
    const saved = await configure(browserRequest(body)); assert.equal(saved.status, 200); assert.ok(!(await saved.text()).includes(key));
    assert.equal(store.status('openai').remembered, false); assert.equal(providerStatus().model, 'test-model');
    globalThis.fetch = async (_url, options) => {
      calls++; assert.ok(new Headers(options?.headers).get('authorization') === `Bearer ${key}`);
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    };
    const result = await POST(request({ action: 'test' })); assert.equal(result.status, 200); assert.equal(calls, 1);
    assert.ok(!(await result.text()).includes(key));
    assert.equal((await configure(browserRequest({ action: 'disconnect', provider: 'openai' }))).status, 200);
    assert.equal(store.status('openai').connected, false);
    assert.equal((await POST(request({ action: 'test' }))).status, 409); assert.equal(calls, 1);
  } finally { store.disconnect('openai'); host.saintpetrusCredentials = previous; host.saintpetrusSelection = selection; globalThis.fetch = transport; await rm(dir, { recursive: true }); }
});

test('B proxy invokes the injected core TokenCounter on the request path', async () => {
  const { tokenCounterFrom } = await import('../lib/core/token-estimate'); let measured = '';
  const counter = tokenCounterFrom('integration-test', text => { measured = text; return 7; }, true);
  const result = await new ProviderProxy(100, counter).execute(new MockLLMAdapter(), 'Actual request', signal());
  assert.equal(measured, 'Actual request'); assert.deepEqual(result.preflight, { tokens: 7, approximate: true, counterName: 'integration-test' });
});
