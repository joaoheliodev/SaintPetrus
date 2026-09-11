'use client';
import { useCallback, useEffect, useState } from 'react';
import { useProjection } from './store';
import type { Graph } from './orchestrator';
import { startGraphSync } from './graph-sync';
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
      const result = await response.json();
      if (!response.ok) {
        useProjection.setState({ notice: typeof result.error === 'string' ? result.error : 'Command rejected.' });
        return null;
      }
      const snapshot = result as Graph;
      useProjection.getState().apply({ id: snapshot.revision, type: `command.${input.action}`, message: 'Server accepted command.', snapshot });
      useProjection.setState({ notice: '' }); return snapshot;
    } catch {
      useProjection.setState({ notice: 'Local server unavailable. Command not confirmed.' }); return null;
    } finally { setPending(false); }
  }, []);
  return { command, pending };
}
