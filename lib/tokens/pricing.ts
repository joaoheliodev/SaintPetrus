export type RateBand = {
  inputCacheHitPerMillion: number;
  inputCacheMissPerMillion: number;
  outputPerMillion: number;
};

export type UtcPeakWindow = {
  weekdays: number[];
  startMinute: number;
  endMinute: number;
};

export type ModelPrice = {
  effectiveAt: string;
  verifiedAt: string;
  peakWindowsUtc: UtcPeakWindow[];
  offPeak: RateBand;
  peak: RateBand;
  note?: string;
};

export type PriceUsage = {
  prompt: number;
  completion: number;
  inputBreakdown?: { cacheHit: number; cacheMiss: number };
};

const DAY_MS = 86_400_000;
const MONEY_SCALE = 1_000_000_000_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const tokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validBand(value: unknown): value is RateBand {
  if (!record(value)) return false;
  return [value.inputCacheHitPerMillion, value.inputCacheMissPerMillion, value.outputPerMillion].every(finiteRate)
    && Number(value.inputCacheMissPerMillion) >= Number(value.inputCacheHitPerMillion);
}

function validWindow(value: unknown): value is UtcPeakWindow {
  if (!record(value) || !Array.isArray(value.weekdays) || !Number.isSafeInteger(value.startMinute) || !Number.isSafeInteger(value.endMinute)) return false;
  const weekdays = value.weekdays;
  return weekdays.length > 0 && new Set(weekdays).size === weekdays.length
    && weekdays.every(day => Number.isSafeInteger(day) && day >= 0 && day <= 6)
    && Number(value.startMinute) >= 0 && Number(value.endMinute) <= 1440 && Number(value.startMinute) < Number(value.endMinute);
}

export function validateModelPrice(value: unknown): value is ModelPrice {
  if (!record(value) || !validDate(value.effectiveAt) || !validDate(value.verifiedAt)
    || !Array.isArray(value.peakWindowsUtc) || !value.peakWindowsUtc.every(validWindow)
    || !validBand(value.offPeak) || !validBand(value.peak)) return false;
  if (value.peak.inputCacheHitPerMillion < value.offPeak.inputCacheHitPerMillion
    || value.peak.inputCacheMissPerMillion < value.offPeak.inputCacheMissPerMillion
    || value.peak.outputPerMillion < value.offPeak.outputPerMillion) return false;
  return value.note === undefined || typeof value.note === 'string';
}

function requireActivePrice(price: ModelPrice, at: number) {
  if (!validateModelPrice(price) || !Number.isFinite(at) || Date.parse(`${price.effectiveAt}T00:00:00.000Z`) > at) {
    throw new Error('Model price unavailable or not yet effective.');
  }
}

function roundCostUp(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid cost calculation.');
  return Math.ceil(value * MONEY_SCALE) / MONEY_SCALE;
}

function bandCost(band: RateBand, cacheHit: number, cacheMiss: number, completion: number) {
  if (![cacheHit, cacheMiss, completion].every(tokenCount)) throw new Error('Invalid usage for cost calculation.');
  return roundCostUp((cacheHit * band.inputCacheHitPerMillion + cacheMiss * band.inputCacheMissPerMillion + completion * band.outputPerMillion) / 1_000_000);
}

export function preflightCostUsd(price: ModelPrice, inputTokens: number, maximumOutputTokens: number, requestAt: number) {
  requireActivePrice(price, requestAt);
  // Preflight deliberately assumes the two independent worst cases: peak rates and no cache hits.
  return bandCost(price.peak, 0, inputTokens, maximumOutputTokens);
}

function intervalTouchesPeak(price: ModelPrice, requestAt: number, responseAt: number) {
  const start = Math.min(requestAt, responseAt);
  const end = Math.max(requestAt, responseAt);
  const firstDay = Math.floor(start / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(end / DAY_MS) * DAY_MS;
  for (let dayStart = firstDay; dayStart <= lastDay; dayStart += DAY_MS) {
    const weekday = new Date(dayStart).getUTCDay();
    for (const window of price.peakWindowsUtc) {
      if (!window.weekdays.includes(weekday)) continue;
      const windowStart = dayStart + window.startMinute * 60_000;
      const windowEnd = dayStart + window.endMinute * 60_000;
      // The start is inclusive and the end exclusive. Ending exactly as peak begins counts as
      // crossing the boundary, while starting exactly as peak ends does not.
      if (start < windowEnd && end >= windowStart) return true;
    }
  }
  return false;
}

export function reconciledCostUsd(price: ModelPrice, usage: PriceUsage, requestAt: number, responseAt: number) {
  requireActivePrice(price, requestAt);
  if (![requestAt, responseAt].every(Number.isFinite) || !tokenCount(usage.prompt) || !tokenCount(usage.completion)) throw new Error('Invalid usage for cost calculation.');
  const split = usage.inputBreakdown ?? { cacheHit: 0, cacheMiss: usage.prompt };
  if (!tokenCount(split.cacheHit) || !tokenCount(split.cacheMiss) || split.cacheHit + split.cacheMiss !== usage.prompt) throw new Error('Invalid cache usage for cost calculation.');
  return bandCost(intervalTouchesPeak(price, requestAt, responseAt) ? price.peak : price.offPeak, split.cacheHit, split.cacheMiss, usage.completion);
}
