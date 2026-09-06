import Workspace from '@/components/workspace';
import { runtime, mockEnabled } from '@/lib/server/runtime';
export const dynamic = 'force-dynamic';
export default function Home() {
  return <Workspace initialGraph={runtime().graph.snapshot()} mockEnabled={mockEnabled()} />;
}
