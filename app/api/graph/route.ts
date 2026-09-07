import { runtime as getRuntime, mockEnabled } from '@/lib/server/runtime';
import { localRequest, dispatch } from '@/lib/server/http';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
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
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Missing body.' }, 400);
    let text = ''; const decoder = new TextDecoder(); let bytes = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const { graph, mock } = getRuntime();
    const command = JSON.parse(text);
    if (['reset','start','resume','add','preview-mock'].includes(command?.action) && tokenService().isStopped()) return json({ error: 'Global kill switch is active.' }, 409);
    return json(dispatch(graph, mock, mockEnabled(), command));
  } catch (error) {
    // Never echo request contents, provider credentials or raw stack traces.
    return json({ error: error instanceof GraphError ? error.message : 'Invalid request.' }, 400);
  }
}
