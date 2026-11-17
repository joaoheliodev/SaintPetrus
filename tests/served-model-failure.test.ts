// F-01 (Round 10): a response that names who served it and then cannot be used still names that model in the failure,
// the reservation, the receipts and a later manual reconciliation. Naming it never changes what expiry charges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { TokenFailure, TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import type { ModelPrice } from '../lib/tokens/pricing';
import { ProviderProxy } from '../lib/providers/proxy';
import { ProviderFailure, type Completion, type ProviderAdapter, type RequestOptions } from '../lib/providers/adapter';
import { DeepSeekAdapter } from '../lib/providers/deepseek';
import { GeminiAdapter } from '../lib/providers/gemini';
import { OpenAIAdapter } from '../lib/providers/openai';
import { servedModelId } from '../lib/providers/model-id';
import { fixedRatioTokenCounter } from '../lib/core/token-estimate';
import { eventBus } from '../lib/events/bus';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';

// Fictitious identifiers and rates, for these tests only.
const requested = 'synthetic-requested';
const served = 'synthetic-served';
const marker = 'VALUE-THAT-MUST-NOT-BE-RECORDED';
const flat = (input: number, output: number): ModelPrice => ({ effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [],
  offPeak: { inputCacheHitPerMillion: input, inputCacheMissPerMillion: input, outputPerMillion: output },
  peak: { inputCacheHitPerMillion: input, inputCacheMissPerMillion: input, outputPerMillion: output } });
