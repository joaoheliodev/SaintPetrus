import { localRequest } from '@/lib/server/http';
import { readJson } from '@/lib/server/read-json';
import { credentials } from '@/lib/security/runtime';
import { providerId, providers } from '@/lib/security/encrypted-vault';
import { validateSelection, selectProvider, clearSelection, providerProxy, clearVerification } from '@/lib/providers/runtime';
import { safeJson } from '@/lib/security/redact';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let tail: Promise<unknown> = Promise.resolve();
export async function GET(request: Request) {
  if (!localRequest(request, false)) return safeJson({ error: 'Local requests only.' }, 403);
  return safeJson(providers.map(provider => credentials().status(provider)));
}
export async function POST(request: Request) {
  const browser = request.headers.get('x-saintpetrus-client') === 'browser' && request.headers.get('sec-fetch-site') === 'same-origin';
  const terminal = request.headers.get('x-saintpetrus-client') === 'terminal' && !request.headers.has('sec-fetch-site');
  if (!localRequest(request, true) || (!browser && !terminal)) return safeJson({ error: 'Local configuration requests only.' }, 403);
  let input: unknown;
  try { input = await readJson(request); } catch { return safeJson({ error: 'Invalid request.' }, 400); }
  const task = tail.then(async () => {
    let secret: Buffer | undefined;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      const data = input as Record<string, unknown>;
      if (Object.keys(data).some(key => !['action', 'provider', 'model', 'key', 'remember'].includes(key))) throw new Error();
      if (browser && data.action === 'set') validateSelection(data.provider, data.model);
      if (browser && data.provider === 'mock') {
        if (data.key || data.remember) throw new Error();
        providerProxy().cancel(); clearVerification();
        if (data.action === 'set') selectProvider('mock', 'mock-v1');
        else if (data.action === 'disconnect') clearSelection(); else throw new Error();
        return safeJson({ provider: 'mock', connected: data.action === 'set', remembered: false });
      }
      const provider = providerId(data.provider);
      const store = credentials();
      if (data.action === 'set') {
        if (typeof data.key !== 'string' || (data.remember !== undefined && typeof data.remember !== 'boolean')) throw new Error();
        secret = Buffer.from(data.key); delete data.key;
        providerProxy().cancel(); clearVerification();
        await store.configure(provider, secret, data.remember === true);
        if (browser) selectProvider(provider, data.model as string);
      } else if (data.action === 'disconnect') { providerProxy().cancel(); clearVerification(); store.disconnect(provider); }
      else if (data.action === 'forget') { clearVerification(); await store.forget(provider); }
      else if (data.action === 'restore') { clearVerification(); await store.restore(provider); }
      else throw new Error();
      return safeJson(store.status(provider));
    } catch { return safeJson({ error: 'Credential operation failed. For persistence, verify that the OS keyring is available and unlocked.' }, 400); }
    finally { secret?.fill(0); }
  });
  tail = task.catch(() => undefined); return task;
}
