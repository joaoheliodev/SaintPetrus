import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/graph/route';
import { runtime } from '../lib/server/runtime';
const url = 'http://127.0.0.1:3000/api/graph';
const post = (body: unknown, origin = 'http://127.0.0.1:3000') => POST(new Request(url, {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

test('HTTP graph guard rejects invalid edges even with no client validation', async () => {
  runtime().mock.reset();
  await post({ action: 'add', name: 'A', objective: 'Manual graph test' });
  const initial = await (await GET(new Request(url))).json(); const a = initial.agents[1].id;
  assert.equal((await post({ action: 'connect', source: 'root', target: a })).status, 200);
  const before = runtime().graph.snapshot();
  assert.equal((await post({ action: 'connect', source: a, target: 'root' })).status, 400);
  assert.equal((await post({ action: 'connect', source: 'root', target: a })).status, 400);
  assert.equal((await post({ action: 'connect', source: a, target: a })).status, 400);
  assert.deepEqual(runtime().graph.snapshot(), before);
});

test('mock flag, origin and payload boundaries fail closed', async () => {
  const previous = process.env.SAINTPETRUS_MOCK; delete process.env.SAINTPETRUS_MOCK;
  try {
    const before = runtime().graph.snapshot();
    assert.equal((await post({ action: 'start', objective: 'Not enabled' })).status, 400);
    assert.equal((await post({ action: 'reset', objective: 'Cross origin' }, 'https://example.invalid')).status, 403);
    assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 403);
    assert.equal((await GET(new Request('http://attacker.invalid/api/graph'))).status, 403);
    assert.equal((await post({ action: 'add', name: 'a'.repeat(17000), objective: 'Oversized' })).status, 413);
    assert.deepEqual(runtime().graph.snapshot(), before);
  } finally { if (previous === undefined) delete process.env.SAINTPETRUS_MOCK; else process.env.SAINTPETRUS_MOCK = previous; }
});

test('invalid JSON returns a fixed error without echoing request contents', async () => {
  const response = await POST(new Request(url, { method: 'POST', headers: {
    origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json',
  }, body: 'PRIVATE_INPUT_NOT_JSON' }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid request.' });
});


test('Host validation supports Next URL normalization and rejects rebinding', async () => {
  const good = await GET(new Request('http://localhost:3000/api/graph', { headers: { host: '127.0.0.1:3000' } }));
  assert.equal(good.status, 200);
  const bad = await GET(new Request(url, { headers: { host: 'attacker.invalid', 'x-forwarded-host': '127.0.0.1:3000' } }));
  assert.equal(bad.status, 403);
});
