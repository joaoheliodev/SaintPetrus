import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionLabel } from '../components/provider-status';

test('provider status UI uses one English vocabulary throughout', async () => {
  assert.match(connectionLabel({ provider: 'gemini', model: 'model', connected: true, mocked: false, verified: true, state: 'verified' }), /^● Connected/);
  assert.match(connectionLabel({ provider: 'gemini', model: 'model', connected: true, mocked: false, verified: false, state: 'configured' }), /Configured, not verified/);
  const source = await readFile('components/provider-status.tsx', 'utf8');
  assert.doesNotMatch(source, /\b(agente|chave|desconectado|provedor|tente|falha|informe|operação|verificando|conectar|testar|recusad[oa]|salv[ao])\b/i);
});
