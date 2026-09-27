import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerProxy, providerStatus, validationTimeoutMs } from '../lib/providers/runtime';
import { DEFAULT_PROVIDER_TIMEOUT_MS, ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type ProviderAdapter } from '../lib/providers/adapter';
import { TokenService } from '../lib/tokens/service';
import type { TokenPolicy } from '../lib/tokens/config';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';

const price = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 }, peak: { inputCacheHitPerMillion: 1, inputCacheMissPerMillion: 1, outputPerMillion: 1 } };

async function withFreshProxy(value: string | undefined, run: () => Promise<void> | void) {
  const previous = { proxy: Reflect.get(globalThis, 'saintpetrusProxy'), env: process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS };
  Reflect.set(globalThis, 'saintpetrusProxy', undefined);
  if (value === undefined) delete process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS; else process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = value;
  try { await run(); }
  finally {
    Reflect.set(globalThis, 'saintpetrusProxy', previous.proxy);
    if (previous.env === undefined) delete process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS; else process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = previous.env;
  }
}

test('The validation timeout is off by default and accepts only an integer shorter than the default', () => {
  assert.equal(validationTimeoutMs(undefined), undefined);
  assert.equal(validationTimeoutMs(''), undefined);
  assert.equal(validationTimeoutMs('1'), 1);
  assert.equal(validationTimeoutMs(String(DEFAULT_PROVIDER_TIMEOUT_MS - 1)), DEFAULT_PROVIDER_TIMEOUT_MS - 1);
  for (const invalid of ['0', String(DEFAULT_PROVIDER_TIMEOUT_MS), '-1', '1.5', '1e3', ' 5', 'abc', '999999']) assert.throws(() => validationTimeoutMs(invalid), /SAINTPETRUS_VALIDATION_TIMEOUT_MS/, invalid);
});

test('The process proxy takes the validation timeout once, at creation, and reports it in the status', async () => {
  await withFreshProxy(undefined, () => {
    assert.equal(providerProxy().timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS);
    assert.equal('validationTimeoutMs' in providerStatus(), false);
  });
  await withFreshProxy('25', () => {
    const proxy = providerProxy();
    assert.equal(proxy.timeoutMs, 25);
    assert.equal(providerStatus().validationTimeoutMs, 25);
    // A later change to the environment cannot reach the proxy that already exists.
    process.env.SAINTPETRUS_VALIDATION_TIMEOUT_MS = '5000';
    assert.equal(providerProxy(), proxy); assert.equal(providerProxy().timeoutMs, 25);
  });
  await withFreshProxy('0', () => { assert.throws(() => providerProxy(), /SAINTPETRUS_VALIDATION_TIMEOUT_MS/); });
});

test('A request body can never set the timeout, and a forced timeout keeps preflight, budgets and the hold', async () => {
  const { POST } = await import('../app/api/provider/route');
  await withFreshProxy('25', async () => {
    const before = providerProxy().timeoutMs;
    for (const body of [{ action: 'test', timeoutMs: 1 }, { action: 'test', timeout: 1 }, { action: 'complete', input: 'Hi', validationTimeoutMs: 1 }]) {
      const response = await POST(new Request('http://127.0.0.1:3000/api/provider', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(providerProxy().timeoutMs, before);
  });
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
  const service = new TokenService(policy, { date: '2026-09-27', currency: 'USD', models: { 'test-model': price } }, { ids: () => ['a', 'b'], pause: () => {}, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => 0);
  const proxy = new ProviderProxy(25);
  let transported = 0;
  // Stalls like a slow provider and, like fetch, ends only when the proxy aborts it.
  const stalled: ProviderAdapter = { id: 'openai', model: 'test-model', complete: (_input, signal, _options, onDispatch) => new Promise((_resolve, reject) => { onDispatch?.(); transported++; signal.addEventListener('abort', () => reject(new ProviderFailure('cancelled')), { once: true }); }) };
  service.setLimit('agent', 'b', 0);
  await assert.rejects(service.execute(proxy, stalled, 'Question', new AbortController().signal, 'b', 'System'), /exhausted/);
  assert.equal(transported, 0, 'the short timeout cannot let a refused call through');
  await assert.rejects(service.execute(proxy, stalled, 'Question', new AbortController().signal, 'a', 'System'), /timeout/);
  assert.equal(transported, 1); assert.equal(proxy.dispatches.snapshot().total, 1);
  const snapshot = service.snapshot();
  assert.deepEqual(snapshot.reservations.map(item => item.status), ['unverifiable']);
  assert.ok(snapshot.rows.filter(row => row.id !== 'b').every(row => row.reserved === 65 && row.unverifiable === 1), 'a lost call keeps its hold in all four scopes');
});
