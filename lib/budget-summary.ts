// How full each budget is, as a share of its own limit. The server decides warning and stop; these ratios only
// describe the numbers it sent, in the same terms it enforces them (used plus reserved, in tokens and in dollars).
import type { TokenSnapshot } from './tokens/service';

export type BudgetRow = TokenSnapshot['rows'][number];
export type Dimension = 'tokens' | 'dollars';
// A zero limit admits nothing, so it reads as full.
const share = (spent: number, limit: number) => limit > 0 ? spent / limit : 1;

export function rowUsage(row: BudgetRow) {
  const tokens = share(row.used + row.reserved, row.limit);
  const dollars = share(row.costAccountedUsd + row.costReservedUsd, row.costLimitUsd);
  const dimension: Dimension = dollars > tokens ? 'dollars' : 'tokens';
  return { tokens, dollars, dimension, share: Math.max(tokens, dollars) };
}

export const percent = (value: number) => Math.min(999, Math.round(value * 100));

// The top-bar meter: the fullest of the global and session scopes, whichever dimension is closer to its limit.
export function budgetMeter(rows: readonly BudgetRow[]) {
  const candidates = rows.filter(row => row.scope === 'global' || row.scope === 'session').map(row => ({ row, ...rowUsage(row) }));
  if (!candidates.length) return undefined;
  const fullest = candidates.reduce((best, item) => item.share > best.share || (item.share === best.share && item.row.state !== 'available' && best.row.state === 'available') ? item : best);
  const stopped = candidates.some(item => item.row.state === 'stopped');
  return { percent: percent(fullest.share), scope: fullest.row.scope, dimension: fullest.dimension, state: stopped ? 'stopped' : fullest.row.state };
}

export const scopes: { scope: BudgetRow['scope']; title: string; meaning: string }[] = [
  { scope: 'global', title: 'Global', meaning: 'Everything spent since the budget period began, across restarts.' },
  { scope: 'agent', title: 'Per agent', meaning: 'What each agent has spent.' },
  { scope: 'model', title: 'Per model', meaning: 'What each requested model has spent.' },
  { scope: 'session', title: 'Session', meaning: 'Since this server started.' },
];
// A row with nothing used, reserved or estimated, in tokens or dollars.
export const idle = (row: BudgetRow) => row.used + row.reserved + row.estimated + row.unverifiable === 0 && row.costAccountedUsd + row.costReservedUsd + row.costUnmeasuredUsd === 0;

