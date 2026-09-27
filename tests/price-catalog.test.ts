import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PriceCatalog } from '../lib/prices/catalog';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';

const model = 'synthetic-test-model';
const date = (day: number) => Date.UTC(2026, 8, day);
const rate = (): ModelPrice => ({
  provider: 'mock', sourceUrl: 'https://example.invalid/synthetic-prices',
  effectiveAt: '2026-09-01', verifiedAt: '2026-09-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion: 1_000_000, inputCacheMissPerMillion: 2_000_000, outputPerMillion: 3_000_000 },
  peak: { inputCacheHitPerMillion: 2_000_000, inputCacheMissPerMillion: 4_000_000, outputPerMillion: 6_000_000 },
});
const document = (price = rate()): Prices => ({ date: '2026-09-01', currency: 'USD', models: { [model]: price } });
const successor = () => ({ ...rate(), effectiveAt: '2026-09-15', verifiedAt: '2026-09-14' });
const catalog = () => new PriceCatalog(document(), undefined, () => date(16));
const without = (field: string) => {
  const price: Record<string, unknown> = successor();
  delete price[field];
  return price;
};
const reject = (price: unknown) => assert.throws(() => catalog().append({ model, price }));

test('price catalog requires a canonical model and accepts only an append command', () => {
  for (const id of ['', undefined, 'space in model', '../synthetic-test-model']) {
    assert.throws(() => catalog().append({ model: id, price: successor() }));
  }
  assert.throws(() => catalog().append({ model, price: successor(), delete: true }));
  assert.throws(() => catalog().append({ model }));
});

test('price catalog requires provider metadata on a new version', () => {
  reject(without('provider'));
});

test('price catalog rejects an unknown provider on a new version', () => {
  for (const provider of ['', 'unknown', null, 42]) reject({ ...successor(), provider });
});

test('price catalog requires a source URL on a new version', () => {
  reject(without('sourceUrl'));
});

test('price catalog rejects invalid or credential-bearing source URLs', () => {
  for (const sourceUrl of ['', 'not-a-url', 'file:///synthetic', 'https://user:password@example.invalid/rates', null]) {
    reject({ ...successor(), sourceUrl });
  }
});

test('price catalog requires both effective and verification dates', () => {
  reject(without('effectiveAt'));
  reject(without('verifiedAt'));
});

test('price catalog validates both date fields as strict calendar dates', () => {
  for (const field of ['effectiveAt', 'verifiedAt']) {
    for (const value of ['', '2026-02-30', '2026-9-15', '2026-09-15T00:00:00Z', null]) {
      reject({ ...successor(), [field]: value });
    }
  }
});

test('price catalog requires exclusive expiry strictly after the start', () => {
  for (const expiresAt of ['2026-09-15', '2026-09-14', '2026-02-30', null]) {
    reject({ ...successor(), expiresAt });
  }
});

test('price catalog rejects invalid rate bands and cache miss below cache hit', () => {
  for (const outputPerMillion of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e10]) {
    reject({ ...successor(), peak: { ...rate().peak, outputPerMillion } });
  }
  reject({ ...successor(), offPeak: { ...rate().offPeak, inputCacheMissPerMillion: 1 } });
  reject({ ...successor(), peak: { ...rate().peak, outputPerMillion: 1 } });
});

test('price catalog rejects invalid UTC peak windows', () => {
  for (const window of [
    { weekdays: [7], startMinute: 0, endMinute: 60 },
    { weekdays: [1, 1], startMinute: 0, endMinute: 60 },
    { weekdays: [], startMinute: 0, endMinute: 60 },
    { weekdays: [1], startMinute: 60, endMinute: 60 },
    { weekdays: [1], startMinute: 0, endMinute: 1441 },
  ]) reject({ ...successor(), peakWindowsUtc: [window] });
});

test('price catalog rejects overlap with a finite validity and duplicate start dates', () => {
  const finite = new PriceCatalog(document({ ...rate(), expiresAt: '2026-09-20' }));
  assert.throws(() => finite.append({ model, price: successor() }));
  assert.throws(() => catalog().append({ model, price: rate() }));
});

test('closing an open tariff preserves every other field and captured version byte for byte', () => {
  const original = { ...rate(), note: 'Synthetic legacy note.', legacyMetadata: { reference: 'untouched' } };
  const prices = new PriceCatalog(document(original), undefined, () => date(16));
  const captured = prices.capture(date(10));
  const before = JSON.stringify(captured[model]);
  prices.append({ model, price: successor() });
  const closed = prices.capture(date(10))[model];
  assert.ok(closed);
  const { expiresAt, ...unchanged } = closed.price;
  assert.equal(expiresAt, successor().effectiveAt);
  assert.equal(JSON.stringify(unchanged), JSON.stringify(original));
  assert.equal(JSON.stringify(captured[model]), before);
  assert.equal(closed.id, captured[model].id);
  assert.equal(prices.snapshot().models.find(row => row.model === model)?.versions.length, 2);
});

test('price catalog preserves legacy tariffs without source or provider metadata', () => {
  const original = rate();
  delete original.provider;
  delete original.sourceUrl;
  const prices = new PriceCatalog(document(original));
  prices.append({ model, price: successor() });
  const closed = prices.capture(date(10))[model];
  assert.ok(closed);
  const { expiresAt, ...unchanged } = closed.price;
  assert.equal(expiresAt, '2026-09-15');
  assert.equal(JSON.stringify(unchanged), JSON.stringify(original));
});

