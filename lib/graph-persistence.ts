// Whether the saved copy of the graph keeps up with it. GraphStore owns this state (lib/server/graph-store.ts) and
// GET /api/graph/persistence serves it; the panel shows it as delivered and never infers it from the graph.
export type GraphPersistence = { saving: true } | { saving: false; reason: string; since: number };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

// A response from the route: exactly these keys, so nothing else can reach the warning.
export function isGraphPersistence(value: unknown): value is GraphPersistence {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  if (value.saving === true) return keys === 'saving';
  return value.saving === false && keys === 'reason,saving,since' && typeof value.reason === 'string' && value.reason.length > 0 && value.reason.length <= 500
    && typeof value.since === 'number' && Number.isSafeInteger(value.since) && value.since >= 0;
}

// The store's own reason names a field or the failure, never the text it refused, so it is shown as it arrives.
export function persistenceWarning(state: GraphPersistence | undefined, time: (at: number) => string): string {
  if (!state || state.saving) return '';
  return `${state.reason} The last saved copy stays on disk, and changes made since ${time(state.since)} are lost if the server restarts. This warning stays until the graph is saved again.`;
}
