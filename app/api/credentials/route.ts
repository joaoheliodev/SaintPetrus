import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { credentials } from '@/lib/security/runtime';
import { providerId, providers } from '@/lib/security/encrypted-vault';
import { safeJson } from '@/lib/security/redact';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let tail: Promise<unknown> = Promise.resolve();
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  return safeJson(providers.map(provider => credentials().status(provider)));
}
export async function POST(request: Request) {
  if (!localRequest(request, true) || request.headers.get('x-saintpetrus-client') !== 'terminal' || request.headers.has('sec-fetch-site')) return safeJson({ error: 'Use the local credential CLI.' }, 403);
  let input: unknown;
  try { input = await readJson(request); } catch { return safeJson({ error: 'Invalid request.' }, 400); }
  const task = tail.then(async () => {
    let secret: Buffer | undefined;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      const data = input as Record<string, unknown>; const provider = providerId(data.provider);
      const store = credentials();
      if (data.action === 'set') {
        if (typeof data.key !== 'string' || (data.remember !== undefined && typeof data.remember !== 'boolean')) throw new Error();
        secret = Buffer.from(data.key); delete data.key;
        await store.configure(provider, secret, data.remember === true);
      } else if (data.action === 'disconnect') store.disconnect(provider);
      else if (data.action === 'forget') await store.forget(provider);
      else if (data.action === 'restore') await store.restore(provider);
      else throw new Error();
      return safeJson(store.status(provider));
    } catch { return safeJson({ error: 'Credential operation failed. For persistence, verify that the OS keyring is available and unlocked.' }, 400); }
    finally { secret?.fill(0); }
  });
  tail = task.catch(() => undefined); return task;
}
