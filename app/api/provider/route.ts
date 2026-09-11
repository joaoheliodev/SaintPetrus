import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { configuredAdapter, providerProxy, providerStatus, recordVerification } from '@/lib/providers/runtime';
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
    if ('outcome' in result && result.outcome === 'output_limit') {
      if (input.action === 'test') recordVerification(false, 'output_limit');
      return safeJson({ ...result, error: 'output_limit', status: providerStatus() }, 422);
    }
    // Only a completed round trip proves the credential. Cache hits prove nothing new but never invalidate.
    if (input.action === 'test' && !(result as { cached?: boolean }).cached) recordVerification(true);
    return safeJson({ ...result, status: providerStatus() });
  } catch (error) {
    // A budget refusal never reached the provider, so it must not mark the credential as rejected.
    if (error instanceof TokenFailure) return safeJson({ error: error.message }, 409);
    const code = error instanceof ProviderFailure ? error.code : 'invalid_request';
    if (['unauthorized', 'not_found'].includes(code)) recordVerification(false, code);
    return safeJson({ error: code }, code === 'unconfigured' || code === 'busy' ? 409 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : code === 'unauthorized' ? 401 : code === 'insufficient_balance' ? 402 : code === 'not_found' ? 404 : code === 'rate_limited' ? 429 : 400);
  }
}
