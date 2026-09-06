import { createHash, randomUUID } from 'node:crypto';
import { heuristicTokenCounter, type TokenCounter } from '../core/token-estimate';
import { ProviderFailure, type ProviderAdapter, type RequestOptions, type Usage } from '../providers/adapter';
import type { ProviderProxy } from '../providers/proxy';
import { redactText } from '../security/redact';
import { validateConfig, validLimit, type TokenPolicy, type Prices } from './config';
export class TokenFailure extends Error {}
type Totals = { prompt: number; completion: number; total: number };
type Row = { scope: string; id: string; limit: number; used: number; reserved: number; actual: Totals; mock: Totals; costEstimateUsd: number; saved: number; unresolved: number };
type Hooks = { pause: (id: string) => void; pauseAll: () => void; ids: () => string[] };
const zero = (): Totals => ({ prompt: 0, completion: 0, total: 0 });
export class TokenService {
  readonly sessionId = randomUUID();
  private rows = new Map<string, Row>();
  private stopped = false;
  private paused = new Set<string>();
  private agentModels = new Map<string, Set<string>>();
  private cache = new Map<string, { expires: number; text: string; usage: Usage; approximate: boolean }>();
  constructor(readonly policy: TokenPolicy, readonly prices: Prices, private readonly hooks: Hooks, private readonly counter: TokenCounter = heuristicTokenCounter, private readonly now = Date.now) { validateConfig(policy, prices); }
  private row(scope: string, id: string, limit: number) {
    const key = JSON.stringify([scope, id]); let row = this.rows.get(key);
    if (!row) { row = { scope, id, limit, used: 0, reserved: 0, actual: zero(), mock: zero(), costEstimateUsd: 0, saved: 0, unresolved: 0 }; this.rows.set(key, row); }
    return row;
  }
  private scopes(agent: string, model: string) { return [this.row('global', 'all', this.policy.global), this.row('agent', agent, this.policy.perAgent), this.row('model', model, this.policy.perModel), this.row('session', this.sessionId, this.policy.perSession)]; }
  private pause(id: string) { this.paused.add(id); this.hooks.pause(id); }
  kill() { this.stopped = true; this.hooks.ids().forEach(id => this.paused.add(id)); this.hooks.pauseAll(); }
  isStopped() { return this.stopped; }
  resume(agent?: string) {
    if ([...this.rows.values()].some(row => row.unresolved > 0)) throw new TokenFailure('Usage unresolved; restart only after checking provider billing.');
    if (!agent) this.stopped = false;
    for (const id of agent ? [agent] : this.hooks.ids()) {
      const blocked = [...this.rows.values()].some(row => (row.scope === 'global' || row.scope === 'session' || (row.scope === 'agent' && row.id === id) || (row.scope === 'model' && this.agentModels.get(id)?.has(row.id))) && row.used + row.reserved >= row.limit);
      if (!blocked) this.paused.delete(id);
    }
  }
  setLimit(scope: string, id: string, limit: unknown) {
    if (!validLimit(limit) || !['global','agent','model','session'].includes(scope)) throw new TokenFailure('Invalid limit.');
    if ((scope === 'agent' && !this.hooks.ids().includes(id)) || (scope === 'model' && !Object.hasOwn(this.policy.models, id)) || (scope === 'session' && id !== this.sessionId) || (scope === 'global' && id !== 'all')) throw new TokenFailure('Unknown budget scope.');
    this.row(scope, id, limit).limit = limit;
  }
  snapshot() {
    this.scopes(this.hooks.ids()[0] ?? 'none', Object.keys(this.policy.models)[0] ?? 'none');
    for (const id of this.hooks.ids()) this.row('agent', id, this.policy.perAgent);
    for (const id of Object.keys(this.policy.models)) this.row('model', id, this.policy.perModel);
    return { sessionId: this.sessionId, stopped: this.stopped, paused: [...this.paused], priceDate: this.prices.date, prices: this.prices.models, models: this.policy.models, cacheTtlMs: this.policy.cacheTtlMs, rows: [...this.rows.values()].map(row => ({ ...structuredClone(row), state: row.used + row.reserved >= row.limit ? 'stopped' : row.used + row.reserved >= row.limit * .8 ? 'warning' : 'available' })) };
  }
  async execute(proxy: ProviderProxy, adapter: ProviderAdapter, input: unknown, signal: AbortSignal, agent: string, systemPrompt: string, messages?: RequestOptions['messages'], bypassCache = false) {
    if (!this.hooks.ids().includes(agent)) throw new TokenFailure('Unknown agent.');
    const model = Object.hasOwn(this.policy.models, adapter.model) ? this.policy.models[adapter.model] : undefined;
    if (!model || model.provider !== adapter.id) throw new TokenFailure('Model not allowlisted. Edit local token policy and prices.');
    if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new TokenFailure('Invalid input.');
    if (this.stopped || this.paused.has(agent)) { this.pause(agent); throw new TokenFailure('Agent paused.'); }
    const models = this.agentModels.get(agent) ?? new Set<string>(); models.add(adapter.model); this.agentModels.set(agent, models);
    const rows = this.scopes(agent, adapter.model);
    if (rows.some(row => row.used + row.reserved >= row.limit)) { this.pause(agent); throw new TokenFailure('Token budget exhausted.'); }
    const options: RequestOptions = { systemPrompt: redactText(systemPrompt), messages: (messages ?? [{ role: 'user', content: input }]).map(m => ({ role: m.role, content: redactText(m.content) })), temperature: model.temperature, maxTokens: model.max_tokens };
    const payload = JSON.stringify({ provider: adapter.id, model: adapter.model, ...options });
    const hash = createHash('sha256').update(payload).digest('hex');
    const cached = !bypassCache && model.temperature === 0 ? this.cache.get(hash) : undefined;
    if (cached && cached.expires > this.now()) { rows.forEach(row => { row.saved += cached.usage.total; }); return { provider: adapter.id, model: adapter.model, mocked: adapter.id === 'mock', text: redactText(cached.text), latencyMs: 0, cached: true, usage: cached.usage, approximate: cached.approximate }; }
    const inputEstimate = this.counter.count(JSON.stringify({ systemPrompt: options.systemPrompt, messages: options.messages }));
    const reservation = inputEstimate + options.maxTokens;
    if (!Number.isSafeInteger(reservation) || reservation < 1 || rows.some(row => row.used + row.reserved + reservation > row.limit)) { this.pause(agent); throw new TokenFailure('Preflight reservation exceeds token budget.'); }
    // Synchronous reservation across all four scopes happens before any provider I/O.
    rows.forEach(row => { row.reserved += reservation; });
    let reconciled = false; let notSent = false;
    try {
      const result = await proxy.execute(adapter, input, signal, options);
      const approximate = adapter.id === 'mock';
      const usage = approximate ? { prompt: inputEstimate, completion: this.counter.count(result.text), total: 0 } : result.usage;
      if (!usage) throw new TokenFailure('Provider usage missing.');
      if (approximate) usage.total = usage.prompt + usage.completion;
      if (![usage.prompt, usage.completion, usage.total].every(validLimit) || usage.total !== usage.prompt + usage.completion) throw new TokenFailure('Provider usage invalid.');
      const price = this.prices.models[adapter.model];
      for (const row of rows) {
        row.reserved -= reservation; row.used += usage.total;
        const totals = approximate ? row.mock : row.actual;
        totals.prompt += usage.prompt; totals.completion += usage.completion; totals.total += usage.total;
        row.costEstimateUsd += (usage.prompt * price.inputPerMillion + usage.completion * price.outputPerMillion) / 1e6;
      }
      reconciled = true;
      if (rows.some(row => row.used >= row.limit)) this.pause(agent);
      if (!bypassCache && model.temperature === 0 && this.policy.cacheTtlMs > 0) {
        for (const [key, entry] of this.cache) if (entry.expires <= this.now()) this.cache.delete(key);
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(hash, { expires: this.now() + this.policy.cacheTtlMs, text: result.text, usage: { ...usage }, approximate });
      }
      return { ...result, usage, approximate, cached: false };
    } catch (error) {
      notSent = error instanceof ProviderFailure && error.code === 'busy';
      throw error;
    } finally {
      if (!reconciled) {
        if (adapter.id === 'mock' || notSent) rows.forEach(row => { row.reserved -= reservation; });
        else { rows.forEach(row => { row.unresolved++; }); this.pause(agent); }
      }
    }
  }
}
