import { observeArtifact, previewEnabled } from '../preview/store';
import { eventBus } from '../events/bus';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { heuristicTokenCounter, type TokenCounter } from '../core/token-estimate';
import { ProviderFailure, type ProviderAdapter, type ProviderFailureCode, type RequestOptions, type Usage } from '../providers/adapter';
import type { ProviderProxy } from '../providers/proxy';
import type { Dispatch } from '../providers/dispatch-ledger';
import { ReceiptJournal, type JournalInterval, type Receipt, type ReceiptUsage } from './receipts';
import type { AccountingJournal, JournalRecord } from './accounting-journal';
import { startPeriod, type DurableRow, type DurableState } from './accounting-state';
import { redactText } from '../security/redact';
import { reproducible, validateConfig, validCostLimit, validLimit, type TokenPolicy, type Prices } from './config';
import { intervalTouchesPeak, preflightCostUsd, reconciledCostUsd, worstCasePeakCostUsd } from './pricing';
import { verificationThinking } from '../providers/thinking-policy';
import { PriceCatalog } from '../prices/catalog';
export class TokenFailure extends Error {}
// The provider answered, so the call may have been billed, but the model it named has no captured tariff.
export class UnpricedServedModel extends Error {
  constructor(readonly requestedModel: string, readonly servedModel: string, readonly reservationId: string) { super(`Served model ${servedModel} has no verified price; usage stays unverifiable until reconciled manually.`); }
}
type Totals = { prompt: number; completion: number; total: number };
type Scope = 'global' | 'agent' | 'model' | 'session';
export type BillingVerdict = 'unbilled' | 'billed' | 'unverifiable';
// The USD ceiling reads costAccountedUsd; costUnmeasuredUsd is the part of it charged at reservation expiry and not yet confirmed.
type Row = { scope: Scope; id: string; limit: number; used: number; reserved: number; estimated: number; conservativeCachedInput: number; actual: Totals; mock: Totals; costLimitUsd: number; costReservedUsd: number; costAccountedUsd: number; costUnmeasuredUsd: number; saved: number; unverifiable: number };
type Reservation = { id: string; agent: string; model: string; provider: ProviderAdapter['id']; priceVersionId: string; priceVersions: ReturnType<PriceCatalog['capture']>; billingModel?: string; tokens: number; costUsd: number; inputTokens: number; maxOutputTokens: number; createdAt: number; expiresAt: number | null; status: 'inflight' | 'unverifiable' | 'estimated'; rows: Row[]; reported?: { prompt: number; completion: number; reasoning?: number } };
type Hooks = { pause: (id: string) => void; pauseAll: () => void; ids: () => string[]; role?: (id: string) => string };
type JournalWriter = { append(entry: JournalRecord): void };
// memory: nothing is journaled (tests, tools). recorded: every durable change is on disk. blocked: the journal could not be
// read or written, so real calls wait for the operator to start a new budget period; the mock still runs.
export type AccountingStatus = { journal: 'memory' | 'recorded' | 'blocked'; reason?: 'journal_unreadable' | 'journal_write_failed'; rejectedAs?: string; recoveredReservations?: number };
// disabled, invalid_model_format and model_not_allowlisted are local refusals that bill nothing, yet stay unverifiable: a test
// proves none can fire with a live reservation, and unbilled would silently free a hold if one ever fired after provider contact.
const failureVerdicts = {
  unconfigured: 'unbilled', disabled: 'unverifiable', invalid_request: 'unbilled', invalid_model_format: 'unverifiable', model_not_allowlisted: 'unverifiable', unauthorized: 'unbilled', insufficient_balance: 'unbilled', not_found: 'unbilled', rate_limited: 'unbilled', upstream: 'unverifiable', timeout: 'unverifiable', cancelled: 'unverifiable', busy: 'unbilled',
} satisfies Record<ProviderFailureCode, Exclude<BillingVerdict, 'billed'>>;
export function failureBillingVerdict(error: unknown): Exclude<BillingVerdict, 'billed'> { return ProviderFailure.is(error) ? failureVerdicts[error.code] : 'unverifiable'; }
const zero = (): Totals => ({ prompt: 0, completion: 0, total: 0 });
const money = (value: number) => Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
export class TokenService {
  readonly sessionId = randomUUID();
  readonly catalog: PriceCatalog;
  private rows = new Map<string, Row>();
  private stopped = false;
  private paused = new Set<string>();
  private agentModels = new Map<string, Set<string>>();
  private cache = new Map<string, { expires: number; text: string; usage: Usage; approximate: boolean; billingModel: string }>();
  private reservations = new Map<string, Reservation>();
  private reservationSequence = 0;
  private receipts = new ReceiptJournal();
  private journal?: JournalWriter;
  private written = '';
  private accounting: AccountingStatus = { journal: 'memory' };
  // Only limits changed in Budgets are journaled; the others keep following the policy file.
  private limitOverrides = new Set<string>();
  private costLimitOverrides = new Set<string>();
  // The mock's price is fictitious and its usage lives only as long as the process: kept apart so it never reaches the journal.
  private mockCost = new WeakMap<Row, number>();
  constructor(readonly policy: TokenPolicy, readonly prices: Prices, private readonly hooks: Hooks, private readonly counter: TokenCounter = heuristicTokenCounter, private readonly now = Date.now, catalog?: PriceCatalog) {
    validateConfig(policy, prices); this.catalog = catalog ?? new PriceCatalog(prices, undefined, now);
  }
  private row(scope: Scope, id: string, limit: number, costLimitUsd: number) {
    const key = JSON.stringify([scope, id]); let row = this.rows.get(key);
    if (!row) { row = { scope, id, limit, used: 0, reserved: 0, estimated: 0, conservativeCachedInput: 0, actual: zero(), mock: zero(), costLimitUsd, costReservedUsd: 0, costAccountedUsd: 0, costUnmeasuredUsd: 0, saved: 0, unverifiable: 0 }; this.rows.set(key, row); }
    return row;
  }
  private budgetRow(scope: Scope, id: string) {
    const defaults = { global: [this.policy.global, this.policy.costLimitsUsd.global], agent: [this.policy.perAgent, this.policy.costLimitsUsd.perAgent], model: [this.policy.perModel, this.policy.costLimitsUsd.perModel], session: [this.policy.perSession, this.policy.costLimitsUsd.perSession] } satisfies Record<Scope, [number, number]>;
    return this.row(scope, id, ...defaults[scope]);
  }
  private scopes(agent: string, model: string) { return [this.budgetRow('global', 'all'), this.budgetRow('agent', agent), this.budgetRow('model', model), this.budgetRow('session', this.sessionId)]; }
  private blocked(row: Row) { return row.used + row.reserved >= row.limit || row.costAccountedUsd + row.costReservedUsd >= row.costLimitUsd; }
  private warning(row: Row) { return row.used + row.reserved >= row.limit * .8 || row.costAccountedUsd + row.costReservedUsd >= row.costLimitUsd * .8; }
  // A reset can drop the agent from the graph mid-call; a failing projection hook must not undo settled accounting.
  private pause(id: string) { this.paused.add(id); try { this.hooks.pause(id); } catch { /* The recorded pause still applies. */ } this.persist(); }
  private durableState(): DurableState {
    const rows: DurableRow[] = [];
    for (const [key, row] of this.rows) {
      if (row.scope === 'session') continue;
      rows.push({ scope: row.scope, id: row.id, ...(this.limitOverrides.has(key) ? { limit: row.limit } : {}), ...(this.costLimitOverrides.has(key) ? { costLimitUsd: row.costLimitUsd } : {}),
        used: row.used - row.mock.total, estimated: row.estimated, conservativeCachedInput: row.conservativeCachedInput, actual: { ...row.actual }, costAccountedUsd: money(row.costAccountedUsd - (this.mockCost.get(row) ?? 0)), costUnmeasuredUsd: row.costUnmeasuredUsd });
    }
    const reservations = [...this.reservations.values()].filter(item => item.provider !== 'mock').map(item => ({ id: item.id, agent: item.agent, model: item.model, provider: item.provider, priceVersionId: item.priceVersionId, priceVersions: structuredClone(item.priceVersions),
      ...(item.billingModel ? { billingModel: item.billingModel } : {}), tokens: item.tokens, costUsd: item.costUsd, inputTokens: item.inputTokens, maxOutputTokens: item.maxOutputTokens, createdAt: item.createdAt, expiresAt: item.expiresAt, status: item.status, ...(item.reported ? { reported: { ...item.reported } } : {}) }));
    return { rows, reservations, paused: [...this.paused], stopped: this.stopped, agentModels: Object.fromEntries([...this.agentModels].map(([agent, models]) => [agent, [...models]])), reservationSequence: this.reservationSequence };
  }
  private writeFailed() { this.accounting = { ...this.accounting, journal: 'blocked', reason: 'journal_write_failed' }; }
  // Appends a checkpoint when the durable state changed. A failed write blocks real calls: from then on the file lags memory.
  private persist() {
    if (!this.journal) return true;
    const state = this.durableState(); const text = JSON.stringify(state);
    if (text === this.written) return true;
    try { this.journal.append({ v: 1, kind: 'state', at: this.now(), state }); this.written = text; return true; }
    catch { this.writeFailed(); return false; }
  }
  private receipt(draft: Parameters<ReceiptJournal['append']>[0]) {
    const receipt = this.receipts.append(draft);
    if (!this.journal || receipt.provider === 'mock') return;
    try { this.journal.append({ v: 1, kind: 'receipt', at: this.now(), receipt }); } catch { this.writeFailed(); }
  }
  // Rebuilds what the journal holds and journals from then on. A reservation still in flight when the process stopped may
  // have been served and billed: it returns unverifiable, with its agent paused, and is never released.
  restore(journal: AccountingJournal) {
    const opened = journal.open(new Date(this.now()));
    let state: DurableState | undefined; let blocked = opened.rejectedAs !== undefined; const receipts: Receipt[] = [];
    for (const entry of opened.records) {
      if (entry.kind === 'state') state = entry.state;
      else if (entry.kind === 'receipt') receipts.push(entry.receipt);
      else if (entry.reason === 'operator') { blocked = false; if (state) state = startPeriod(state); }
      else { blocked = true; state = undefined; }
    }
    this.accounting = blocked ? { journal: 'blocked', reason: 'journal_unreadable', ...(opened.rejectedAs ? { rejectedAs: basename(opened.rejectedAs) } : {}) } : { journal: 'recorded' };
    if (opened.rejectedAs) try { journal.append({ v: 1, kind: 'period', at: this.now(), reason: 'journal_unreadable' }); } catch { this.writeFailed(); }
    this.receipts.restore(receipts);
    // Attached only once rebuilt, so no partial state is ever checkpointed on the way.
    if (!state) { this.journal = journal; return this.accounting; }
    for (const item of state.rows) {
      const row = this.budgetRow(item.scope, item.id); const key = JSON.stringify([item.scope, item.id]);
      if (item.limit !== undefined) { row.limit = item.limit; this.limitOverrides.add(key); }
      if (item.costLimitUsd !== undefined) { row.costLimitUsd = item.costLimitUsd; this.costLimitOverrides.add(key); }
      Object.assign(row, { used: item.used, estimated: item.estimated, conservativeCachedInput: item.conservativeCachedInput, actual: { ...item.actual }, costAccountedUsd: item.costAccountedUsd, costUnmeasuredUsd: item.costUnmeasuredUsd });
    }
    this.stopped = state.stopped; this.reservationSequence = state.reservationSequence;
    for (const [agent, models] of Object.entries(state.agentModels)) this.agentModels.set(agent, new Set(models));
    for (const id of state.paused) this.pause(id);
    const lost: string[] = [];
    for (const item of state.reservations) {
      const rows = [this.budgetRow('global', 'all'), this.budgetRow('agent', item.agent), this.budgetRow('model', item.model)];
      const reservation: Reservation = { ...structuredClone(item), rows };
      if (reservation.status === 'inflight') { reservation.status = 'unverifiable'; reservation.expiresAt = this.now() + this.policy.reservationTtlMs; lost.push(item.agent); }
      if (reservation.status === 'unverifiable') rows.forEach(row => { row.reserved += reservation.tokens; row.costReservedUsd = money(row.costReservedUsd + reservation.costUsd); row.unverifiable++; });
      this.reservations.set(reservation.id, reservation);
    }
    this.written = JSON.stringify(state);
    if (lost.length) this.accounting = { ...this.accounting, recoveredReservations: lost.length };
    lost.forEach(agent => this.pause(agent));
    this.journal = journal; this.persist();
    return this.accounting;
  }
  accountingStatus() { return { ...this.accounting }; }
  // The operator's manual action after checking the invoice: counters restart, history stays in the journal.
  startBudgetPeriod() {
    this.expireReservations();
    if (this.reservations.size) throw new TokenFailure('Reconcile or wait for every open reservation before starting a new budget period.');
    if (this.journal) {
      try { this.journal.append({ v: 1, kind: 'period', at: this.now(), reason: 'operator' }); }
      catch { this.writeFailed(); throw new TokenFailure('The accounting journal could not be written; the budget period was not changed.'); }
    }
    for (const row of this.rows.values()) {
      if (row.scope === 'session') continue;
      Object.assign(row, { used: row.mock.total, estimated: 0, conservativeCachedInput: 0, actual: { prompt: 0, completion: 0, total: 0 }, costAccountedUsd: this.mockCost.get(row) ?? 0, costUnmeasuredUsd: 0 });
    }
    this.accounting = { journal: this.journal ? 'recorded' : 'memory' };
    this.written = ''; this.persist();
    return this.accountingStatus();
  }
  private expireReservations() {
    const now = this.now(); let converted = false;
    for (const reservation of this.reservations.values()) {
      if (reservation.status !== 'unverifiable' || reservation.expiresAt === null || reservation.expiresAt > now) continue;
      // Convert at the dearer of what was held and what the dearest eligible model would have cost:
      // the request may have been served, and billed, by a model other than the one asked for.
      const prices = Object.fromEntries(Object.entries(reservation.priceVersions).map(([model, version]) => [model, version.price]));
      // An unpriced served model answered with usage we know: every dimension converts at the larger of the estimate and
      // what was reported, and never below the requested model at peak with no cache hits (operator decision Q-10).
      const reported = reservation.reported;
      const input = Math.max(reservation.inputTokens, reported?.prompt ?? 0);
      const output = Math.max(reservation.maxOutputTokens, reported?.completion ?? 0, reported?.reasoning ?? 0);
      const tokens = Math.max(reservation.tokens, input + output);
      let requestedFloor = 0;
      try { requestedFloor = preflightCostUsd(reservation.priceVersions[reservation.model].price, input, output, reservation.createdAt); } catch { /* Covered by the candidates below. */ }
      const conservative = Math.max(reservation.costUsd, requestedFloor, worstCasePeakCostUsd(prices, input, output, reservation.createdAt, reservation.provider));
      for (const row of reservation.rows) {
        row.reserved -= reservation.tokens;
        row.used += tokens;
        row.estimated += tokens;
        row.costReservedUsd = money(row.costReservedUsd - reservation.costUsd);
        row.costAccountedUsd = money(row.costAccountedUsd + conservative);
        row.costUnmeasuredUsd = money(row.costUnmeasuredUsd + conservative);
        row.unverifiable--;
      }
      this.receipt({ kind: 'expiry', at: now, agent: reservation.agent, provider: reservation.provider, requestedModel: reservation.model, servedModel: reservation.billingModel ?? null, reservationId: reservation.id, tokens, heldCostUsd: reservation.costUsd, costUsd: conservative });
      // The converted figure replaces the held one so a later manual reconciliation subtracts what
      // was actually charged to the budget, not the understated reservation.
      reservation.costUsd = conservative; reservation.tokens = tokens;
      reservation.status = 'estimated'; converted = true;
    }
    if (converted) this.persist();
  }
  kill() { this.stopped = true; this.hooks.ids().forEach(id => this.paused.add(id)); this.hooks.pauseAll(); this.persist(); }
  isStopped() { return this.stopped; }
  // A call in flight, unverifiable usage or an estimate awaiting reconciliation still belongs to this agent.
  holdsReservation(agent: string) { this.expireReservations(); return [...this.reservations.values()].some(item => item.agent === agent); }
  resume(agent?: string): string[] {
    this.expireReservations();
    if ([...this.rows.values()].some(row => row.unverifiable > 0)) throw new TokenFailure('Usage unverifiable; restart only after checking provider billing.');
    if (!agent) this.stopped = false;
    const resumed: string[] = [];
    // An unpriced served model's estimate is only a floor: its agent waits for manual reconciliation.
    const awaiting = new Set([...this.reservations.values()].filter(item => item.status === 'estimated' && item.reported).map(item => item.agent));
    for (const id of agent ? [agent] : this.hooks.ids()) {
      if (awaiting.has(id)) continue;
      const blocked = [...this.rows.values()].some(row => (row.scope === 'global' || row.scope === 'session' || (row.scope === 'agent' && row.id === id) || (row.scope === 'model' && this.agentModels.get(id)?.has(row.id))) && this.blocked(row));
      if (!blocked && this.paused.delete(id)) resumed.push(id);
    }
    this.persist();
    return resumed;
  }
  reconcileReservation(id: string, prompt: unknown, completion: unknown, costUsd: unknown) {
    this.expireReservations();
    if (!validLimit(prompt) || !validLimit(completion) || !validLimit(prompt + completion) || !validCostLimit(costUsd)) throw new TokenFailure('Invalid reconciliation usage.');
    const reservation = this.reservations.get(id);
    if (!reservation || reservation.status !== 'estimated') throw new TokenFailure('Unknown estimated reservation.');
    const total = prompt + completion;
    // Synthetic mock usage never enters the persisted journal: it protects real tariffs and must not rewrite the operator's file.
    const journal: JournalInterval | null = reservation.provider === 'mock' ? null : { models: [...new Set([reservation.model, reservation.billingModel ?? reservation.model])], from: reservation.createdAt, to: Math.max(reservation.createdAt, this.now()) + 1 };
    if (journal) this.catalog.recordReconciliation(journal.models, journal.from, journal.to);
    for (const row of reservation.rows) {
      row.used += total - reservation.tokens;
      row.estimated -= reservation.tokens;
      row.costAccountedUsd = money(row.costAccountedUsd + costUsd - reservation.costUsd);
      row.costUnmeasuredUsd = money(row.costUnmeasuredUsd - reservation.costUsd);
      row.actual.prompt += prompt; row.actual.completion += completion; row.actual.total += total;
    }
    this.reservations.delete(id);
    this.persist();
    this.receipt({ kind: 'manual', at: this.now(), agent: reservation.agent, provider: reservation.provider, requestedModel: reservation.model, servedModel: reservation.billingModel ?? null, reservationId: id, usage: { prompt, completion, total }, replacedCostUsd: reservation.costUsd, costUsd, journal });
    if (reservation.rows.some(row => this.blocked(row))) this.pause(reservation.agent);
  }
  receiptSnapshot() { this.expireReservations(); return this.receipts.snapshot(); }
  private validScope(scope: string): scope is Scope { return ['global','agent','model','session'].includes(scope); }
  private validScopeId(scope: Scope, id: string) { return !((scope === 'agent' && !this.hooks.ids().includes(id)) || (scope === 'model' && !Object.hasOwn(this.policy.models, id)) || (scope === 'session' && id !== this.sessionId) || (scope === 'global' && id !== 'all')); }
  setLimit(scope: string, id: string, limit: unknown) {
    if (!validLimit(limit) || !this.validScope(scope)) throw new TokenFailure('Invalid limit.');
    if (!this.validScopeId(scope, id)) throw new TokenFailure('Unknown budget scope.');
    const defaults = { global: this.policy.costLimitsUsd.global, agent: this.policy.costLimitsUsd.perAgent, model: this.policy.costLimitsUsd.perModel, session: this.policy.costLimitsUsd.perSession };
    this.row(scope, id, limit, defaults[scope]).limit = limit;
    if (scope !== 'session') { this.limitOverrides.add(JSON.stringify([scope, id])); this.persist(); }
  }
  setCostLimit(scope: string, id: string, limit: unknown) {
    if (!validCostLimit(limit) || !this.validScope(scope)) throw new TokenFailure('Invalid cost limit.');
    if (!this.validScopeId(scope, id)) throw new TokenFailure('Unknown budget scope.');
    const defaults = { global: this.policy.global, agent: this.policy.perAgent, model: this.policy.perModel, session: this.policy.perSession };
    this.row(scope, id, defaults[scope], limit).costLimitUsd = limit;
    if (scope !== 'session') { this.costLimitOverrides.add(JSON.stringify([scope, id])); this.persist(); }
  }
  snapshot() {
    this.expireReservations();
    this.scopes(this.hooks.ids()[0] ?? 'none', Object.keys(this.policy.models)[0] ?? 'none');
    const ids = this.hooks.ids();
    for (const id of ids) this.row('agent', id, this.policy.perAgent, this.policy.costLimitsUsd.perAgent);
    for (const id of Object.keys(this.policy.models)) this.row('model', id, this.policy.perModel, this.policy.costLimitsUsd.perModel);
    const reservations = [...this.reservations.values()].filter(item => item.status !== 'inflight').map(item => ({ id: item.id, agent: item.agent, model: item.model, ...(item.billingModel ? { servedModel: item.billingModel } : {}), priceVersionId: item.priceVersionId, tokens: item.tokens, costUsd: item.costUsd, createdAt: item.createdAt, expiresAt: item.expiresAt, status: item.status }));
    const prices = Object.fromEntries(Object.entries(this.catalog.capture(this.now())).map(([model, version]) => [model, version.price]));
    return { sessionId: this.sessionId, stopped: this.stopped, paused: [...this.paused], priceDate: this.prices.date, prices, catalog: this.catalog.snapshot(), models: this.policy.models, cacheTtlMs: this.policy.cacheTtlMs, reservationTtlMs: this.policy.reservationTtlMs, reservations, rows: [...this.rows.values()].map(row => ({ ...structuredClone(row), state: this.blocked(row) ? 'stopped' : this.warning(row) ? 'warning' : 'available', ...(row.scope === 'agent' && !ids.includes(row.id) ? { removed: true } : {}) })) };
  }
  private refuse(agent: string, message: string): never {
    eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'budget.refused', severity: 'warning', payload: message });
    throw new TokenFailure(message);
  }
  // Every check a call makes before any I/O. execute and quote share it, so a quote can never be cheaper or more
  // permissive than the call it describes. fail decides the side effects of a refusal; record whether the agent is tied to the model's budget.
  private plan(adapter: ProviderAdapter, input: unknown, agent: string, systemPrompt: string, messages: RequestOptions['messages'] | undefined, verification: boolean, fail: (message: string, pause: boolean) => never, record: boolean) {
    this.expireReservations();
    if (!this.hooks.ids().includes(agent)) fail('Unknown agent.', false);
    const model = Object.hasOwn(this.policy.models, adapter.model) ? this.policy.models[adapter.model] : undefined;
    if (!model || model.provider !== adapter.id) fail('Model not allowlisted. Edit local token policy and prices.', false);
    if (typeof input !== 'string' || !input.trim() || input.length > 2000) fail('Invalid input.', false);
    if (adapter.id !== 'mock' && this.accounting.journal === 'blocked') fail(this.accounting.reason === 'journal_write_failed' ? 'The accounting journal could not be written. Real calls are blocked until you start a new budget period in Budgets.' : 'The accounting journal could not be read and was set aside. Check the provider invoice, then start a new budget period in Budgets; real calls are blocked until then.', false);
    if (this.stopped || this.paused.has(agent)) fail('Agent paused.', true);
    const createdAt = this.now();
    const priceVersions = this.catalog.capture(createdAt);
    const selectedPrice = Object.hasOwn(priceVersions, adapter.model) ? priceVersions[adapter.model] : undefined;
    if (!selectedPrice) fail('Model price missing, expired or not yet effective. Add an operator-verified validity before execution.', false);
    const price = selectedPrice.price;
    if (record) { const models = this.agentModels.get(agent) ?? new Set<string>(); models.add(adapter.model); this.agentModels.set(agent, models); }
    const rows = this.scopes(agent, adapter.model);
    if (rows.some(row => this.blocked(row))) fail('Token or monetary budget exhausted.', true);
    const requestedThinking = verification ? verificationThinking(model.provider, model.thinking) : model.thinking;
    const options: RequestOptions = { systemPrompt: redactText(systemPrompt), messages: (messages ?? [{ role: 'user', content: input }]).map(m => ({ role: m.role, content: redactText(m.content) })), temperature: model.temperature, maxTokens: model.max_tokens, ...(requestedThinking ? { thinking: requestedThinking } : {}) };
    // The thinking state is part of the key, so a cached answer can never be served to a request
    // that would have been allowed to reason.
    const payload = JSON.stringify({ provider: adapter.id, model: adapter.model, systemPrompt: options.systemPrompt, messages: options.messages, temperature: options.temperature, maxTokens: options.maxTokens, thinking: options.thinking ?? null });
    const hash = createHash('sha256').update(payload).digest('hex');
    const inputEstimate = this.counter.count(JSON.stringify({ systemPrompt: options.systemPrompt, messages: options.messages }));
    let reservedCostUsd: number;
    try { reservedCostUsd = preflightCostUsd(price, inputEstimate, options.maxTokens, createdAt, this.policy.reservationTtlMs); }
    catch { return fail('Model price unavailable, not yet effective, expired or expires within reservation TTL.', false); }
    const reusable = reproducible(model, requestedThinking);
    const entry = !verification && reusable ? this.cache.get(hash) : undefined;
    const cached = entry && entry.expires > this.now() ? entry : undefined;
    const reservedTokens = inputEstimate + options.maxTokens;
    if (!cached && (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1 || rows.some(row => row.used + row.reserved + reservedTokens > row.limit || row.costAccountedUsd + row.costReservedUsd + reservedCostUsd > row.costLimitUsd))) fail('Preflight reservation exceeds token or monetary budget.', true);
    return { options, hash, inputEstimate, reservedCostUsd, reservedTokens, reusable, cached, rows, createdAt, priceVersions, selectedPrice };
  }
  // What a call with this input would reserve, decided by the same checks and without reserving or pausing anything.
  quote(adapter: ProviderAdapter, input: unknown, agent: string, systemPrompt: string) {
    const plan = this.plan(adapter, input, agent, systemPrompt, undefined, false, message => { throw new TokenFailure(message); }, false);
    return { provider: adapter.id, model: adapter.model, cached: plan.cached !== undefined, reservedTokens: plan.cached ? 0 : plan.reservedTokens, reservedCostUsd: plan.cached ? 0 : plan.reservedCostUsd };
  }
  async execute(proxy: ProviderProxy, adapter: ProviderAdapter, input: unknown, signal: AbortSignal, agent: string, systemPrompt: string, messages?: RequestOptions['messages'], verification = false) {
    const { options, hash, inputEstimate, reservedCostUsd, reservedTokens, reusable, cached, rows, createdAt, priceVersions, selectedPrice } = this.plan(adapter, input, agent, systemPrompt, messages, verification, (message, pause) => { if (pause) this.pause(agent); return this.refuse(agent, message); }, true);
    if (cached) {
      rows.forEach(row => { row.saved += cached.usage.total; });
      this.receipt({ kind: 'cache', at: this.now(), agent, provider: adapter.id, requestedModel: adapter.model, servedModel: cached.billingModel, savedTokens: cached.usage.total });
      return { provider: adapter.id, model: adapter.model, billingModel: cached.billingModel, mocked: adapter.id === 'mock', text: redactText(cached.text), latencyMs: 0, cached: true, usage: cached.usage, approximate: cached.approximate };
    }
    // Synchronous reservation across all four scopes happens before any provider I/O.
    rows.forEach(row => { row.reserved += reservedTokens; row.costReservedUsd = money(row.costReservedUsd + reservedCostUsd); });
    const reservation: Reservation = { id: `reservation-${++this.reservationSequence}`, agent, model: adapter.model, provider: adapter.id, priceVersionId: selectedPrice.id, priceVersions, tokens: reservedTokens, costUsd: reservedCostUsd, inputTokens: inputEstimate, maxOutputTokens: options.maxTokens, createdAt, expiresAt: null, status: 'inflight', rows };
    this.reservations.set(reservation.id, reservation);
    // On disk before any provider I/O: a crash from here on rebuilds this reservation as unverifiable.
    if (!this.persist() && adapter.id !== 'mock') {
      rows.forEach(row => { row.reserved -= reservedTokens; row.costReservedUsd = money(row.costReservedUsd - reservedCostUsd); });
      this.reservations.delete(reservation.id);
      this.refuse(agent, 'The accounting journal could not be written. Real calls are blocked until you start a new budget period in Budgets.');
    }
    if (previewEnabled()) options.onText = text => observeArtifact(agent, this.hooks.role?.(agent) ?? agent, text);
    let verdict: BillingVerdict = 'unverifiable';
    let outcome = 'completed'; let dispatch: Dispatch | undefined; let reportedUsage: ReceiptUsage | undefined;
    let priced: { servedPriceVersionId: string; band: 'peak' | 'offPeak'; costUsd: number; journal: JournalInterval | null } | undefined;
    try {
      const result = await proxy.execute(adapter, input, signal, options, { correlationId: reservation.id, onDispatch: sent => { dispatch = sent; } });
      const approximate = adapter.id === 'mock';
      const usage = approximate ? { prompt: inputEstimate, completion: this.counter.count(result.text), total: 0 } : result.usage;
      // After provider contact these are not budget refusals: the call stays unverifiable.
      if (!usage) throw new TokenFailure('Provider usage missing.');
      if (approximate) usage.total = usage.prompt + usage.completion;
      const split = usage.inputBreakdown;
      if (![usage.prompt, usage.completion, usage.total].every(validLimit) || usage.total !== usage.prompt + usage.completion || (split !== undefined && (![split.cacheHit, split.cacheMiss].every(validLimit) || split.cacheHit + split.cacheMiss !== usage.prompt))) throw new TokenFailure('Provider usage invalid.');
      reportedUsage = { prompt: usage.prompt, completion: usage.completion, total: usage.total, cacheHit: split?.cacheHit ?? 0, cacheMiss: split?.cacheMiss ?? usage.prompt, ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }) };
      const responseAt = this.now();
      // The invoice names the model that answered, not the one that was asked for: providers reroute
      // and bill at the served model's rate. A served model with no operator-verified price cannot be
      // reconciled, and a call that already happened must not be released as if it were free.
      // Only the synthetic mock is priced as asked; a keyed adapter that names no served model cannot be priced at all.
      const billingModel = result.billingModel ?? (approximate ? adapter.model : undefined);
      if (!billingModel) throw new ProviderFailure('upstream');
      reservation.billingModel = billingModel;
      // Published before pricing so the divergence stays on record even when the served model cannot be priced.
      if (billingModel !== adapter.model) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'provider.rerouted', severity: 'warning', payload: `Request for ${adapter.model} was served by ${billingModel}.` });
      // Never the requested model's tariff: a served model without a captured price stays unverifiable.
      const billingPrice = Object.hasOwn(reservation.priceVersions, billingModel) ? reservation.priceVersions[billingModel].price : undefined;
      if (!billingPrice) {
        reservation.reported = { prompt: usage.prompt, completion: usage.completion, ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }) };
        throw new UnpricedServedModel(adapter.model, billingModel, reservation.id);
      }
      const actualCostUsd = reconciledCostUsd(billingPrice, usage, createdAt, responseAt, true);
      const journal: JournalInterval | null = approximate ? null : { models: [...new Set([adapter.model, billingModel])], from: Math.min(createdAt, responseAt), to: Math.max(createdAt, responseAt) + 1 };
      if (journal) this.catalog.recordReconciliation(journal.models, journal.from, journal.to);
      for (const row of rows) {
        row.reserved -= reservedTokens; row.used += usage.total; row.costReservedUsd = money(row.costReservedUsd - reservedCostUsd); row.costAccountedUsd = money(row.costAccountedUsd + actualCostUsd);
        const totals = approximate ? row.mock : row.actual;
        if (approximate) this.mockCost.set(row, money((this.mockCost.get(row) ?? 0) + actualCostUsd));
        totals.prompt += usage.prompt; totals.completion += usage.completion; totals.total += usage.total;
        row.conservativeCachedInput += usage.cachedPromptFullRate ?? 0;
      }
      this.reservations.delete(reservation.id);
      // Settled from here on: whatever throws later must not run the failure bookkeeping on a billed call.
      verdict = 'billed'; outcome = result.outcome ?? 'completed';
      priced = { servedPriceVersionId: reservation.priceVersions[billingModel].id, band: intervalTouchesPeak(billingPrice, createdAt, responseAt) ? 'peak' : 'offPeak', costUsd: actualCostUsd, journal };
      if (!result.outcome) observeArtifact(agent, this.hooks.role?.(agent) ?? agent, result.text);
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
      if (verdict === 'billed') throw error;
      if (error instanceof UnpricedServedModel) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'provider.unpriced', severity: 'error', payload: `${error.servedModel} answered a request for ${error.requestedModel} and has no captured price. Reservation ${error.reservationId} stays unverifiable and the agent is paused; price that model, then reconcile the expired estimate with provider-confirmed usage.` });
      else eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'error', severity: 'error', payload: 'Provider execution failed.' });
      // Names only. A shape we cannot parse pauses the agent, and the names are what makes the next
      // attempt a correction rather than a guess.
      if (ProviderFailure.is(error) && error.fields?.length) eventBus().publish({ agent_id: agent, role: this.hooks.role?.(agent) ?? agent, type: 'provider.usage_unparsed', severity: 'warning', payload: `Unrecognized provider usage or served model shape. Field names received: ${error.fields.join(', ')}. No values recorded.` });
      // A proven rejection releases the reservation. Lost contact remains unverifiable because the
      // provider may have processed and billed a response that never reached us.
      verdict = error instanceof UnpricedServedModel ? 'unverifiable' : adapter.id === 'mock' ? 'unbilled' : failureBillingVerdict(error);
      outcome = ProviderFailure.is(error) ? error.code : error instanceof UnpricedServedModel ? 'served_model_unpriced' : error instanceof TokenFailure ? 'usage_unavailable' : 'error';
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
      this.persist();
      this.receipt({ kind: 'call', at: this.now(), agent, provider: adapter.id, requestedModel: adapter.model, servedModel: reservation.billingModel ?? null, reservationId: reservation.id, verdict, outcome, mocked: adapter.id === 'mock',
        requestedAt: createdAt, priceVersionId: selectedPrice.id, servedPriceVersionId: priced?.servedPriceVersionId ?? null, dispatch: dispatch ? { sequence: dispatch.sequence, at: dispatch.at } : null,
        reserved: { tokens: reservedTokens, inputTokens: inputEstimate, maxOutputTokens: options.maxTokens, costUsd: reservedCostUsd }, reportedUsage: reportedUsage ?? null, band: priced?.band ?? null, costUsd: priced?.costUsd ?? null, journal: priced?.journal ?? null });
    }
  }
}
export type TokenSnapshot = ReturnType<TokenService['snapshot']>;
