import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/prices/route';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';

const model = 'synthetic-test-model';
const origin = 'http://127.0.0.1:3100';
const invalidPrice = 'Invalid price validity: model, provider, source URL and verified dates are required.';
const rate = (): ModelPrice => ({
  provider: 'mock', sourceUrl: 'https://example.invalid/synthetic-rates',
  effectiveAt: '2026-09-01', verifiedAt: '2026-09-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion: 1_000_000, inputCacheMissPerMillion: 2_000_000, outputPerMillion: 3_000_000 },
  peak: { inputCacheHitPerMillion: 2_000_000, inputCacheMissPerMillion: 4_000_000, outputPerMillion: 6_000_000 },
});
const successor = () => ({ model, price: { ...rate(), effectiveAt: '2026-09-15', verifiedAt: '2026-09-14' } });
const post = (body: unknown, headers?: Record<string, string>) => new Request(`${origin}/api/prices`, {
  method: 'POST', body: JSON.stringify(body), headers: {
    origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers,
  },
});

async function withService(run: (service: TokenService) => Promise<void>) {
  const policy: TokenPolicy = {
    global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000,
    costLimitsUsd: { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000 },
    cacheTtlMs: 0, reservationTtlMs: 100,
    models: { [model]: { provider: 'mock', max_tokens: 64, temperature: 0 } },
  };
  const prices: Prices = { date: '2026-09-01', currency: 'USD', models: { [model]: rate() } };
  const service = new TokenService(policy, prices, { ids: () => [], pause: () => {}, pauseAll: () => {} }, undefined, () => Date.UTC(2026, 8, 16));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'saintpetrusTokens');
  Object.defineProperty(globalThis, 'saintpetrusTokens', { value: service, configurable: true, writable: true });
  try { await run(service); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'saintpetrusTokens', previous);
    else Reflect.deleteProperty(globalThis, 'saintpetrusTokens');
  }
}

test('price admin accepts a same-origin browser append without credential configuration headers', async () => {
  await withService(async service => {
    const response = await POST(post(successor()));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), service.catalog.snapshot());
    assert.equal(service.catalog.capture(Date.UTC(2026, 8, 14))[model].price.expiresAt, '2026-09-15');
    assert.equal(service.catalog.capture(Date.UTC(2026, 8, 15))[model].price.effectiveAt, '2026-09-15');
  });
});

test('price admin rejects cross-origin and non-local access without changing the catalog', async () => {
  await withService(async service => {
    const before = service.catalog.snapshot();
    const rejectedHeaders: Record<string, string>[] = [
      { origin: 'https://example.invalid' },
      { 'sec-fetch-site': 'cross-site' },
      { host: 'localhost:3100' },
      { 'content-type': 'text/plain' },
      { origin: '' },
    ];
    for (const headers of rejectedHeaders) {
      const response = await POST(post(successor(), headers));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'Same-origin requests only.' });
      assert.deepEqual(service.catalog.snapshot(), before);
    }
    const response = await GET(new Request('http://example.invalid/api/prices'));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Local requests only.' });
  });
});

test('price admin returns safe validation errors for malformed JSON and missing source metadata', async () => {
  await withService(async service => {
    const before = service.catalog.snapshot();
    const malformed = new Request(`${origin}/api/prices`, { method: 'POST', body: '{', headers: { origin, 'content-type': 'application/json' } });
    const response = await POST(malformed);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid price request.' });
    const noSource = successor();
    delete noSource.price.sourceUrl;
    for (const input of [{ model }, noSource]) {
      const rejected = await POST(post(input));
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: invalidPrice });
    }
    assert.deepEqual(service.catalog.snapshot(), before);
  });
});

test('price admin refuses overlap and reconciled-period closure without changing the catalog', async () => {
  await withService(async service => {
    const before = service.catalog.snapshot();
    const overlap = await POST(post({ model, price: rate() }));
    assert.equal(overlap.status, 400);
    assert.deepEqual(await overlap.json(), { error: 'Price validities overlap.' });
    assert.deepEqual(service.catalog.snapshot(), before);
    service.catalog.recordReconciliation([model], Date.UTC(2026, 8, 20), Date.UTC(2026, 8, 21));
    const retroactive = await POST(post({ model, price: { ...successor().price, expiresAt: '2026-09-16' } }));
    assert.equal(retroactive.status, 400);
    assert.deepEqual(await retroactive.json(), { error: 'Price validity would change an already reconciled period.' });
    assert.deepEqual(service.catalog.snapshot(), before);
  });
});

test('price admin GET exposes the server current version and unchanged complete history', async () => {
  await withService(async service => {
    service.catalog.append(successor());
    const response = await GET(new Request(`${origin}/api/prices`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), service.catalog.snapshot());
    const row = service.catalog.snapshot().models[0];
    assert.equal(row.current?.price.effectiveAt, '2026-09-15');
    assert.deepEqual(row.versions.map(version => version.state), ['current', 'past']);
  });
});

test('price admin never echoes unexpected internal errors', async () => {
  await withService(async service => {
    const before = service.catalog.snapshot();
    service.catalog.append = () => { throw new Error('Synthetic private filesystem failure.'); };
    const response = await POST(post(successor()));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid price request.' });
    assert.deepEqual(service.catalog.snapshot(), before);
  });
});
