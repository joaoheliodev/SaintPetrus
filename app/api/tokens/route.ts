import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
import { TokenFailure } from '@/lib/tokens/service';
import { runtime as graphRuntime } from '@/lib/server/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  try { return safeJson(tokenService().snapshot()); } catch { return safeJson({ error: 'Invalid local token configuration.' }, 503); }
}
export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin requests only.' }, 403);
  let action: unknown;
  try {
    const data = await readJson(request) as Record<string, unknown>;
    if (!data || Object.keys(data).some(key => !['action','scope','id','limit','reservationId','prompt','completion','costUsd'].includes(key))) throw new Error();
    const service = tokenService(); action = data.action;
    if (data.action === 'kill') service.kill();
    else if (data.action === 'limit') service.setLimit(String(data.scope), String(data.id), data.limit);
    else if (data.action === 'cost-limit') service.setCostLimit(String(data.scope), String(data.id), data.limit);
    else if (data.action === 'new-period') service.startBudgetPeriod();
    else if (data.action === 'reconcile') service.reconcileReservation(String(data.reservationId), data.prompt, data.completion, data.costUsd);
    else if (data.action === 'resume') {
      for (const id of service.resume()) graphRuntime().graph.compareAndSetAgentStatus(id, 'paused', 'ready');
    } else throw new Error();
    return safeJson(service.snapshot());
  } catch (error) {
    // Only a new budget period explains its refusal: its reasons are the server's own sentences, never input.
    if (action === 'new-period' && error instanceof TokenFailure) return safeJson({ error: error.message }, 409);
    return safeJson({ error: 'Token control rejected. Check scope, limits and unverifiable usage.' }, 400);
  }
}
