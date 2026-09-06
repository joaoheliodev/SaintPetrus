import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { configuredAdapter, providerProxy, providerStatus } from '@/lib/providers/runtime';
import { tokenService } from '@/lib/tokens/runtime';
import { TokenFailure } from '@/lib/tokens/service';
import { runtime as graphRuntime } from '@/lib/server/runtime';
import { mockEnabled } from '@/lib/server/runtime';
import { ProviderFailure } from '@/lib/providers/adapter';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  return safeJson({ ...providerStatus(), mockAvailable: mockEnabled() });
}
export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin local requests only.' }, 403);
  try {
    const data = await readJson(request);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderFailure('invalid_request');
    const input = data as Record<string, unknown>;
    if (Object.keys(input).some(key => !['action', 'input', 'agentId'].includes(key))) throw new ProviderFailure('invalid_request');
    if (!['test', 'complete'].includes(String(input.action))) throw new ProviderFailure('invalid_request');
    const graph = graphRuntime().graph.snapshot();
    const agent = input.agentId === undefined ? graph.agents[0] : graph.agents.find(a => a.id === input.agentId);
    if (!agent) throw new ProviderFailure('invalid_request');
    const result = await tokenService().execute(providerProxy(), configuredAdapter(), input.action === 'test' ? 'Reply OK.' : input.input, request.signal, agent.id, agent.context.summary, undefined, input.action === 'test');
    return safeJson(result);
  } catch (error) {
    if (error instanceof TokenFailure) return safeJson({ error: error.message }, 409);
    const code = error instanceof ProviderFailure ? error.code : 'invalid_request';
    return safeJson({ error: code }, code === 'unconfigured' || code === 'busy' ? 409 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : 400);
  }
}
