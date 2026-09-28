import { runtime } from '../server/runtime';
import { providerProxy } from '../providers/runtime';
import { TokenService } from './service';
import { loadConfig } from './config';
import { PriceCatalog } from '../prices/catalog';
import { join } from 'node:path';
import { AccountingJournal, type JournalOpen } from './accounting-journal';
// Plain data only: the server opens the journal with its own copy of the modules, and the routes' copy rebuilds from it.
type AccountingPin = { directory: string; opened?: JournalOpen };
const state = globalThis as typeof globalThis & { saintpetrusTokens?: TokenService; saintpetrusAccounting?: AccountingPin };
// Opened once, at start, before any route: a file set aside or a torn record is handled here and nowhere else.
// Without this pin (tests, tools) accounting stays in memory.
export function openAccountingJournal(directory: string) {
  let opened: JournalOpen | undefined;
  try { opened = new AccountingJournal(directory).open(); } finally { state.saintpetrusAccounting = { directory, ...(opened ? { opened } : {}) }; }
  return opened;
}
export function tokenService() {
  if (!state.saintpetrusTokens) {
    const { policy, prices } = loadConfig();
    state.saintpetrusTokens = new TokenService(policy, prices, {
      role: id => runtime().graph.snapshot().agents.find(a => a.id === id)?.name ?? id,
      ids: () => runtime().graph.snapshot().agents.map(a => a.id),
      pause: id => runtime().graph.setAgentStatus(id, 'paused'),
      pauseAll: () => { providerProxy().cancel(); runtime().mock.pause(); runtime().graph.pauseAll(); },
    }, undefined, Date.now, new PriceCatalog(prices, join(process.cwd(), 'config/prices.json')));
    const pin = state.saintpetrusAccounting;
    if (pin?.opened) state.saintpetrusTokens.restore(new AccountingJournal(pin.directory), pin.opened);
    else if (pin) state.saintpetrusTokens.journalUnopenable();
  }
  return state.saintpetrusTokens;
}
