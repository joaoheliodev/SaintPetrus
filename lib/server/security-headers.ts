// Headers for every response of the main local listener. Next's hydration needs inline scripts, and development
// adds eval and the reload socket, so the policy keeps those while denying framing, plugins, base rewrites,
// foreign forms and every connection or frame outside this origin and the isolated preview.
export function securityHeaders({ port, previewPort, dev }: { port: number; previewPort?: number; dev: boolean }): Record<string, string> {
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ` ws://127.0.0.1:${port}` : ''}`,
    `frame-src ${previewPort === undefined ? "'none'" : `http://127.0.0.1:${previewPort}`}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
  };
}
