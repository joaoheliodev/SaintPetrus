// Six reference cases adapted to the authoritative server service and explicit mock provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphService } from '../lib/server/graph-service';
import { MockProvider } from '../lib/providers/mock-provider';
import type { SpawnRequest } from '../lib/orchestrator';
const request = (): SpawnRequest => ({ name: 'Specialist', provider: 'Mock', context: { objective: 'Review proposal', summary: 'Essential requirements only', artifacts: [] } });

test('server atomically publishes node + delegation and isolates context', () => {
  const service = new GraphService(); const input = request();
  service.subscribe(event => {
    if (event.type === 'agent.created') {
      assert.equal(event.snapshot.agents.length, 2); assert.equal(event.snapshot.edges.length, 1);
    }
  });
  const id = service.spawn('root', input);
  input.context.artifacts.push('later.md');
  const graph = service.snapshot();
  assert.equal(graph.agents[1].id, id); assert.equal(graph.agents[1].parentId, 'root');
  assert.equal(graph.agents[1].context.artifacts.length, 0);
  graph.agents[0].name = 'Mutated snapshot'; assert.equal(service.snapshot().agents[0].name, 'Coordinator');
});

test('server rejects depth/node overflow without partial mutations', () => {
  const service = new GraphService();
  service.setBudget({ maxDepth: 1, maxNodes: 2, maxCostCents: 100 });
  const child = service.spawn('root', request()); const before = service.snapshot();
  assert.throws(() => service.spawn(child, request()), /Depth limit/);
  assert.throws(() => service.spawn('root', request()), /Agent limit/);
  assert.deepEqual(service.snapshot(), before);
});

test('server rejects cycles, duplicates, self-links and nonexistent parents', () => {
  const service = new GraphService();
  const a = service.spawn('root', request()); const b = service.spawn(a, request());
  const before = service.snapshot();
  assert.throws(() => service.connect(b, 'root'), /cycle/);
  assert.throws(() => service.connect('root', a), /already exists/);
  assert.throws(() => service.connect(a, a), /Self-connections/);
  assert.throws(() => service.spawn('missing', request()), /Parent not found/);
  assert.deepEqual(service.snapshot(), before);
  service.connect('root', b); assert.equal(service.snapshot().edges.length, 3);
});

test('server mock accounting cannot exceed the configured mock budget', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new GraphService(); const mock = new MockProvider(service);
  service.setBudget({ maxDepth: 5, maxNodes: 12, maxCostCents: 1 });
  mock.start('Test execution');
  for (let i = 0; i < 2000; i++) t.mock.timers.tick(65);
  assert.equal(service.snapshot().costCents, 1);
  assert.equal(service.snapshot().status, 'blocked');
  assert.equal(service.snapshot().agents[0].output.length, 30); mock.dispose();
});

test('server mock pause/reset cancel scheduled work and resume completes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const service = new GraphService(); const mock = new MockProvider(service);
  mock.start('Build workspace'); t.mock.timers.tick(65); mock.pause();
  const paused = service.snapshot(); t.mock.timers.tick(10000);
  assert.deepEqual(service.snapshot(), paused);
  assert.throws(() => service.setBudget({ maxDepth: 1, maxNodes: 1, maxCostCents: 1 }));
  mock.resume(); for (let i = 0; i < 2000; i++) t.mock.timers.tick(65);
  assert.equal(service.snapshot().status, 'completed');
  assert.equal(service.snapshot().agents.length, 2);
  assert.ok(service.snapshot().agents.every(a => a.status === 'completed'));
  mock.start('Next run'); t.mock.timers.tick(65); mock.reset();
  const reset = service.snapshot(); t.mock.timers.tick(10000);
  assert.deepEqual(service.snapshot(), reset); mock.dispose();
});

test('server rejects malformed budgets and agent requests', () => {
  const service = new GraphService(); const before = service.snapshot();
  assert.throws(() => service.setBudget({ maxDepth: NaN, maxNodes: 12, maxCostCents: 100 }));
  assert.throws(() => service.setBudget({ maxDepth: 3, maxNodes: 0, maxCostCents: 100 }));
  assert.throws(() => service.spawn('root', { ...request(), name: '' }));
  assert.deepEqual(service.snapshot(), before);
});
