import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { safeJson } from '@/lib/security/redact';
import { PriceCatalogError } from '@/lib/prices/catalog';
import { tokenService } from '@/lib/tokens/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  try { return safeJson(tokenService().catalog.snapshot()); }
  catch { return safeJson({ error: 'Price catalog unavailable. Check local configuration.' }, 503); }
}

export async function POST(request: Request) {
  if (!localRequest(request, true)) return safeJson({ error: 'Same-origin requests only.' }, 403);
  try {
    const input = await readJson(request);
    return safeJson(tokenService().catalog.append(input), 201);
  } catch (error) {
    return safeJson({ error: error instanceof PriceCatalogError ? error.message : 'Invalid price request.' }, 400);
  }
}
