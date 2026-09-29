import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGraph, isGraph, type Graph } from '../lib/orchestrator';
import { redact, registerSecret } from '../lib/security/redact';

// @ts-expect-error Unguarded redaction intentionally remains unknown until its schema is checked.
const unguardedGraph: Graph = redact(createGraph());
void unguardedGraph;
const nonEmptyRootTypeContract = (graph: Graph) => {
  // @ts-expect-error The authoritative root tuple is readonly and cannot be emptied with pop.
  graph.agents.pop();
};
void nonEmptyRootTypeContract;

test('guarded graph redaction preserves a valid non-empty root graph and rejects schema changes', async () => {
  const graph = createGraph(); const secret = Buffer.from('synthetic-active-secret-value'); const unregister = registerSecret(secret);
  try {
    graph.agents[0].context.objective = secret.toString();
    const clean = redact(graph, isGraph);
    assert.equal(clean.agents[0].context.objective, '[REDACTED]'); assert.equal(clean.agents[0].id, 'root');
    assert.throws(() => redact({ ...graph, agents: [] }, isGraph), /schema validation/);
    assert.throws(() => redact({ ...graph, agents: [{ ...graph.agents[0], id: 'not-root' }] }, isGraph), /schema validation/);
    const page = await readFile('app/page.tsx', 'utf8');
    assert.doesNotMatch(page, /\bas\s+Graph\b/);
  } finally { unregister(); secret.fill(0); }
});

test('guarded redaction fails closed when a protected enum is altered', () => {
  const secret = Buffer.from('idle'); const unregister = registerSecret(secret);
  try { assert.throws(() => redact(createGraph(), isGraph), /schema validation/); }
  finally { unregister(); secret.fill(0); }
});
