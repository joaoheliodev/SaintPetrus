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
  { scope: 'global', title: 'Global', meaning: 'Everything this server has spent.' },
  { scope: 'agent', title: 'Per agent', meaning: 'What each agent has spent.' },
  { scope: 'model', title: 'Per model', meaning: 'What each requested model has spent.' },
  { scope: 'session', title: 'Session', meaning: 'Since this server started.' },
];
// A row with nothing used, reserved or estimated, in tokens or dollars.
export const idle = (row: BudgetRow) => row.used + row.reserved + row.estimated + row.unverifiable === 0 && row.costAccountedUsd + row.costReservedUsd + row.costUnmeasuredUsd === 0;

export const usd = (value: number) => value === 0 ? '$0.00' : Math.abs(value) < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(2)}`;

export type BudgetStatus = { tone: 'green' | 'amber' | 'red'; text: string };
// One sentence: what is wrong, if anything, and the way out. Names come from the graph; a removed agent keeps its id.
export function budgetStatus(snapshot: { rows: readonly BudgetRow[]; stopped: boolean; reservations: readonly { status: string }[] }, name: (row: BudgetRow) => string): BudgetStatus {
  const label = (row: BudgetRow) => row.scope === 'global' || row.scope === 'session' ? `the ${row.scope} budget` : `the ${row.scope} budget for ${name(row)}`;
  if (snapshot.rows.some(row => row.unverifiable > 0)) return { tone: 'red', text: 'A call lost contact with its provider, so its usage is unverifiable. Its reservation stays held until it expires into an estimate; check the provider billing, then apply the confirmed usage in Details.' };
  const stopped = snapshot.rows.find(row => row.state === 'stopped');
  if (stopped) return { tone: 'red', text: `Blocked: ${label(stopped)} is full in ${rowUsage(stopped).dimension}. Raise its limit in Details, then use Resume eligible agents.` };
  if (snapshot.stopped) return { tone: 'red', text: 'Every agent is paused by Pause all agents. Use Resume eligible agents when you want them to run again.' };
  const estimated = snapshot.reservations.filter(item => item.status === 'estimated').length;
  if (estimated) return { tone: 'amber', text: `${estimated} expired ${estimated === 1 ? 'reservation is' : 'reservations are'} counted as an estimate until you apply the provider-confirmed usage in Details.` };
  const warning = snapshot.rows.find(row => row.state === 'warning');
  if (warning) return { tone: 'amber', text: `Warning: ${label(warning)} is above 80%. Calls are refused at 100%.` };
  return { tone: 'green', text: 'All budgets have room.' };
}

// Calls in the receipt window the server keeps (GET /api/receipts, bounded). truncated means older ones were dropped.
export function callCount(receipts: unknown) {
  const body = receipts !== null && typeof receipts === 'object' ? receipts : {};
  const list = Reflect.get(body, 'receipts'); const evicted = Reflect.get(body, 'evicted');
  const calls = Array.isArray(list) ? list.filter(item => item !== null && typeof item === 'object' && Reflect.get(item, 'kind') === 'call').length : 0;
  return { calls, truncated: typeof evicted === 'number' && evicted > 0 };
}
