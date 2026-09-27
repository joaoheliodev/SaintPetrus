import { GraphService } from './graph-service';
import { MockProvider } from '../providers/mock-provider';
const local = globalThis as typeof globalThis & { saintpetrus?: { graph: GraphService; mock: MockProvider } };
export function runtime() {
  if (!local.saintpetrus) {
    const graph = new GraphService();
    local.saintpetrus = { graph, mock: new MockProvider(graph) };
  }
  return local.saintpetrus;
}
// The dev launcher asks for the keyless mock through SAINTPETRUS_MOCK_DEFAULT; an explicit SAINTPETRUS_MOCK, from the
// shell or .env.local, always wins, and `npm start` sets no default, so production validation runs without the mock.
export const mockEnabled = () => (process.env.SAINTPETRUS_MOCK ?? process.env.SAINTPETRUS_MOCK_DEFAULT) === 'true';
