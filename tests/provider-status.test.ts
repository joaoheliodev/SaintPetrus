import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionLabel } from '../components/provider-status';

test('provider status UI uses one English vocabulary throughout', async () => {
  assert.match(connectionLabel('verified', { provider: 'gemini', model: 'model', connected: true, mocked: false }), /^● Connected/);
  assert.match(connectionLabel('configured', { provider: 'gemini', model: 'model', connected: true, mocked: false }), /Configured, not verified/);
  const source = await readFile('components/provider-status.tsx', 'utf8');
  assert.doesNotMatch(source, /\b(agente|chave|desconectado|provedor|tente|falha|informe|operação|verificando|conectar|testar|recusad[oa]|salv[ao])\b/i);
});
