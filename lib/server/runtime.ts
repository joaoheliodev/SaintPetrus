import { GraphService } from './graph-service';
import { MockProvider } from '../providers/mock-provider';
const local = globalThis as typeof globalThis & { saintpetrus?: { graph: GraphService; mock: MockProvider } };
export function runtime() {
  if (!local.saintpetrus) {
    const graph = new GraphService();
    // A key configured later, through either copy of the modules, leaves the graph at once (R4-5).
    graph.followSecrets();
    local.saintpetrus = { graph, mock: new MockProvider(graph) };
  }
  return local.saintpetrus;
}
export type RunMode = 'mock' | 'real';
// Real providers need an explicit opt-in (operator decision Q-01); anything else runs the keyless mock.
export function runMode(value = process.env.SAINTPETRUS_MODE): RunMode {
  if (value === undefined || value === '' || value === 'mock') return 'mock';
  if (value === 'real') return 'real';
  throw new Error('SAINTPETRUS_MODE must be "mock" or "real".');
}
// Read once, at startup, as plain data like the validation timeout: a later .env reload in development cannot switch it,
// and the server's own copy of these modules can pin it for the routes.
export function pinnedRunMode(): RunMode {
  const pin: unknown = Reflect.get(globalThis, 'saintpetrusRunMode');
  if (pin && typeof pin === 'object' && 'mode' in pin && (pin.mode === 'mock' || pin.mode === 'real')) return pin.mode;
  const mode = runMode(); Reflect.set(globalThis, 'saintpetrusRunMode', { mode }); return mode;
}
export const mockEnabled = () => pinnedRunMode() === 'mock';
// The flags this replaced must stop the server rather than be half honoured.
export const retiredModeVariables = (env: Readonly<Record<string, string | undefined>> = process.env) => ['SAINTPETRUS_MOCK', 'SAINTPETRUS_MOCK_DEFAULT'].filter(name => env[name] !== undefined);
