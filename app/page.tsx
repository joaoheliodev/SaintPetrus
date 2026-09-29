import { previewEnabled } from '@/lib/preview/store';
import { feedEnabled } from '@/lib/events/http';
import Workspace from '@/components/workspace';
import { runtime, mockEnabled } from '@/lib/server/runtime';
import { redact } from '@/lib/security/redact';
import { isGraph } from '@/lib/orchestrator';
export const dynamic = 'force-dynamic';
export default function Home() {
  return <Workspace initialGraph={redact(runtime().graph.snapshot(), isGraph)} mockEnabled={mockEnabled()} feedEnabled={feedEnabled()} previewPort={previewEnabled() ? Number(process.env.SAINTPETRUS_PREVIEW_PORT ?? Number(process.env.PORT ?? 3000) + 1) : undefined} />;
}
