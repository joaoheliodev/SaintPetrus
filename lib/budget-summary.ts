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