const options: RequestOptions = { systemPrompt: 'System', messages: [{ role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 64, thinking: { mode: 'disabled' } };
const keyed: Exclude<ProviderAdapter['id'], 'mock'>[] = ['deepseek', 'gemini', 'openai'];
const signal = () => new AbortController().signal;
const caught = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

async function withKeys(run: (store: Credentials) => Promise<void>) {
  await mkdir('.audit', { recursive: true }); const dir = await mkdtemp('.audit/served-failure-');
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  try {
    for (const provider of keyed) await store.configure(provider, secret);
    await run(store);
  } finally { for (const provider of keyed) store.disconnect(provider); secret.fill(0); await rm(dir, { recursive: true }); }
}

function setup(provider: ProviderAdapter['id'], servedPrice?: ModelPrice, others: Record<string, ModelPrice> = {}) {
  const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000,
    costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100,
    models: { [requested]: { provider, max_tokens: 64, temperature: 0, thinking: { mode: 'disabled' } } } };
  const prices: Prices = { date: '2026-11-16', currency: 'USD', models: { [requested]: flat(1, 2), ...(servedPrice ? { [served]: servedPrice } : {}), ...others } };
  const paused: string[] = []; let now = 0;
  const service = new TokenService(policy, prices, { ids: () => ['a'], pause: id => { paused.push(id); }, pauseAll: () => {} }, fixedRatioTokenCounter(1000), () => now);
  return { service, paused, advance: (ms: number) => { now += ms; } };
}
const failing = (provider: ProviderAdapter['id'], error: () => unknown): ProviderAdapter => ({ id: provider, model: requested, complete: async () => { throw error(); } });
const run = (service: TokenService, adapter: ProviderAdapter) => caught(service.execute(new ProviderProxy(), adapter, 'Question', signal(), 'a', 'System'));
const money = (service: TokenService) => service.snapshot().rows.map(row => [row.scope, row.used, row.estimated, row.reserved, row.costAccountedUsd, row.costUnmeasuredUsd, row.costReservedUsd]);

test('F-01 every adapter names the model a response gave when its usage cannot be parsed, and never a value', () => withKeys(async store => {
  const stream = (response: object) => async () => new Response(['{"type":"response.output_text.delta","delta":"OK"}', JSON.stringify({ type: 'response.completed', response })].map(data => `data: ${data}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  const output = [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }];
  const choices = [{ message: { content: 'OK' }, finish_reason: 'stop' }];
  const candidates = [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }];
  // Each builds its adapter over one synthetic response; `model` is what the response says served it.
  const cases: Record<string, (model: unknown, usage: unknown) => Promise<Completion>> = {
    deepseek: (model, usage) => new DeepSeekAdapter(requested, store, async () => Response.json({ id: 'x', model, choices, ...(usage === undefined ? {} : { usage }) })).complete('Hi', signal(), options),
    gemini: (model, usage) => new GeminiAdapter(requested, store, async () => Response.json({ modelVersion: model, candidates, ...(usage === undefined ? {} : { usageMetadata: usage }) })).complete('Hi', signal(), options),
    openai: (model, usage) => new OpenAIAdapter(requested, store, async () => Response.json({ model, output, ...(usage === undefined ? {} : { usage }) })).complete('Hi', signal(), options),
    'openai streamed': (model, usage) => new OpenAIAdapter(requested, store, stream({ model, ...(usage === undefined ? {} : { usage }) })).complete('Hi', signal(), { ...options, onText: () => {} }),
  };
  const strange = { tokens_in: 24, tokens_out: marker, detail: { bucket: marker } };
  for (const [name, call] of Object.entries(cases)) {
    for (const usage of [strange, undefined]) {
      const failure = await caught(call(name === 'gemini' ? `models/${served}` : served, usage));
      assert.ok(ProviderFailure.is(failure), `${name}: ${String(failure)}`);
      assert.equal(failure.code, 'upstream', name);
      assert.equal(failure.servedModel, served, `${name}: the response named its model before its usage failed${usage ? '' : ' to appear'}`);
      assert.ok(failure.fields?.length, `${name}: the field names still come with it`);
      assert.doesNotMatch(JSON.stringify([failure.fields, failure.servedModel, failure.message]), new RegExp(marker), `${name}: a value is never carried`);
    }
    // A model the response does not name in a usable form is not guessed, and is never the requested one.
    for (const unusable of [undefined, 7, 'not a model id', `${'m'.repeat(101)}`]) {
      const failure = await caught(call(unusable, strange));
      assert.ok(ProviderFailure.is(failure), name); assert.equal(failure.servedModel, undefined, `${name}: ${String(unusable)}`);
    }
  }
  // A shape that breaks the reader itself, after the response named its model, is still an upstream failure that names it.
  const broken = await caught(new GeminiAdapter(requested, store, async () => Response.json({ modelVersion: served, candidates: [{ content: { parts: [null] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })).complete('Hi', signal(), options));
  assert.ok(ProviderFailure.is(broken)); assert.deepEqual([broken.code, broken.servedModel], ['upstream', served]);
  // A status refusal carries no response, so it names nobody; the error body is still never read.
  const refused = await caught(new DeepSeekAdapter(requested, store, async () => new Response(JSON.stringify({ model: served, error: marker }), { status: 401 })).complete('Hi', signal(), options));
  assert.ok(ProviderFailure.is(refused)); assert.deepEqual([refused.code, refused.servedModel, refused.fields], ['unauthorized', undefined, undefined]);
}));

test('F-01 servedBy keeps the first name a failure was given and adds one only where none was', () => {
  const bare = new ProviderFailure('upstream', ['usage.x']);
  const named = bare.servedBy(served);
  assert.ok(ProviderFailure.is(named)); assert.deepEqual([named.code, named.fields, named.servedModel], ['upstream', ['usage.x'], served]);
  assert.equal(named.servedBy('synthetic-other').servedModel, served, 'the adapter that read the response decides');
  assert.equal(bare.servedBy(undefined), bare);
  assert.equal(servedModelId('gemini', `models/${served}`), served);
  assert.equal(servedModelId('deepseek', `models/${served}`), undefined, 'only an identifier normalizeModelId accepts');
});

test('F-01 an unparsed response names its served model in the reservation, the receipts and manual reconciliation', async () => {
  for (const provider of keyed) {
    const { service, paused, advance } = setup(provider);
    const before = eventBus().snapshot().cursor;
    const error = await run(service, failing(provider, () => new ProviderFailure('upstream', ['usage.tokens_in'], served)));
    assert.ok(ProviderFailure.is(error), provider);
    const [reservation] = service.snapshot().reservations;
    assert.deepEqual([reservation.status, reservation.model, reservation.servedModel], ['unverifiable', requested, served], provider);
    const [call] = service.receiptSnapshot().receipts;
    assert.equal(call.kind, 'call');
    if (call.kind === 'call') assert.deepEqual([call.requestedModel, call.servedModel, call.verdict, call.outcome, call.reportedUsage, call.costUsd, call.servedPriceVersionId], [requested, served, 'unverifiable', 'upstream', null, null, null], provider);
    const events = eventBus().snapshot(before).events;
    assert.deepEqual(events.filter(event => event.type === 'provider.rerouted').map(event => event.payload), [`Request for ${requested} was served by ${served}.`], `${provider}: the divergence is on record, once`);
    assert.ok(events.some(event => event.type === 'provider.usage_unparsed'), provider);
    assert.deepEqual(paused, ['a'], provider);
    advance(100);
    const [expiry] = service.receiptSnapshot().receipts;
    assert.deepEqual([expiry.kind, expiry.requestedModel, expiry.servedModel], ['expiry', requested, served], provider);
    // Naming who answered is not reported usage: this stays an ordinary estimate, which does not hold its agent (R5-Q2).
    assert.deepEqual(service.resume(), ['a'], provider);
    service.reconcileReservation(reservation.id, 10, 5, 0.01);
    const [manual] = service.receiptSnapshot().receipts;
    assert.equal(manual.kind, 'manual');
    if (manual.kind === 'manual') assert.deepEqual([manual.servedModel, manual.journal?.models], [served, [requested, served]], `${provider}: the reconciled interval covers the model that answered`);
    // The reconciled interval protects the served model too: a validity that would reprice that period is refused.
    assert.throws(() => service.catalog.append({ model: served, price: { ...flat(3, 6), provider, sourceUrl: 'https://example.invalid/synthetic' } }), /already reconciled/, provider);
  }
});

test('F-01 naming the served model never changes what an expired reservation is charged', async () => {
  // The served model unpriced, then priced below, at and above the requested one, beside a third model dearer than
  // both: the floor stays the dearest eligible candidate, because one unreadable response is not the invoice.
  const dearest: Record<string, ModelPrice> = { 'synthetic-dearest': { ...flat(20, 40), provider: 'deepseek' } };
  for (const servedPrice of [undefined, flat(0.5, 1), flat(1, 2), flat(9, 18)]) {
    const figures = [];
    for (const name of [served, undefined]) {
      const { service, advance } = setup('deepseek', servedPrice && { ...servedPrice, provider: 'deepseek' }, dearest);
      await run(service, failing('deepseek', () => new ProviderFailure('upstream', ['usage.tokens_in'], name)));
      const held = money(service); advance(100);
      figures.push([held, money(service)]);
    }
    assert.deepEqual(figures[0], figures[1], `served price ${JSON.stringify(servedPrice?.peak ?? null)}`);
    const [[held], [charged]] = figures[0];
    assert.ok(Number(charged[4]) > 0 && charged[4] === charged[5], 'charged, and all of it unmeasured');
    // Twenty times the requested rate in both directions, so twenty times the hold: the third model's price, not the named one's.
    assert.ok(Math.abs(Number(charged[4]) - 20 * Number(held[6])) < 1e-12, `charged ${charged[4]} for a hold of ${held[6]}`);
  }
});

test('F-01 the served model is named before usage is checked, and a same-model answer records no divergence', async () => {
  const { service } = setup('gemini');
  const adapter = (completion: Completion): ProviderAdapter => ({ id: 'gemini', model: requested, complete: async () => completion });
  const before = eventBus().snapshot().cursor;
  const missing = await run(service, adapter({ text: 'Answer', billingModel: served }));
  assert.ok(missing instanceof TokenFailure); assert.match(missing.message, /usage missing/);
  const [first] = service.receiptSnapshot().receipts;
  if (first.kind === 'call') assert.deepEqual([first.servedModel, first.verdict, first.outcome], [served, 'unverifiable', 'usage_unavailable']);
  else assert.fail('a call receipt was expected');
  assert.equal(eventBus().snapshot(before).events.filter(event => event.type === 'provider.rerouted').length, 1);

  const same = setup('gemini');
  const cursor = eventBus().snapshot().cursor;
  const invalid = await run(same.service, adapter({ text: 'Answer', billingModel: requested, usage: { prompt: 10, completion: 5, total: 99 } }));
  assert.ok(invalid instanceof TokenFailure); assert.match(invalid.message, /usage invalid/);
  const [second] = same.service.receiptSnapshot().receipts;
  assert.equal(second.servedModel, requested);
  assert.equal(same.service.snapshot().reservations[0].servedModel, requested);
  assert.equal(eventBus().snapshot(cursor).events.filter(event => event.type === 'provider.rerouted').length, 0, 'served as requested: nothing diverged');

  // A failure that proves no generation releases the hold and names nobody, whatever it carries.
  const released = setup('gemini');
  await run(released.service, failing('gemini', () => new ProviderFailure('rate_limited')));
  const [third] = released.service.receiptSnapshot().receipts;
  assert.deepEqual([third.servedModel, released.service.snapshot().reservations.length], [null, 0]);
});
