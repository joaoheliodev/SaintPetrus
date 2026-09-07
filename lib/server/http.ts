import { GraphError, GraphService } from './graph-service';
import { MockProvider } from '../providers/mock-provider';
export function localRequest(request: Request, mutation: boolean) {
  const url = new URL(request.url);
  // Next may normalize request.url internally; validate the actual Host header.
  const host = request.headers.get('host') ?? url.host;
  if (url.protocol !== 'http:' || !/^127\.0\.0\.1(?::[0-9]{1,5})?$/.test(host)) return false;
  const localOrigin = `http://${host}`;
  const origin = request.headers.get('origin');
  if (origin && origin !== localOrigin) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  return !mutation || (origin === localOrigin && request.headers.get('content-type')?.split(';')[0] === 'application/json');
}
const string = (value: unknown, max = 2000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new GraphError('Invalid field.');
  return value;
};
export function dispatch(graph: GraphService, mock: MockProvider, enabled: boolean, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GraphError('Invalid command.');
  const data = input as Record<string, unknown>;
  switch (data.action) {
    case 'disconnect': graph.disconnect(string(data.id, 100)); break;
    case 'connect': graph.connect(string(data.source, 100), string(data.target, 100)); break;
    case 'add': graph.add({ name: string(data.name, 70), provider: 'Unconfigured', context: {
      objective: string(data.objective), summary: 'Manually configured agent. No provider connected.', artifacts: [],
    } }); break;
    case 'move':
      if (typeof data.x !== 'number' || typeof data.y !== 'number') throw new GraphError('Invalid position.');
      graph.move(string(data.id, 100), { x: data.x, y: data.y }); break;
    case 'budget':
      if (typeof data.depth !== 'number' || typeof data.nodes !== 'number' || typeof data.cents !== 'number') throw new GraphError('Invalid limits.');
      graph.setBudget({ maxDepth: data.depth, maxNodes: data.nodes, maxCostCents: data.cents }); break;
    case 'reset': mock.reset(string(data.objective)); break;
    case 'start': case 'pause': case 'resume':
      if (!enabled) throw new GraphError('Mock provider is disabled.');
      if (data.action === 'start') mock.start(string(data.objective));
      else if (data.action === 'pause') mock.pause(); else mock.resume();
      break;
    default: throw new GraphError('Unknown command.');
  }
  return graph.snapshot();
}