test('price catalog selects historical and scheduled versions with exclusive boundaries and gaps', () => {
  const prices = new PriceCatalog(document({ ...rate(), expiresAt: '2026-09-10' }), undefined, () => date(12));
  prices.append({ model, price: { ...successor(), expiresAt: '2026-09-20' } });
  assert.equal(prices.capture(date(1) - 1)[model], undefined);
  assert.equal(prices.capture(date(1))[model]?.price.effectiveAt, '2026-09-01');
  assert.equal(prices.capture(date(10))[model], undefined);
  assert.equal(prices.capture(date(15) - 1)[model], undefined);
  assert.equal(prices.capture(date(15))[model]?.price.effectiveAt, '2026-09-15');
  assert.equal(prices.capture(date(20))[model], undefined);
  const row = prices.snapshot().models.find(entry => entry.model === model);
  assert.ok(row);
  assert.equal(row.current, undefined);
  assert.deepEqual(row.versions.map(version => version.state), ['future', 'past']);
  assert.equal(prices.snapshot().at, date(12));
});

test('price catalog refuses a new validity that would change reconciled consumption', () => {
  const prices = catalog();
  prices.recordReconciliation([model], date(16), date(17));
  const before = JSON.stringify(prices.snapshot());
  assert.throws(() => prices.append({ model, price: successor() }));
  assert.equal(JSON.stringify(prices.snapshot()), before);
});

test('closing an old validity also refuses reconciled periods beyond the new validity', () => {
  const prices = catalog();
  prices.recordReconciliation([model], date(20), date(21));
  assert.throws(() => prices.append({ model, price: { ...successor(), expiresAt: '2026-09-16' } }));
  assert.equal(prices.capture(date(20))[model]?.price.expiresAt, undefined);
});

test('price catalog permits a successor exactly after a reconciled half-open period', () => {
  const prices = catalog();
  prices.recordReconciliation([model], date(14), date(15));
  prices.append({ model, price: successor() });
  assert.equal(prices.capture(date(15))[model]?.price.effectiveAt, '2026-09-15');
});

test('a reconciliation of another model does not block an unrelated tariff update', () => {
  const other = 'synthetic-other-model';
  const prices = new PriceCatalog({ ...document(), models: { [model]: rate(), [other]: rate() } });
  prices.recordReconciliation([other], date(16), date(17));
  prices.append({ model, price: successor() });
  assert.equal(prices.capture(date(16))[other]?.price.expiresAt, undefined);
});

test('price catalog persists closure, versions and reconciliation protection across restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'saintpetrus-price-catalog-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'prices.json');
  writeFileSync(file, JSON.stringify(document()));
  const prices = new PriceCatalog(document(), file, () => date(16));
  prices.append({ model, price: successor() });
  prices.recordReconciliation([model], date(17), date(18));
  const reloaded = new PriceCatalog(JSON.parse(readFileSync(file, 'utf8')), file, () => date(16));
  assert.deepEqual(reloaded.snapshot(), prices.snapshot());
  const before = readFileSync(file, 'utf8');
  assert.throws(() => reloaded.append({ model, price: { ...successor(), effectiveAt: '2026-09-17' } }));
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(readdirSync(directory), ['prices.json']);
});

test('failed atomic replacement preserves destination content and catalog memory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'saintpetrus-price-catalog-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const destination = join(directory, 'prices.json');
  mkdirSync(destination);
  const sentinel = join(destination, 'unchanged.json');
  writeFileSync(sentinel, JSON.stringify(document()));
  const before = readFileSync(sentinel, 'utf8');
  const prices = new PriceCatalog(document(), destination, () => date(16));
  const snapshot = prices.snapshot();
  assert.throws(() => prices.append({ model, price: successor() }), /persist/i);
  assert.equal(readFileSync(sentinel, 'utf8'), before);
  assert.deepEqual(prices.snapshot(), snapshot);
  assert.deepEqual(readdirSync(directory), ['prices.json']);
});

test('F2 synthetic mock usage never rewrites the operator price file; real reconciliation still journals', async () => {
  const { mkdir, mkdtemp, readFile: read, rm, writeFile } = await import('node:fs/promises');
  const { TokenService } = await import('../lib/tokens/service');
  const { ProviderProxy } = await import('../lib/providers/proxy');
  const { PriceCatalog } = await import('../lib/prices/catalog');
  const { join } = await import('node:path');
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/price-file-');
  const file = join(dir, 'prices.json');
  const flat = { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 }, peak: { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 } };
  const document: Prices = { date: '2026-09-27', currency: 'USD', models: { 'mock-v1': { ...flat, provider: 'mock' }, 'test-model': { ...flat, provider: 'openai' } } };
  try {
    await writeFile(file, JSON.stringify(document));
    const original = await read(file, 'utf8');
    const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 }, 'test-model': { provider: 'openai', max_tokens: 64, temperature: 0 } } };
    const service = new TokenService(policy, document, { ids: () => ['a'], pause: () => {}, pauseAll: () => {} }, undefined, Date.now, new PriceCatalog(structuredClone(document), file));
    await service.execute(new ProviderProxy(), { id: 'mock', model: 'mock-v1', complete: async () => ({ text: 'Synthetic' }) }, 'Question', new AbortController().signal, 'a', 'System');
    assert.equal(await read(file, 'utf8'), original, 'a mock call leaves the file byte-identical');
    await service.execute(new ProviderProxy(), { id: 'openai', model: 'test-model', complete: async () => ({ text: 'Answer', usage: { prompt: 1, completion: 1, total: 2 } }) }, 'Question', new AbortController().signal, 'a', 'System');
    assert.deepEqual(JSON.parse(await read(file, 'utf8')).reconciled.map((entry: { models: string[] }) => entry.models), [['test-model']], 'real consumption is still protected');
  } finally { await rm(dir, { recursive: true }); }
});
