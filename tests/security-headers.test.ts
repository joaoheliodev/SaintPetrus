import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { securityHeaders } from '../lib/server/security-headers';

const directives = (policy: string) => new Map(policy.split('; ').map(part => { const [name, ...values] = part.split(' '); return [name, values.join(' ')]; }));

test('S4 production headers deny framing, plugins, foreign connections and frames outside the isolated preview', () => {
  const headers = securityHeaders({ port: 3000, previewPort: 3001, dev: false });
  const csp = directives(headers['Content-Security-Policy']);
  assert.equal(csp.get('default-src'), "'self'");
  assert.equal(csp.get('script-src'), "'self' 'unsafe-inline'", 'no eval in production');
  assert.equal(csp.get('connect-src'), "'self'");
  assert.equal(csp.get('frame-src'), 'http://127.0.0.1:3001', 'only the isolated preview may be framed');
  for (const [name, value] of [['object-src', "'none'"], ['base-uri', "'none'"], ['frame-ancestors', "'none'"], ['form-action', "'self'"]]) assert.equal(csp.get(name), value, name);
  assert.equal(csp.has('upgrade-insecure-requests'), false, 'the loopback app is served over http and must not be upgraded');
  assert.deepEqual({ ...headers, 'Content-Security-Policy': '' }, { 'Content-Security-Policy': '', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()' });
});

test('S4 without the preview nothing may be framed, and only development gets eval and its reload socket', () => {
  assert.equal(directives(securityHeaders({ port: 3000, dev: false })['Content-Security-Policy']).get('frame-src'), "'none'");
  const dev = directives(securityHeaders({ port: 4321, dev: true })['Content-Security-Policy']);
  assert.equal(dev.get('script-src'), "'self' 'unsafe-inline' 'unsafe-eval'");
  assert.equal(dev.get('connect-src'), "'self' ws://127.0.0.1:4321");
});

test('S4 the custom server sends the headers on every response of the main listener', async () => {
  const server = await readFile('scripts/server.ts', 'utf8');
  assert.match(server, /securityHeaders\(\{ port, previewPort: previewEnabled\(\) \? previewPort : undefined, dev: process\.argv\[2\] === 'dev' \}\)/);
  assert.match(server, /const server = createServer\(async \(req, res\) => \{\n  for \(const \[name, value\] of headersForEveryResponse\) res\.setHeader\(name, value\);/);
});
