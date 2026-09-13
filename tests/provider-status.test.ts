import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionLabel, createProviderStatusRefresher } from '../components/provider-status';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';

const snapshot: ProviderStatusSnapshot = { provider: 'gemini', model: 'model', connected: true, mocked: false, mockAvailable: false, verified: true, state: 'verified' };

test('provider status UI uses one English vocabulary throughout', async () => {
  assert.match(connectionLabel({ provider: 'gemini', model: 'model', connected: true, mocked: false, mockAvailable: false, verified: true, state: 'verified' }), /^● Connected/);
  assert.match(connectionLabel({ provider: 'gemini', model: 'model', connected: true, mocked: false, mockAvailable: false, verified: false, state: 'configured' }), /Configured, not verified/);
  const source = await readFile('components/provider-status.tsx', 'utf8');
  assert.doesNotMatch(source, /\b(agente|chave|desconectado|provedor|tente|falha|informe|operação|verificando|conectar|testar|recusad[oa]|salv[ao])\b/i);
  assert.doesNotMatch(source, /type Status\s*=/, 'The component must import the owner contract instead of duplicating it.');
  assert.doesNotMatch(source, /status\.state\s*\?\?|status\.connected\s*\?/, 'The reader must not infer a fallback connection state.');
  assert.equal(source.match(/setStatus\(/g)?.length, 1, 'Polling and commands must share one projection writer.');
  assert.match(source, /refresh\('poll'\)/, 'Polling must identify itself as lower priority.');
  assert.equal(source.match(/refresh\('explicit'\)/g)?.length, 2, 'Post-config and post-verify refreshes must be explicit.');
});

test('polling joins an explicit provider refresh without aborting the command', async () => {
  const signals: AbortSignal[] = [];
  let resolve!: (status: ProviderStatusSnapshot) => void;
  const projected: ProviderStatusSnapshot[] = [];
  const refresher = createProviderStatusRefresher(signal => new Promise<ProviderStatusSnapshot>((accept, reject) => {
    signals.push(signal); resolve = accept;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), status => projected.push(status));

  const command = refresher.refresh('explicit');
  const poll = refresher.refresh('poll');
  assert.equal(signals.length, 1, 'The poll must reuse the explicit request.');
  assert.equal(signals[0]?.aborted, false, 'The poll must not abort the explicit request.');
  resolve(snapshot);
  await Promise.all([command, poll]);
  assert.deepEqual(projected, [snapshot]);
});

test('an explicit provider refresh preempts stale polling', async () => {
  const signals: AbortSignal[] = [];
  const resolves: Array<(status: ProviderStatusSnapshot) => void> = [];
  const projected: ProviderStatusSnapshot[] = [];
  const refresher = createProviderStatusRefresher(signal => new Promise<ProviderStatusSnapshot>((accept, reject) => {
    signals.push(signal); resolves.push(accept);
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), status => projected.push(status));

  const poll = refresher.refresh('poll');
  const command = refresher.refresh('explicit');
  assert.equal(signals[0]?.aborted, true, 'The explicit request must retire stale polling.');
  assert.equal(signals.length, 2);
  resolves[1]?.(snapshot);
  await assert.rejects(poll, { name: 'AbortError' });
  await command;
  assert.deepEqual(projected, [snapshot]);
});
