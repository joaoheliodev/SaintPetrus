import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowSelectedEdgesOnly } from '../lib/graph-deletion';

test('canvas deletion admits selected edges and rejects every node', async () => {
  const node = { id: 'root' };
  const selected = { id: 'selected', selected: true };
  const incident = { id: 'incident', selected: false };
  assert.deepEqual(await allowSelectedEdgesOnly({ nodes: [node], edges: [selected, incident] }), {
    nodes: [],
    edges: [selected],
  });
  assert.deepEqual(await allowSelectedEdgesOnly({ nodes: [node], edges: [incident] }), { nodes: [], edges: [] });
});
