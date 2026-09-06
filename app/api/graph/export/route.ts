import { runtime as getRuntime } from '@/lib/server/runtime';
import { localRequest } from '@/lib/server/http';
import { safeStringify, safeJson } from '@/lib/security/redact';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  return new Response(safeStringify(getRuntime().graph.snapshot()), { headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="saintpetrus-context.json"',
  } });
}