export const usd = (value: number) => value === 0 ? '$0.00' : Math.abs(value) < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(2)}`;

export type BudgetStatus = { tone: 'green' | 'amber' | 'red'; text: string };
const listed = (items: readonly string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
// The dimensions in which a row is at its limit, as the server enforces them.
const fullIn = (row: BudgetRow) => [...(row.used + row.reserved >= row.limit ? ['tokens'] : []), ...(row.costAccountedUsd + row.costReservedUsd >= row.costLimitUsd ? ['dollars'] : [])].join(' and ') || rowUsage(row).dimension;
// One sentence: what is wrong, if anything, and the way out. Names come from the graph; a removed agent keeps its id.
export function budgetStatus(snapshot: { rows: readonly BudgetRow[]; stopped: boolean; reservations: readonly { status: string }[]; accounting?: JournalState }, name: (row: BudgetRow) => string): BudgetStatus {
  const label = (row: BudgetRow) => row.scope === 'global' || row.scope === 'session' ? `the ${row.scope} budget` : `the ${row.scope} budget for ${name(row)}`;
  if (snapshot.rows.some(row => row.unverifiable > 0)) return { tone: 'red', text: "A call's cost could not be confirmed (the provider lost contact, its usage could not be read, or the model that served it has no price), so its usage is unverifiable. Its reservation stays held until it expires into an estimate; check the provider billing, then apply the confirmed usage in Details." };
  // Every full scope, since raising one limit may not be enough; a removed agent's row blocks no call and cannot be raised.
  const stopped = snapshot.rows.filter(row => row.state === 'stopped' && !('removed' in row && row.removed));
  if (stopped.length) return { tone: 'red', text: `Blocked: ${listed(stopped.map(row => `${label(row)} is full in ${fullIn(row)}`))}. Raise ${stopped.length === 1 ? 'its limit' : 'their limits'} in Details, then use Resume eligible agents.` };
  if (snapshot.stopped) return { tone: 'red', text: 'Every agent is paused by Pause all agents. Use Resume eligible agents when you want them to run again.' };
  const estimated = snapshot.reservations.filter(item => item.status === 'estimated').length;
  if (estimated) return { tone: 'amber', text: `${estimated} expired ${estimated === 1 ? 'reservation is' : 'reservations are'} counted as an estimate until you apply the provider-confirmed usage in Details.` };
  const warning = snapshot.rows.find(row => row.state === 'warning');
  if (warning) return { tone: 'amber', text: `Warning: ${label(warning)} is above 80%. Calls are refused at 100%.` };
  // The journal's own warning explains the block; the summary must not call a blocked server fine.
  if (snapshot.accounting?.journal === 'blocked') return { tone: 'red', text: 'Budgets have room, but real calls are blocked by the accounting journal (see above).' };
  return { tone: 'green', text: 'All budgets have room.' };
}

export type JournalState = { journal: 'memory' | 'recorded' | 'blocked'; reason?: string; rejectedAs?: string };
// Why real calls are blocked by the accounting journal, and the way out; undefined while the journal is healthy.
export function journalWarning(accounting: JournalState) {
  if (accounting.journal !== 'blocked') return undefined;
  if (accounting.reason === 'journal_unopenable') return { text: 'Real calls are blocked: the accounting journal cannot be opened. Fix access to it in the user data directory, then restart the server. The mock still runs.', canStartPeriod: false };
  if (accounting.reason === 'journal_write_failed') return { text: 'Real calls are blocked: the accounting journal could not be written, so the file lags what this screen shows. Check the disk, then start a new budget period. The mock still runs.', canStartPeriod: true };
  return { text: `Real calls are blocked: the accounting journal could not be read${accounting.rejectedAs ? ` and was set aside as ${accounting.rejectedAs}` : ' and was set aside'}. Nothing restarted from zero on its own. Check the provider invoice, then start a new budget period. The mock still runs.`, canStartPeriod: true };
}

// Why paused agents stay paused, worded from the holds the server reports in its snapshot (Round 5, R5-4): the panel
// never infers a reason of its own.
type Pause = TokenSnapshot['pauses'][number];
const reservationStates: Record<TokenSnapshot['reservations'][number]['status'], string> = { inflight: 'still in flight', unverifiable: 'unverifiable', estimated: 'an expired estimate' };
const scopeLabel = (scope: BudgetRow['scope'], id: string, agentName: (id: string) => string) => scope === 'global' || scope === 'session' ? `the ${scope} budget` : `the ${scope} budget for ${scope === 'agent' ? agentName(id) : id}`;
const clockTime = (at: number) => `${new Date(at).toISOString().slice(11, 16)} UTC`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
// One paused agent: everything that holds it, then what releases it.
export function pauseSentence(pause: Pause, agentName: (id: string) => string) {
  const who = pause.removed ? `A removed agent (${pause.agent.slice(0, 8)})` : agentName(pause.agent);
  const holds: string[] = []; const steps: string[] = []; let mock = false; let session = false; let lost = false; let budgets = 0;
  for (const reason of pause.reasons) {
    if (reason.kind === 'pause_all') holds.push('Pause all agents is on');
    else if (reason.kind === 'unverifiable') { lost = true; holds.push(`a call's cost could not be confirmed, so usage is unverifiable ${reason.until === null ? 'until its reservation expires' : `until ${clockTime(reason.until)}`}`); }
    else if (reason.kind === 'reconciliation') { holds.push(`its expired estimate ${reason.reservationId} waits for the provider-confirmed usage`); steps.push(`apply the confirmed usage to ${reason.reservationId} in Details`); }
    else if (reason.kind === 'reservation') { holds.push(`its reservation ${reason.reservationId} is ${reservationStates[reason.status]}`); steps.push(`settle ${reason.reservationId} in Details`); }
    else { budgets++; mock ||= reason.mock; session ||= reason.scope === 'session'; holds.push(`${scopeLabel(reason.scope, reason.id, agentName)} is full in ${reason.dimensions.join(' and ')}${reason.mock ? ", filled by the mock's estimated tokens" : ''}`); }
  }
  if (!holds.length) return `${who} is paused, and nothing holds it now: use Resume eligible agents.`;
  const restart = mock ? ", or clear the mock's estimated tokens with Start a new budget period in Details or a server restart" : session ? ' or restart the server, which starts a new session budget' : '';
  if (budgets) steps.unshift(`raise ${budgets === 1 ? 'its limit' : 'their limits'} in Details${restart}`);
  if (lost) steps.unshift('check the provider billing and wait until then');
  // A removed agent's pause goes with its settled reservation (Round 5, R5-3); only a present agent needs a resume.
  if (!pause.removed) steps.push('use Resume eligible agents');
  return `${who} is paused: ${listed(holds)}. ${sentence(steps.join(', then '))}${pause.removed ? '; the pause goes with it then' : ''}.`;
}
// Everything paused, as one headline and a line per agent that something other than Pause all still holds.
export function pauseSummary(snapshot: { stopped: boolean; pauses: readonly Pause[] }, agentName: (id: string) => string) {
  if (snapshot.stopped) {
    const held = snapshot.pauses.map(pause => ({ ...pause, reasons: pause.reasons.filter(reason => reason.kind !== 'pause_all') })).filter(pause => pause.reasons.length);
    return { headline: 'Pause all agents is on, so every agent is paused. Use Resume eligible agents to run them again.', details: held.length ? ['These stay paused after that:', ...held.map(pause => pauseSentence(pause, agentName))] : [] };
  }
  if (!snapshot.pauses.length) return undefined;
  const count = snapshot.pauses.length;
  return { headline: `${count} ${count === 1 ? 'agent is' : 'agents are'} paused.`, details: snapshot.pauses.map(pause => pauseSentence(pause, agentName)) };
}
export const resumable = (snapshot: { stopped: boolean; pauses: readonly unknown[] } | undefined) => !!snapshot && (snapshot.stopped || snapshot.pauses.length > 0);
// A resume's answer stays true until the pauses change; then it is dropped rather than shown beside a newer state.
export function resumeReplyCurrent(reply: unknown, snapshot: { paused: readonly string[] }) {
  const body = reply !== null && typeof reply === 'object' ? reply : {};
  if (typeof Reflect.get(body, 'error') === 'string') return snapshot.paused.length > 0;
  const paused = Reflect.get(body, 'paused');
  return Array.isArray(paused) && paused.length === snapshot.paused.length && paused.every(id => snapshot.paused.includes(id));
}
// What the last Resume eligible agents answered: whom it released, or the server's refusal. undefined when unreadable.
export function resumeOutcome(reply: unknown, agentName: (id: string) => string) {
  const body = reply !== null && typeof reply === 'object' ? reply : {};
  const error = Reflect.get(body, 'error'); const resumed = Reflect.get(body, 'resumed');
  if (typeof error === 'string') return error;
  if (!Array.isArray(resumed) || !resumed.every(id => typeof id === 'string')) return undefined;
  return resumed.length ? `Resumed ${listed(resumed.map(agentName))}.` : 'No agent was resumed.';
}

