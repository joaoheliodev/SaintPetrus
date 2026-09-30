// Shared sanitizer for server logs, errors, serialized responses, summaries and exports.
// The keys and their listeners live on globalThis: the custom server and the route bundle load separate copies of this
// module, and a key configured through one copy must reach the listener the other copy registered.
const secretState = globalThis as typeof globalThis & { saintpetrusRedactionSecrets?: Set<Buffer>; saintpetrusRedactionListeners?: Set<() => void> };
const activeSecrets = secretState.saintpetrusRedactionSecrets ??= new Set<Buffer>();
const listeners = () => secretState.saintpetrusRedactionListeners ??= new Set<() => void>();
export function registerSecret(secret: Buffer) {
  activeSecrets.add(secret);
  // Told once the key is in the set, so a listener that redacts removes it; a failing listener never blocks the key.
  for (const listener of [...listeners()]) { try { listener(); } catch { /* Listener isolation is intentional. */ } }
  return () => { activeSecrets.delete(secret); };
}
// The key itself is never passed on: a listener redacts with redactText, which already knows it.
export function onSecretRegistered(listener: () => void) {
  listeners().add(listener);
  return () => { listeners().delete(listener); };
}
export function redactText(input: string): string {
  let text = input;
  for (const secret of activeSecrets) {
    const value = secret.toString('utf8');
    if (value) text = text.split(value).join('[REDACTED]');
    // Mask recognizable fragments of a configured key (12+ characters), including provider error excerpts.
    // Shorter arbitrary substrings cannot be distinguished reliably from ordinary text.
    const fragments = new Set<string>();
    for (let i = 0; i + 12 <= value.length; i++) fragments.add(value.slice(i, i + 12));
    for (const fragment of fragments) text = text.split(fragment).join('[REDACTED]');
  }
  return text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]+/g, '[REDACTED]');
}
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) return { name: redactText(value.name), message: redactText(value.message), stack: redactText(value.stack ?? '') };
  if (Array.isArray(value)) return value.map(item => redactValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(result, redactText(key), { value: /api[_-]?key|authorization|password|secret|credential|cookie/i.test(key) ? '[REDACTED]' : redactValue(item, seen), enumerable: true });
  }
  return result;
}
export function redact(value: unknown): unknown;
export function redact<T>(value: unknown, guard: (candidate: unknown) => candidate is T): T;
export function redact<T>(value: unknown, guard?: (candidate: unknown) => candidate is T): unknown {
  const clean = redactValue(value, new WeakSet<object>());
  if (guard && !guard(clean)) throw new Error('Redacted value failed schema validation.');
  return clean;
}
export const safeStringify = (value: unknown) => JSON.stringify(redact(value));
export const safeJson = (body: unknown, status = 200) => new Response(safeStringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export function safeLog(value: unknown, write: (text: string) => void = console.error) { write(safeStringify(value)); }
