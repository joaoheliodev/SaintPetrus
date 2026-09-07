import { feedEnabled } from '@/lib/events/http';
import Workspace from '@/components/workspace';
import { runtime, mockEnabled } from '@/lib/server/runtime';
import { redact } from '@/lib/security/redact';
import type { Graph } from '@/lib/orchestrator';
export const dynamic = 'force-dynamic';
export default function Home() {
  return <Workspace initialGraph={redact(runtime().graph.snapshot()) as Graph} mockEnabled={mockEnabled()} feedEnabled={feedEnabled()} />;
}
