// Shared sanitizer for server logs, errors, serialized responses, summaries and exports.
const activeSecrets = new Set<Buffer>();
export function registerSecret(secret: Buffer) {
  activeSecrets.add(secret);
  return () => { activeSecrets.delete(secret); };
}
export function redactText(input: string): string {
  let text = input;
  for (const secret of activeSecrets) {
    const value = secret.toString('utf8');
    if (value) text = text.split(value).join('[REDACTED]');
  }
  return text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]+/g, '[REDACTED]');
}
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) return { name: redactText(value.name), message: redactText(value.message), stack: redactText(value.stack ?? '') };
  if (Array.isArray(value)) return value.map(item => redact(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(result, redactText(key), { value: /api[_-]?key|authorization|password|secret|credential|cookie/i.test(key) ? '[REDACTED]' : redact(item, seen), enumerable: true });
  }
  return result;
}
export const safeStringify = (value: unknown) => JSON.stringify(redact(value));
export const safeJson = (body: unknown, status = 200) => new Response(safeStringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export function safeLog(value: unknown, write: (text: string) => void = console.error) { write(safeStringify(value)); }