// What a new budget period clears, as the service does it (Round 5, R5-6 and R5-Q1): the mock's tokens everywhere, but not
// the real spend the session budget holds since the server started. The question before it and Details say the same.
export const periodClears = "Consumption in the global, agent and model budgets starts again from zero. The mock's estimated tokens are cleared everywhere, and the session budget keeps only what real calls spent since the server started.";
// After a new budget period starts: a period never resumes anyone, so say who is still paused and the way out.
export function periodNotice(snapshot: { paused: readonly string[]; stopped: boolean }) {
  if (snapshot.stopped) return 'A new budget period has started. Pause all agents is still on, so every agent stays paused: use Resume eligible agents when you want them to run.';
  const count = snapshot.paused.length;
  if (count) return `A new budget period has started. ${count} ${count === 1 ? 'agent is' : 'agents are'} still paused: a new period resumes no one. Use Resume eligible agents.`;
  return 'A new budget period has started.';
}

// Calls in the receipt window the server keeps (GET /api/receipts, bounded). truncated means older ones were dropped.
export function callCount(receipts: unknown) {
  const body = receipts !== null && typeof receipts === 'object' ? receipts : {};
  const list = Reflect.get(body, 'receipts'); const evicted = Reflect.get(body, 'evicted');
  const calls = Array.isArray(list) ? list.filter(item => item !== null && typeof item === 'object' && Reflect.get(item, 'kind') === 'call').length : 0;
  return { calls, truncated: typeof evicted === 'number' && evicted > 0 };
}
