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
export const mockEnabled = () => process.env.SAINTPETRUS_MOCK === 'true';
