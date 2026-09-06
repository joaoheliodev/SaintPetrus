'use client';
import { useCallback, useEffect, useState } from 'react';
import { useProjection } from './store';
import type { Graph } from './orchestrator';
export function useGraphTransport(initialGraph: Graph) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    useProjection.getState().hydrate(initialGraph);
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await fetch('/api/graph', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Graph unavailable.');
        const snapshot: Graph = await response.json();
        if (!disposed) {
          useProjection.getState().apply({ id: snapshot.revision, type: 'graph.updated', message: 'Server state received.', snapshot });
          if (useProjection.getState().notice === 'Local server unavailable. Retrying.') useProjection.setState({ notice: '' });
        }
      } catch {
        if (!disposed) useProjection.setState({ notice: 'Local server unavailable. Retrying.' });
      } finally {
        if (!disposed) timer = setTimeout(poll, 300);
      }
    };
    timer = setTimeout(poll, 300);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [initialGraph]);
  const command = useCallback(async (input: Record<string, unknown>) => {
    setPending(true);
    try {
      const response = await fetch('/api/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) {
        useProjection.setState({ notice: typeof result.error === 'string' ? result.error : 'Command rejected.' });
        return false;
      }
      const snapshot = result as Graph;
      useProjection.getState().apply({ id: snapshot.revision, type: `command.${input.action}`, message: 'Server accepted command.', snapshot });
      useProjection.setState({ notice: '' }); return true;
    } catch {
      useProjection.setState({ notice: 'Local server unavailable. Command not confirmed.' }); return false;
    } finally { setPending(false); }
  }, []);
  return { command, pending };
}
