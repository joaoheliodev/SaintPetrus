import { TriangleAlert } from 'lucide-react';
import { persistenceWarning, type GraphPersistence } from '@/lib/graph-persistence';

const clock = (at: number) => new Date(at).toLocaleTimeString('en-US');

// No dismiss button: only a save makes it untrue, and it goes away with the store's next successful write.
export function GraphSaveWarning({ state }: { state: GraphPersistence | undefined }) {
  const detail = persistenceWarning(state, clock);
  if (!detail) return null;
  return <div role="alert" className="save-warning"><TriangleAlert aria-hidden="true" /><p><strong>The graph is not being saved.</strong> {detail}</p></div>;
}
