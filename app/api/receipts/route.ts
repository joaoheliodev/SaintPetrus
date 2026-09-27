import { localRequest } from '@/lib/server/http';
import { safeJson } from '@/lib/security/redact';
import { tokenService } from '@/lib/tokens/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Read-only accounting evidence. There is no write method: only TokenService appends receipts.
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  try { return safeJson(tokenService().receiptSnapshot()); }
  catch { return safeJson({ error: 'Receipts unavailable. Check local configuration.' }, 503); }
}
