import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firstSteps } from '../lib/first-steps';
import { GraphService } from '../lib/server/graph-service';

const context = { objective: 'x', summary: 'x', artifacts: [] };

test('U7 first steps are read from the server graph: an agent, a connection, an answer', () => {
  const graph = new GraphService();
  const progress = () => { const { steps, done, complete } = firstSteps(graph.snapshot()); return { done, complete, marks: steps.map(step => `${step.id}:${step.done}`) }; };
  assert.deepEqual(progress(), { done: 0, complete: false, marks: ['add:false', 'connect:false', 'run:false'] });
  const a = graph.add({ name: 'A', provider: 'Unconfigured', context });
  assert.deepEqual(progress().marks, ['add:true', 'connect:false', 'run:false']);
  graph.connect('root', a);
  graph.recordOutput(a, '   ');
  assert.deepEqual(progress(), { done: 2, complete: false, marks: ['add:true', 'connect:true', 'run:false'] }, 'blank output is not an answer');
  graph.recordOutput(a, 'An answer.');
  assert.deepEqual(progress(), { done: 3, complete: true, marks: ['add:true', 'connect:true', 'run:true'] });
  for (const step of firstSteps(graph.snapshot()).steps) assert.ok(step.how.length > 10, `${step.id} says how`);
});

test('U7 the checklist shows only until the graph is started, and dismissing it lives in memory', async () => {
  const workspace = await readFile('components/workspace.tsx', 'utf8');
  assert.match(workspace, /const steps = firstSteps\(graph\);/);
  assert.match(workspace, /\{!steps\.complete && !stepsDismissed && <section className="first-steps"/);
  assert.match(workspace, /const \[stepsDismissed, setStepsDismissed\] = useState\(false\);/);
  assert.match(workspace, /onClick=\{\(\) => setStepsDismissed\(true\)\}>Dismiss</);
  assert.ok(workspace.indexOf('className="first-steps"') < workspace.indexOf('<div className="canvas-area">'), 'above the canvas, never over a card');
});
