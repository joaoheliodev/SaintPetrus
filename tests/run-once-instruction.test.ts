import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/provider/route';
import { MockLLMAdapter } from '../lib/providers/mock-provider';
import { runtime } from '../lib/server/runtime';
import { TokenService } from '../lib/tokens/service';

const origin = 'http://127.0.0.1:3000';
const post = (body: object) => POST(new Request(`${origin}/api/provider`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

test('Q-U1 Run once sends the objective as the instruction; the connection test keeps the first agent summary', async () => {
  const { loadConfig } = await import('../lib/tokens/config');
  const { policy, prices } = loadConfig();
  const previousTokens = Reflect.get(globalThis, 'saintpetrusTokens');
  const original = Reflect.get(MockLLMAdapter.prototype, 'complete');
  const sent: { input: string; systemPrompt: unknown }[] = [];
  Reflect.set(MockLLMAdapter.prototype, 'complete', function (this: MockLLMAdapter, input: string, signal: AbortSignal, options: { systemPrompt?: unknown }) {
    sent.push({ input, systemPrompt: options?.systemPrompt });
    return Reflect.apply(original, this, [input, signal]);
  });
  runtime().mock.reset(); const graph = runtime().graph;
  const service = new TokenService(policy, prices, { ids: () => graph.snapshot().agents.map(agent => agent.id), pause: () => {}, pauseAll: () => {} });
  Reflect.set(globalThis, 'saintpetrusTokens', service);
  try {
    const writer = graph.add({ name: 'Writer', provider: 'Unconfigured', context: { objective: 'Write the release notes in three bullet points.', summary: 'Writer summary', artifacts: [] } });
    assert.equal((await post({ action: 'test' })).status, 200);
    assert.equal((await post({ action: 'complete', input: 'Go.', agentId: writer })).status, 200);
    assert.deepEqual(sent, [
      { input: 'Reply OK.', systemPrompt: graph.snapshot().agents[0].context.summary },
      { input: 'Go.', systemPrompt: 'Write the release notes in three bullet points.' },
    ]);
    // The quote prices the same instruction: a longer objective reserves more.
    const quote = async () => (await (await post({ action: 'quote', input: 'Go.', agentId: writer })).json()).quote.reservedTokens;
    const short = await quote();
    graph.update(writer, { name: 'Writer', objective: `Write the release notes. ${'Keep every point short and concrete. '.repeat(20)}` });
    assert.ok(await quote() > short, 'the quote follows the objective the call will send');
  } finally {
    Reflect.set(MockLLMAdapter.prototype, 'complete', original);
    Reflect.set(globalThis, 'saintpetrusTokens', previousTokens); runtime().mock.reset();
  }
});
