import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { configuredAdapter, providerProxy, providerStatus, recordVerification, verificationGeneration } from '@/lib/providers/runtime';
import { tokenService } from '@/lib/tokens/runtime';
import { TokenFailure, UnpricedServedModel } from '@/lib/tokens/service';
import { runtime as graphRuntime } from '@/lib/server/runtime';
import { ProviderFailure } from '@/lib/providers/adapter';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  // Dispatches are the server's own evidence of which requests left for a provider; they carry no payload.
  return safeJson({ ...providerStatus(), dispatches: providerProxy().dispatches.snapshot() });
}
export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin local requests only.' }, 403);
  let generation: number | undefined;
  try {
    const data = await readJson(request);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderFailure('invalid_request');
    const input = data as Record<string, unknown>;
    if (Object.keys(input).some(key => !['action', 'input', 'agentId'].includes(key))) throw new ProviderFailure('invalid_request');
    if (!['test', 'complete', 'quote'].includes(String(input.action))) throw new ProviderFailure('invalid_request');
    const graph = graphRuntime().graph.snapshot();
    const agent = input.agentId === undefined ? graph.agents[0] : graph.agents.find(a => a.id === input.agentId);
    if (!agent) throw new ProviderFailure('invalid_request');
    // What Run once would reserve, from the same checks as the call itself; nothing is reserved and nothing leaves.
    if (input.action === 'quote') return safeJson({ quote: tokenService().quote(configuredAdapter(), input.input, agent.id, agent.context.summary) });
    // The verdict belongs to the key and pair this call uses; a change while it runs makes it stale.
    generation = verificationGeneration();
    const result = await tokenService().execute(providerProxy(), configuredAdapter(), input.action === 'test' ? 'Reply OK.' : input.input, request.signal, agent.id, agent.context.summary, undefined, input.action === 'test');
    if ('outcome' in result && result.outcome === 'output_limit') {
      if (input.action === 'test') recordVerification(false, 'output_limit', generation);
      return safeJson({ ...result, error: 'output_limit', status: providerStatus() }, 422);
    }
    // Only a completed round trip with visible text proves the credential. Cache hits prove nothing new but never invalidate.
    if (input.action === 'test' && !result.cached && !result.text.trim()) {
      recordVerification(false, 'empty_output', generation);
      return safeJson({ ...result, error: 'empty_output', status: providerStatus() }, 422);
    }
    if (input.action === 'test' && !result.cached) recordVerification(true, undefined, generation);
    if (input.action === 'complete') graphRuntime().graph.recordOutput(agent.id, result.text);
    return safeJson({ ...result, status: providerStatus() });
  } catch (error) {
    // The provider answered, but its model has no captured price: no verdict either way, the hold stays.
    if (error instanceof UnpricedServedModel) return safeJson({ error: 'served_model_unpriced', requestedModel: error.requestedModel, servedModel: error.servedModel, reservationId: error.reservationId }, 409);
    // A budget refusal never reached the provider, so it must not mark the credential as rejected.
    if (error instanceof TokenFailure) return safeJson({ error: error.message }, 409);
    const code = ProviderFailure.is(error) ? error.code : 'invalid_request';
    if (['unauthorized', 'not_found'].includes(code)) recordVerification(false, code, generation);
    return safeJson({ error: code }, code === 'unconfigured' || code === 'busy' ? 409 : code === 'timeout' ? 504 : code === 'upstream' ? 502 : code === 'unauthorized' ? 401 : code === 'insufficient_balance' ? 402 : code === 'not_found' ? 404 : code === 'rate_limited' ? 429 : 400);
  }
}
