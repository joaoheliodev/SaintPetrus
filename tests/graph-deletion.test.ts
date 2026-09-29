import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowSelectedEdgesOnly, byDeletability, delegationHint } from '../lib/graph-deletion';
import { GraphService } from '../lib/server/graph-service';

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

test('R4-1 a selected delegation says it goes with its subagent, and only context connections are asked about', () => {
  const service = new GraphService(); const context = { objective: 'Plan.', summary: 'Summary', artifacts: [] };
  const writer = service.add({ name: 'Writer', provider: 'Unconfigured', context }, { parentId: 'root' });
  const critic = service.add({ name: 'Critic', provider: 'Unconfigured', context }, { parentId: 'root' });
  const peer = service.add({ name: 'Peer', provider: 'Unconfigured', context });
  service.connect(peer, 'root');
  const graph = service.snapshot();
  const toWriter = graph.edges.find(edge => edge.target === writer)!.id; const toCritic = graph.edges.find(edge => edge.target === critic)!.id;
  const fromPeer = graph.edges.find(edge => edge.kind === 'context')!.id;
  assert.equal(delegationHint(graph, []), '');
  assert.equal(delegationHint(graph, [fromPeer]), '', 'a context connection needs no explanation');
  assert.equal(delegationHint(graph, [toWriter, fromPeer]), 'The delegation to Writer cannot be deleted on its own. Remove the subagent instead (Details → Remove agent).');
  assert.equal(delegationHint(graph, [toWriter, toCritic]), 'The delegations to Writer and Critic cannot be deleted on their own. Remove the subagents instead (Details → Remove agent).');
  assert.deepEqual(byDeletability(graph, [{ id: toWriter }, { id: fromPeer }, { id: 'unknown' }]), { contexts: [{ id: fromPeer }, { id: 'unknown' }], delegations: [{ id: toWriter }] },
    'an edge the server has not named is sent, so the server decides');
});
