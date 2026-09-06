import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
import { runtime as graphRuntime } from '@/lib/server/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  try { return safeJson(tokenService().snapshot()); } catch { return safeJson({ error: 'Invalid local token configuration.' }, 503); }
}
export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin requests only.' }, 403);
  try {
    const data = await readJson(request) as Record<string, unknown>;
    if (!data || Object.keys(data).some(key => !['action','scope','id','limit'].includes(key))) throw new Error();
    const service = tokenService();
    if (data.action === 'kill') service.kill();
    else if (data.action === 'limit') service.setLimit(String(data.scope), String(data.id), data.limit);
    else if (data.action === 'resume') {
      service.resume();
      for (const agent of graphRuntime().graph.snapshot().agents) if (agent.status === 'paused' && !service.snapshot().paused.includes(agent.id)) graphRuntime().graph.setAgentStatus(agent.id, 'ready');
    } else throw new Error();
    return safeJson(service.snapshot());
  } catch { return safeJson({ error: 'Token control rejected. Check scope, limits and unresolved usage.' }, 400); }
}
