import { runtime } from '../server/runtime';
import { providerProxy } from '../providers/runtime';
import { TokenService } from './service';
import { loadConfig } from './config';
const state = globalThis as typeof globalThis & { saintpetrusTokens?: TokenService };
export function tokenService() {
  if (!state.saintpetrusTokens) {
    const { policy, prices } = loadConfig();
    state.saintpetrusTokens = new TokenService(policy, prices, {
      role: id => runtime().graph.snapshot().agents.find(a => a.id === id)?.name ?? id,
      ids: () => runtime().graph.snapshot().agents.map(a => a.id),
      pause: id => runtime().graph.setAgentStatus(id, 'paused'),
      pauseAll: () => { providerProxy().cancel(); runtime().mock.pause(); runtime().graph.pauseAll(); },
    });
  }
  return state.saintpetrusTokens;
}
