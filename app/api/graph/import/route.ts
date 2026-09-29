import { runtime as getRuntime } from '@/lib/server/runtime';
import { localRequest } from '@/lib/server/http';
import { readBoundedText } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
import { GraphError } from '@/lib/server/graph-service';
import { GRAPH_DOCUMENT_MAX_BYTES, parseGraphDocument } from '@/lib/server/graph-document';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The body is an exported graph file, the one request allowed to be this large. It is untrusted input.
export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin local requests only.' }, 403);
  try {
    const text = await readBoundedText(request, GRAPH_DOCUMENT_MAX_BYTES);
    if (text === null) return safeJson({ error: 'Graph file refused: it is larger than 4 MiB.' }, 413);
    const imported = parseGraphDocument(text);
    const { graph, mock } = getRuntime();
    // Importing replaces every agent, so the removal guard applies to each of them.
    if (graph.snapshot().agents.some(agent => tokenService().holdsReservation(agent.id))) return safeJson({ error: 'An agent has a call in flight, or usage that is unverifiable or awaiting reconciliation. Settle it in Tokens before importing.' }, 409);
    if (['running', 'paused'].includes(graph.snapshot().status)) throw new GraphError('Reset the mock run before importing a graph.');
    mock.dispose();
    graph.replace(imported, 'imported');
    return safeJson(graph.snapshot());
  } catch (error) {
    // Never echo the file: only the parser's own description of what was wrong.
    return safeJson({ error: GraphError.is(error) ? error.message : 'Invalid request.' }, 400);
  }
}
