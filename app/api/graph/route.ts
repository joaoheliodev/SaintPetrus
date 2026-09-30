import { runtime as getRuntime, mockEnabled } from '@/lib/server/runtime';
import { localRequest, dispatch } from '@/lib/server/http';
import { readBoundedText } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
import { pauseAllRefusal } from '@/lib/tokens/service';
import { GraphError } from '@/lib/server/graph-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = safeJson;
export async function GET(request: Request) {
  if (!localRequest(request, false)) return json({ error: 'Local requests only.' }, 403);
  return json(getRuntime().graph.snapshot());
}
export async function POST(request: Request) {
  if (!localRequest(request, true)) return json({ error: 'Same-origin local requests only.' }, 403);
  try {
    if (!request.body) return json({ error: 'Missing body.' }, 400);
    const text = await readBoundedText(request, 16384);
    if (text === null) return json({ error: 'Request too large.' }, 413);
    const { graph, mock } = getRuntime();
    const command = JSON.parse(text);
    if (['reset','start','resume','add','preview-mock'].includes(command?.action) && tokenService().isStopped()) return json({ error: pauseAllRefusal }, 409);
    // Removal would orphan accounting that is not settled yet; the operator settles it in Tokens first.
    if (command?.action === 'remove-agent' && typeof command.id === 'string' && tokenService().holdsReservation(command.id)) return json({ error: 'This agent has a call in flight, or usage that is unverifiable or awaiting reconciliation. Settle it in Tokens before removing the agent.' }, 409);
    return json(dispatch(graph, mock, mockEnabled(), command));
  } catch (error) {
    // Never echo request contents, provider credentials or raw stack traces.
    return json({ error: GraphError.is(error) ? error.message : 'Invalid request.' }, 400);
  }
}
