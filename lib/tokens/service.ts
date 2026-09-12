import { observeArtifact, previewEnabled } from '../preview/store';
import { eventBus } from '../events/bus';
import { createHash, randomUUID } from 'node:crypto';
import { heuristicTokenCounter, type TokenCounter } from '../core/token-estimate';
import { ProviderFailure, type ProviderAdapter, type ProviderFailureCode, type RequestOptions, type Usage } from '../providers/adapter';
import type { ProviderProxy } from '../providers/proxy';
import { redactText } from '../security/redact';
import { reproducible, validateConfig, validCostLimit, validLimit, type TokenPolicy, type Prices } from './config';
import { preflightCostUsd, reconciledCostUsd, worstCasePeakCostUsd } from './pricing';
import { verificationThinking } from '../providers/thinking-policy';
export class TokenFailure extends Error {}
type Totals = { prompt: number; completion: number; total: number };
type Scope = 'global' | 'agent' | 'model' | 'session';
export type BillingVerdict = 'unbilled' | 'billed' | 'unverifiable';
type Row = { scope: Scope; id: string; limit: number; used: number; reserved: number; estimated: number; conservativeCachedInput: number; actual: Totals; mock: Totals; costLimitUsd: number; costReservedUsd: number; costEstimateUsd: number; costEstimatedUsd: number; saved: number; unverifiable: number };
type Reservation = { id: string; agent: string; model: string; tokens: number; costUsd: number; inputTokens: number; maxOutputTokens: number; createdAt: number; expiresAt: number | null; status: 'inflight' | 'unverifiable' | 'estimated'; rows: Row[] };
type Hooks = { pause: (id: string) => void; pauseAll: () => void; ids: () => string[]; role?: (id: string) => string };
const failureVerdicts = {
  unconfigured: 'unbilled', disabled: 'unverifiable', invalid_request: 'unbilled', invalid_model_format: 'unverifiable', model_not_allowlisted: 'unverifiable', unauthorized: 'unbilled', insufficient_balance: 'unbilled', not_found: 'unbilled', rate_limited: 'unbilled', upstream: 'unverifiable', timeout: 'unverifiable', cancelled: 'unverifiable', busy: 'unbilled',
} satisfies Record<ProviderFailureCode, Exclude<BillingVerdict, 'billed'>>;
export function failureBillingVerdict(error: unknown): Exclude<BillingVerdict, 'billed'> { return error instanceof ProviderFailure ? failureVerdicts[error.code] : 'unverifiable'; }
const zero = (): Totals => ({ prompt: 0, completion: 0, total: 0 });
const money = (value: number) => Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
export class TokenService {
  readonly sessionId = randomUUID();
  private rows = new Map<string, Row>();
  private stopped = false;
  private paused = new Set<string>();
  private agentModels = new Map<string, Set<string>>();
  private cache = new Map<string, { expires: number; text: string; usage: Usage; approximate: boolean; billingModel: string }>();
  private reservations = new Map<string, Reservation>();
  private reservationSequence = 0;
  constructor(readonly policy: TokenPolicy, readonly prices: Prices, private readonly hooks: Hooks, private readonly counter: TokenCounter = heuristicTokenCounter, private readonly now = Date.now) { validateConfig(policy, prices); }
  private row(scope: Scope, id: string, limit: number, costLimitUsd: number) {
    const key = JSON.stringify([scope, id]); let row = this.rows.get(key);
    if (!row) { row = { scope, id, limit, used: 0, reserved: 0, estimated: 0, conservativeCachedInput: 0, actual: zero(), mock: zero(), costLimitUsd, costReservedUsd: 0, costEstimateUsd: 0, costEstimatedUsd: 0, saved: 0, unverifiable: 0 }; this.rows.set(key, row); }
    return row;
  }
  private scopes(agent: string, model: string) { return [this.row('global', 'all', this.policy.global, this.policy.costLimitsUsd.global), this.row('agent', agent, this.policy.perAgent, this.policy.costLimitsUsd.perAgent), this.row('model', model, this.policy.perModel, this.policy.costLimitsUsd.perModel), this.row('session', this.sessionId, this.policy.perSession, this.policy.costLimitsUsd.perSession)]; }
  private blocked(row: Row) { return row.used + row.reserved >= row.limit || row.costEstimateUsd + row.costReservedUsd >= row.costLimitUsd; }
  private warning(row: Row) { return row.used + row.reserved >= row.limit * .8 || row.costEstimateUsd + row.costReservedUsd >= row.costLimitUsd * .8; }
  private pause(id: string) { this.paused.add(id); this.hooks.pause(id); }
  private expireReservations() {
    const now = this.now();
    for (const reservation of this.reservations.values()) {
      if (reservation.status !== 'unverifiable' || reservation.expiresAt === null || reservation.expiresAt > now) continue;
      // Convert at the dearer of what was held and what the dearest known model would have cost:
      // the request may have been served, and billed, by a model other than the one asked for.
      const conservative = Math.max(reservation.costUsd, worstCasePeakCostUsd(this.prices.models, reservation.inputTokens, reservation.maxOutputTokens, reservation.createdAt));
      for (const row of reservation.rows) {
        row.reserved -= reservation.tokens;
        row.used += reservation.tokens;
        row.estimated += reservation.tokens;
        row.costReservedUsd = money(row.costReservedUsd - reservation.costUsd);
        row.costEstimateUsd = money(row.costEstimateUsd + conservative);
        row.costEstimatedUsd = money(row.costEstimatedUsd + conservative);
        row.unverifiable--;
      }
      // The converted figure replaces the held one so a later manual reconciliation subtracts what
      // was actually charged to the budget, not the understated reservation.
      reservation.costUsd = conservative;
      reservation.status = 'estimated';
    }
  }
  kill() { this.stopped = true; this.hooks.ids().forEach(id => this.paused.add(id)); this.hooks.pauseAll(); }
  isStopped() { return this.stopped; }
  resume(agent?: string) {
    this.expireReservations();
    if ([...this.rows.values()].some(row => row.unverifiable > 0)) throw new TokenFailure('Usage unverifiable; restart only after checking provider billing.');
    if (!agent) this.stopped = false;
    for (const id of agent ? [agent] : this.hooks.ids()) {
      const blocked = [...this.rows.values()].some(row => (row.scope === 'global' || row.scope === 'session' || (row.scope === 'agent' && row.id === id) || (row.scope === 'model' && this.agentModels.get(id)?.has(row.id))) && this.blocked(row));
      if (!blocked) this.paused.delete(id);
    }
  }
  reconcileReservation(id: string, prompt: unknown, completion: unknown, costUsd: unknown) {
    this.expireReservations();
    if (!validLimit(prompt) || !validLimit(completion) || !validLimit(prompt + completion) || !validCostLimit(costUsd)) throw new TokenFailure('Invalid reconciliation usage.');
    const reservation = this.reservations.get(id);
    if (!reservation || reservation.status !== 'estimated') throw new TokenFailure('Unknown estimated reservation.');
    const total = prompt + completion;
    for (const row of reservation.rows) {
      row.used += total - reservation.tokens;
      row.estimated -= reservation.tokens;
      row.costEstimateUsd = money(row.costEstimateUsd + costUsd - reservation.costUsd);
      row.costEstimatedUsd = money(row.costEstimatedUsd - reservation.costUsd);
      row.actual.prompt += prompt; row.actual.completion += completion; row.actual.total += total;
    }
    this.reservations.delete(id);
    if (reservation.rows.some(row => this.blocked(row))) this.pause(reservation.agent);
  }
  private validScope(scope: string): scope is Scope { return ['global','agent','model','session'].includes(scope); }
  private validScopeId(scope: Scope, id: string) { return !((scope === 'agent' && !this.hooks.ids().includes(id)) || (scope === 'model' && !Object.hasOwn(this.policy.models, id)) || (scope === 'session' && id !== this.sessionId) || (scope === 'global' && id !== 'all')); }
  setLimit(scope: string, id: string, limit: unknown) {
    if (!validLimit(limit) || !this.validScope(scope)) throw new TokenFailure('Invalid limit.');
    if (!this.validScopeId(scope, id)) throw new TokenFailure('Unknown budget scope.');
    const defaults = { global: this.policy.costLimitsUsd.global, agent: this.policy.costLimitsUsd.perAgent, model: this.policy.costLimitsUsd.perModel, session: this.policy.costLimitsUsd.perSession };
    this.row(scope, id, limit, defaults[scope]).limit = limit;
  }
  setCostLimit(scope: string, id: string, limit: unknown) {
    if (!validCostLimit(limit) || !this.validScope(scope)) throw new TokenFailure('Invalid cost limit.');
    if (!this.validScopeId(scope, id)) throw new TokenFailure('Unknown budget scope.');
    const defaults = { global: this.policy.global, agent: this.policy.perAgent, model: this.policy.perModel, session: this.policy.perSession };
    this.row(scope, id, defaults[scope], limit).costLimitUsd = limit;
  }
  snapshot() {
    this.expireReservations();
    this.scopes(this.hooks.ids()[0] ?? 'none', Object.keys(this.policy.models)[0] ?? 'none');
    for (const id of this.hooks.ids()) this.row('agent', id, this.policy.perAgent, this.policy.costLimitsUsd.perAgent);
    for (const id of Object.keys(this.policy.models)) this.row('model', id, this.policy.perModel, this.policy.costLimitsUsd.perModel);
    const reservations = [...this.reservations.values()].filter(item => item.status !== 'inflight').map(item => ({ id: item.id, agent: item.agent, model: item.model, tokens: item.tokens, costUsd: item.costUsd, createdAt: item.createdAt, expiresAt: item.expiresAt, status: item.status }));
    return { sessionId: this.sessionId, stopped: this.stopped, paused: [...this.paused], priceDate: this.prices.date, prices: this.prices.models, models: this.policy.models, cacheTtlMs: this.policy.cacheTtlMs, reservationTtlMs: this.policy.reservationTtlMs, reservations, rows: [...this.rows.values()].map(row => ({ ...structuredClone(row), state: this.blocked(row) ? 'stopped' : this.warning(row) ? 'warning' : 'available' })) };
  }
  private refuse(agent: string, message: string): never {
    eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'budget.refused', severity: 'warning', payload: message });
    throw new TokenFailure(message);
  }
  async execute(proxy: ProviderProxy, adapter: ProviderAdapter, input: unknown, signal: AbortSignal, agent: string, systemPrompt: string, messages?: RequestOptions['messages'], verification = false) {
    this.expireReservations();
    if (!this.hooks.ids().includes(agent)) this.refuse(agent, 'Unknown agent.');
    const model = Object.hasOwn(this.policy.models, adapter.model) ? this.policy.models[adapter.model] : undefined;
    if (!model || model.provider !== adapter.id) this.refuse(agent, 'Model not allowlisted. Edit local token policy and prices.');
    if (typeof input !== 'string' || !input.trim() || input.length > 2000) this.refuse(agent, 'Invalid input.');
    if (this.stopped || this.paused.has(agent)) { this.pause(agent); this.refuse(agent, 'Agent paused.'); }
    const price = Object.hasOwn(this.prices.models, adapter.model) ? this.prices.models[adapter.model] : undefined;
    if (!price) this.refuse(agent, 'Model price missing. Add an operator-verified price before execution.');
    const models = this.agentModels.get(agent) ?? new Set<string>(); models.add(adapter.model); this.agentModels.set(agent, models);
    const rows = this.scopes(agent, adapter.model);
    if (rows.some(row => this.blocked(row))) { this.pause(agent); this.refuse(agent, 'Token or monetary budget exhausted.'); }
    const requestedThinking = verification ? verificationThinking(model.provider, model.thinking) : model.thinking;
    const options: RequestOptions = { systemPrompt: redactText(systemPrompt), messages: (messages ?? [{ role: 'user', content: input }]).map(m => ({ role: m.role, content: redactText(m.content) })), temperature: model.temperature, maxTokens: model.max_tokens, ...(requestedThinking ? { thinking: requestedThinking } : {}) };
    // The thinking state is part of the key, so a cached answer can never be served to a request
    // that would have been allowed to reason.
    const payload = JSON.stringify({ provider: adapter.id, model: adapter.model, systemPrompt: options.systemPrompt, messages: options.messages, temperature: options.temperature, maxTokens: options.maxTokens, thinking: options.thinking ?? null });
    const hash = createHash('sha256').update(payload).digest('hex');
    const createdAt = this.now();
    const inputEstimate = this.counter.count(JSON.stringify({ systemPrompt: options.systemPrompt, messages: options.messages }));
    let reservedCostUsd: number;
    try { reservedCostUsd = preflightCostUsd(price, inputEstimate, options.maxTokens, createdAt); }
    catch { this.refuse(agent, 'Model price unavailable or not yet effective.'); }
    const reusable = reproducible(model, requestedThinking);
    const cached = !verification && reusable ? this.cache.get(hash) : undefined;
    if (cached && cached.expires > this.now()) { rows.forEach(row => { row.saved += cached.usage.total; }); return { provider: adapter.id, model: adapter.model, billingModel: cached.billingModel, mocked: adapter.id === 'mock', text: redactText(cached.text), latencyMs: 0, cached: true, usage: cached.usage, approximate: cached.approximate }; }
    const reservedTokens = inputEstimate + options.maxTokens;
    if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1 || rows.some(row => row.used + row.reserved + reservedTokens > row.limit || row.costEstimateUsd + row.costReservedUsd + reservedCostUsd > row.costLimitUsd)) { this.pause(agent); this.refuse(agent, 'Preflight reservation exceeds token or monetary budget.'); }
    // Synchronous reservation across all four scopes happens before any provider I/O.
    rows.forEach(row => { row.reserved += reservedTokens; row.costReservedUsd = money(row.costReservedUsd + reservedCostUsd); });
    const reservation: Reservation = { id: `reservation-${++this.reservationSequence}`, agent, model: adapter.model, tokens: reservedTokens, costUsd: reservedCostUsd, inputTokens: inputEstimate, maxOutputTokens: options.maxTokens, createdAt, expiresAt: null, status: 'inflight', rows };
    this.reservations.set(reservation.id, reservation);
    if (previewEnabled()) options.onText = text => observeArtifact(agent, this.hooks.role?.(agent) ?? agent, text);
    let verdict: BillingVerdict = 'unverifiable';
    try {
      const result = await proxy.execute(adapter, input, signal, options);
      const approximate = adapter.id === 'mock';
      const usage = approximate ? { prompt: inputEstimate, completion: this.counter.count(result.text), total: 0 } : result.usage;
      if (!usage) this.refuse(agent, 'Provider usage missing.');
      if (approximate) usage.total = usage.prompt + usage.completion;
      const split = usage.inputBreakdown;
      if (![usage.prompt, usage.completion, usage.total].every(validLimit) || usage.total !== usage.prompt + usage.completion || (split !== undefined && (![split.cacheHit, split.cacheMiss].every(validLimit) || split.cacheHit + split.cacheMiss !== usage.prompt))) this.refuse(agent, 'Provider usage invalid.');
      const responseAt = this.now();
      // The invoice names the model that answered, not the one that was asked for: providers reroute
      // and bill at the served model's rate. A served model with no operator-verified price cannot be
      // reconciled, and a call that already happened must not be released as if it were free.
      const billingModel = result.billingModel ?? adapter.model;
      if (billingModel !== adapter.model) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'provider.rerouted', severity: 'warning', payload: `Request for ${adapter.model} was served by ${billingModel}; reconciled at the served model price.` });
      const billingPrice = Object.hasOwn(this.prices.models, billingModel) ? this.prices.models[billingModel] : undefined;
      if (!billingPrice) this.refuse(agent, 'Served model has no verified price; usage stays unverifiable until reconciled manually.');
      const actualCostUsd = reconciledCostUsd(billingPrice, usage, createdAt, responseAt);
      for (const row of rows) {
        row.reserved -= reservedTokens; row.used += usage.total; row.costReservedUsd = money(row.costReservedUsd - reservedCostUsd); row.costEstimateUsd = money(row.costEstimateUsd + actualCostUsd);
        const totals = approximate ? row.mock : row.actual;
        totals.prompt += usage.prompt; totals.completion += usage.completion; totals.total += usage.total;
        row.conservativeCachedInput += usage.cachedPromptFullRate ?? 0;
      }
      this.reservations.delete(reservation.id);
      if (!result.outcome) observeArtifact(agent, this.hooks.role?.(agent) ?? agent, result.text);
      verdict = 'billed';
      if (!result.outcome) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'agent.message', payload: (approximate ? '[Mock] ' : '') + result.text, tokens: { prompt: usage.prompt, completion: usage.completion } });
      if (rows.some(row => this.warning(row))) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'budget.warning', severity: 'warning', payload: 'Token or monetary budget reached 80% or more.' });
      if (rows.some(row => this.blocked(row))) this.pause(agent);
      if (!result.outcome && !verification && reusable && this.policy.cacheTtlMs > 0) {
        for (const [key, entry] of this.cache) if (entry.expires <= this.now()) this.cache.delete(key);
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(hash, { expires: this.now() + this.policy.cacheTtlMs, text: result.text, usage: { ...usage }, approximate, billingModel });
      }
      return { ...result, usage, approximate, cached: false };
    } catch (error) {
      eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'error', severity: 'error', payload: 'Provider execution failed.' });
      // Names only. A shape we cannot parse pauses the agent, and the names are what makes the next
      // attempt a correction rather than a guess.
      if (error instanceof ProviderFailure && error.fields?.length) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'provider.usage_unparsed', severity: 'warning', payload: `Unrecognized provider usage shape. Field names received: ${error.fields.join(', ')}. No values recorded.` });
      // A proven rejection releases the reservation. Lost contact remains unverifiable because the
      // provider may have processed and billed a response that never reached us.
      verdict = adapter.id === 'mock' ? 'unbilled' : failureBillingVerdict(error);
      throw error;
    } finally {
      if (verdict !== 'billed') {
        if (verdict === 'unbilled') { rows.forEach(row => { row.reserved -= reservedTokens; row.costReservedUsd = money(row.costReservedUsd - reservedCostUsd); }); this.reservations.delete(reservation.id); }
        else {
          rows.forEach(row => { row.unverifiable++; });
          reservation.status = 'unverifiable'; reservation.expiresAt = this.now() + this.policy.reservationTtlMs;
          this.pause(agent);
        }
      }
    }
  }
}
