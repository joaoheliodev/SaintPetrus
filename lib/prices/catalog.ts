import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isModelProvider, normalizeModelId } from '../providers/model-id';
import type { Prices } from '../tokens/config';
import { validateModelPrice, type ModelPrice } from '../tokens/pricing';

export class PriceCatalogError extends Error {}

type CapturedPrice = { id: string; price: ModelPrice };
type Version = CapturedPrice & { state: 'current' | 'past' | 'future' };
type CatalogSnapshot = { at: number; models: { model: string; current?: CapturedPrice; versions: Version[] }[] };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const starts = (price: ModelPrice) => instant(price.effectiveAt);
const ends = (price: ModelPrice) => price.expiresAt === undefined ? Infinity : instant(price.expiresAt);
const overlaps = (from: number, to: number, otherFrom: number, otherTo: number) => from < otherTo && otherFrom < to;
const canonical = (model: string, price?: ModelPrice) => {
  try { return normalizeModelId(price?.provider ?? 'mock', model) === model; }
  catch { return false; }
};
const initial = (document: Prices, model: string) => Object.hasOwn(document.models, model) ? document.models[model] : undefined;
const versions = (document: Prices, model: string) => {
  const first = initial(document, model);
  const later = document.versions && Object.hasOwn(document.versions, model) ? document.versions[model] : [];
  return [...(first ? [first] : []), ...later];
};
const captured = (model: string, price: ModelPrice): CapturedPrice => ({ id: JSON.stringify([model, price.effectiveAt]), price: structuredClone(price) });

export function validatePriceCatalog(document: Prices): void {
  if (!record(document) || !record(document.models) || (document.versions !== undefined && !record(document.versions))) {
    throw new PriceCatalogError('Invalid price catalog.');
  }
  for (const [model, price] of Object.entries(document.models)) {
    if (!validateModelPrice(price) || !canonical(model, price)) throw new PriceCatalogError('Invalid model price.');
  }
  for (const [model, entries] of Object.entries(document.versions ?? {})) {
    if (!initial(document, model) || !Array.isArray(entries) || !entries.every(price => validateModelPrice(price)
      && isModelProvider(price.provider) && price.sourceUrl !== undefined && canonical(model, price))) {
      throw new PriceCatalogError('Invalid price history.');
    }
  }
  for (const model of Object.keys(document.models)) {
    const ordered = versions(document, model).sort((left, right) => starts(left) - starts(right));
    for (let index = 1; index < ordered.length; index += 1) {
      if (starts(ordered[index]) < ends(ordered[index - 1])) throw new PriceCatalogError('Price validities overlap.');
    }
  }
  if (document.reconciled !== undefined && (!Array.isArray(document.reconciled) || !document.reconciled.every(entry => record(entry)
    && Array.isArray(entry.models) && entry.models.length > 0
    && entry.models.every(model => typeof model === 'string' && canonical(model))
    && Number.isSafeInteger(entry.from) && Number.isSafeInteger(entry.to) && entry.from < entry.to))) {
    throw new PriceCatalogError('Invalid price reconciliation history.');
  }
}

export class PriceCatalog {
  private document: Prices;

  constructor(document: Prices, private readonly file?: string, private readonly now: () => number = Date.now) {
    validatePriceCatalog(document);
    this.document = document;
  }

  capture(at: number): Record<string, CapturedPrice> {
    if (!Number.isFinite(at)) throw new PriceCatalogError('Invalid price timestamp.');
    return Object.fromEntries(Object.keys(this.document.models).flatMap(model => {
      const price = versions(this.document, model).find(entry => starts(entry) <= at && at < ends(entry));
      return price ? [[model, captured(model, price)]] : [];
    }));
  }

  snapshot(): CatalogSnapshot {
    const at = this.now();
    if (!Number.isFinite(at)) throw new PriceCatalogError('Invalid price timestamp.');
    return { at, models: Object.keys(this.document.models).sort().map(model => {
      const history: Version[] = versions(this.document, model).sort((left, right) => starts(right) - starts(left)).map(price => ({
        ...captured(model, price), state: starts(price) > at ? 'future' : ends(price) <= at ? 'past' : 'current',
      }));
      const current = history.find(entry => entry.state === 'current');
      return { model, ...(current ? { current: { id: current.id, price: structuredClone(current.price) } } : {}), versions: history };
    }) };
  }

  append(input: unknown): CatalogSnapshot {
    if (!record(input) || Object.keys(input).length !== 2 || typeof input.model !== 'string' || !validateModelPrice(input.price)
      || !isModelProvider(input.price.provider) || input.price.sourceUrl === undefined || !canonical(input.model, input.price)) {
      throw new PriceCatalogError('Invalid price validity: model, provider, source URL and verified dates are required.');
    }
    const { model, price } = input;
    const next = structuredClone(this.document);
    const predecessor = versions(next, model).find(entry => entry.expiresAt === undefined && starts(entry) < starts(price));
    const changedUntil = predecessor ? Infinity : ends(price);
    if ((next.reconciled ?? []).some(entry => entry.models.includes(model) && overlaps(starts(price), changedUntil, entry.from, entry.to))) {
      throw new PriceCatalogError('Price validity would change an already reconciled period.');
    }
    // Only the previously unknown boundary changes; captured reservations own independent copies.
    if (predecessor) predecessor.expiresAt = price.effectiveAt;
    if (initial(next, model)) {
      const previous = next.versions && Object.hasOwn(next.versions, model) ? next.versions[model] : [];
      next.versions = { ...next.versions, [model]: [...previous, structuredClone(price)] };
    } else {
      next.models = { ...next.models, [model]: structuredClone(price) };
    }
    this.persist(next);
    return this.snapshot();
  }

  recordReconciliation(models: string[], from: number, to: number): void {
    const next = { ...this.document, reconciled: [...(this.document.reconciled ?? []), { models: [...new Set(models)], from, to }] };
    this.persist(next);
  }

  private persist(next: Prices): void {
    validatePriceCatalog(next);
    if (this.file) {
      const temporary = join(dirname(this.file), `.${basename(this.file)}.${randomUUID()}.tmp`);
      let descriptor: number | undefined;
      let owned = false;
      try {
        descriptor = openSync(temporary, 'wx', 0o600);
        owned = true;
        writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporary, this.file);
      } catch {
        if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve the original persistence failure. */ } }
        if (owned) { try { unlinkSync(temporary); } catch { /* The failed attempt may only clean its own temporary file. */ } }
        throw new PriceCatalogError('Price catalog could not be persisted.');
      }
    }
    Object.assign(this.document, next);
  }
}
