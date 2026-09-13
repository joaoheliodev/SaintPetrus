'use client';
import { useCallback, useEffect, useState } from 'react';
import { useProjection } from './store';
import type { Graph } from './orchestrator';
import { applyGraphCommandResponse, startGraphSync } from './graph-sync';

const commandError = (value: unknown): string => {
  if (value !== null && typeof value === 'object' && 'error' in value && typeof value.error === 'string') return value.error;
  return 'Command rejected.';
};

export function useGraphTransport(initialGraph: Graph) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    useProjection.getState().hydrate(initialGraph);
    return startGraphSync({
      createSource: () => new EventSource('/api/graph/stream'),
      fetchSnapshot: async signal => {
        const response = await fetch('/api/graph', { cache: 'no-store', signal });
        if (!response.ok) throw new Error('Graph unavailable.');
        return response.json();
      },
      apply: event => useProjection.getState().apply(event),
      unavailable: value => {
        if (value) useProjection.setState({ notice: 'Local server unavailable. Retrying.' });
        else if (useProjection.getState().notice === 'Local server unavailable. Retrying.') useProjection.setState({ notice: '' });
      },
    });
  }, [initialGraph]);
  const command = useCallback(async (input: Record<string, unknown>) => {
    setPending(true);
    try {
      const response = await fetch('/api/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result: unknown = await response.json();
      if (!response.ok) {
        useProjection.setState({ notice: commandError(result) });
        return null;
      }
      const snapshot = applyGraphCommandResponse(result, input.action, event => useProjection.getState().apply(event));
      useProjection.setState({ notice: '' }); return snapshot;
    } catch {
      useProjection.setState({ notice: 'Local server unavailable. Command not confirmed.' }); return null;
    } finally { setPending(false); }
  }, []);
  return { command, pending };
}
