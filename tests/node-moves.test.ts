import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestMoveSender, settledMoves, type Point } from '../lib/node-moves';

test('Q3 only settled positions are saved: drag ends and arrow-key steps, for every node that moved', () => {
  assert.deepEqual(settledMoves([
    { type: 'position', id: 'dragging', position: { x: 1, y: 1 }, dragging: true },
    { type: 'position', id: 'a', position: { x: 10, y: 20 }, dragging: false },
    { type: 'position', id: 'b', position: { x: -5, y: 0 }, dragging: false },
    { type: 'position', id: 'no-position', dragging: false },
    { type: 'position', id: 'unknown-state', position: { x: 3, y: 3 } },
    { type: 'select', id: 'a' },
    { type: 'dimensions', id: 'a' },
  ]), [{ id: 'a', position: { x: 10, y: 20 } }, { id: 'b', position: { x: -5, y: 0 } }]);
});

test('Q3 a burst of steps sends one request per node at a time and always ends on the newest position', async () => {
  const sent: [string, Point][] = []; const release: (() => void)[] = [];
  const unconfirmed = { current: new Map<string, Point>() };
  const move = latestMoveSender((id, position) => { sent.push([id, position]); return new Promise(resolve => release.push(() => resolve(true))); }, unconfirmed);
  const first = move('a', { x: 5, y: 0 });
  void move('a', { x: 10, y: 0 }); void move('a', { x: 15, y: 0 });
  const other = move('b', { x: 1, y: 1 });
  assert.deepEqual(sent, [['a', { x: 5, y: 0 }], ['b', { x: 1, y: 1 }]], 'a node in flight waits; another node does not');
  release.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.at(-1), ['a', { x: 15, y: 0 }], 'the skipped middle step never goes out');
  release.shift()!(); release.shift()!(); await Promise.all([first, other]);
  assert.equal(sent.length, 3);
  assert.deepEqual(unconfirmed.current.get('a'), { x: 15, y: 0 }, 'the canvas keeps the newest position until the server echoes it');
});

test('Q3 a refused move stops sending and gives the position back to the server', async () => {
  const unconfirmed = { current: new Map<string, Point>() };
  let calls = 0;
  const move = latestMoveSender(async () => { calls++; return false; }, unconfirmed);
  await move('a', { x: 1e9, y: 0 });
  assert.equal(calls, 1); assert.equal(unconfirmed.current.has('a'), false);
});
