import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAIUsage } from '../lib/providers/openai-usage';
import { readResponseStream } from '../lib/providers/response-stream';
import { OpenAIAdapter } from '../lib/providers/openai';
import { ProviderFailure } from '../lib/providers/adapter';
import { Credentials } from '../lib/security/credentials';
import { EncryptedVault } from '../lib/security/encrypted-vault';

const namesOf = async (run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { assert.ok(ProviderFailure.is(error), String(error)); assert.equal(error.code, 'upstream'); return error.fields; }
  assert.fail('expected the usage to be refused');
};

test('R1 OpenAI usage is parsed strictly: the counts must add up, and reasoning is only a count inside output', () => {
  assert.deepEqual(openAIUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }, {}), { prompt: 10, completion: 5, total: 15 });
  assert.deepEqual(openAIUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 4 } }, {}), { prompt: 10, completion: 5, total: 15, reasoning: 4 });
  assert.deepEqual(openAIUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: {} }, {}), { prompt: 10, completion: 5, total: 15 });
  const refused = (raw: unknown, response: unknown = { model: 'fictitious', output: [], usage: raw }) => { try { openAIUsage(raw, response); } catch (error) { return ProviderFailure.is(error) ? error.fields : 'wrong error'; } return 'accepted'; };
  assert.deepEqual(refused(undefined, { model: 'fictitious', output: [] }), ['model', 'output'], 'missing usage names the response');
  const counts = ['input_tokens', 'output_tokens', 'total_tokens'];
  const cases: [unknown, string[]][] = [
    [{ input_tokens: 10, output_tokens: 5, total_tokens: 99 }, counts],
    [{ input_tokens: 10, output_tokens: 5 }, ['input_tokens', 'output_tokens']],
    [{ input_tokens: -1, output_tokens: 5, total_tokens: 4 }, counts],
    [{ input_tokens: 1.5, output_tokens: 5, total_tokens: 6.5 }, counts],
    [{ input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: 3 }, [...counts, 'output_tokens_details']],
    [{ input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 6 } }, [...counts, 'output_tokens_details', 'output_tokens_details.reasoning_tokens']],
  ];
  for (const [raw, names] of cases) assert.deepEqual(refused(raw), names, JSON.stringify(raw));
});

test('R1 the OpenAI adapter refuses an unreadable usage on both paths and reports only the field names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saintpetrus-openai-'));
  const store = new Credentials(new EncryptedVault(dir, { loadOrCreate: async () => { throw new Error('Persistence forbidden'); } }));
  const secret = Buffer.from(randomBytes(32).toString('hex'));
  await store.configure('openai', secret);
  try {
    const answer = { model: 'fictitious-snapshot', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] };
    const plain = (usage: unknown) => new OpenAIAdapter('fictitious', store, async () => Response.json({ ...answer, usage })).complete('Hi', new AbortController().signal);
    assert.deepEqual(await namesOf(() => plain({ input_tokens: 10, output_tokens: 5, total_tokens: 16 })), ['input_tokens', 'output_tokens', 'total_tokens']);
    assert.deepEqual(await namesOf(() => plain(undefined)), ['model', 'output']);
    const good = await plain({ input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 2 } });
    assert.deepEqual([good.usage, good.billingModel], [{ prompt: 10, completion: 5, total: 15, reasoning: 2 }, 'fictitious-snapshot']);
    const frames = [{ type: 'response.output_text.delta', delta: 'OK' }, { type: 'response.completed', response: { model: 'fictitious-snapshot', usage: { input_tokens: 3 } } }].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    assert.deepEqual(await namesOf(() => readResponseStream(new Response(frames), () => {})), ['input_tokens']);
  } finally { store.disconnect('openai'); secret.fill(0); await rm(dir, { recursive: true, force: true }); }
});
