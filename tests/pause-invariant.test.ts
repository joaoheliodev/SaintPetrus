import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST as graphPost } from '../app/api/graph/route';
import { POST as importPost } from '../app/api/graph/import/route';
import { GET as tokensGet, POST as tokensPost } from '../app/api/tokens/route';
import { POST as providerPost } from '../app/api/provider/route';
import { runtime } from '../lib/server/runtime';
import { safeStringify } from '../lib/security/redact';
import { pauseAllRefusal, type TokenSnapshot } from '../lib/tokens/service';
import { pauseSentence, pauseSummary, resumable } from '../lib/budget-summary';
import type { Graph } from '../lib/orchestrator';
import { withRunMode } from './run-mode';

// The routes and the process token service wired as the server wires them (lib/tokens/runtime.ts), in memory: no
// journal is pinned, the mock answers in MOCK, REAL has no key, and nothing leaves the process. Limits are the walk's.
const origin = 'http://127.0.0.1:3000';
const post = (path: string, body: string) => new Request(`${origin}/api/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
type Reply = { status: number; error?: unknown; resumed?: unknown };
const reply = async (response: Response): Promise<Reply> => { const body = await response.json(); return { status: response.status, error: body.error, resumed: body.resumed }; };
const tokens = async (command: object) => reply(await tokensPost(post('tokens', JSON.stringify(command))));
const graph = async (command: object) => reply(await graphPost(post('graph', JSON.stringify(command))));
const provider = async (command: object) => reply(await providerPost(post('provider', JSON.stringify(command))));
const importFile = async (file: string) => reply(await importPost(post('graph/import', file)));
// What the panel reads.
const tokenState = async (): Promise<TokenSnapshot> => (await tokensGet(new Request(`${origin}/api/tokens`))).json();
const graphState = (): Graph => runtime().graph.snapshot();
const paused = (state: TokenSnapshot) => [...state.paused].sort();
const pauseAllOnly = (pause: TokenSnapshot['pauses'][number]) => pause.reasons.every(reason => reason.kind === 'pause_all');
// Rows the operator can change (Details offers no limit for a removed agent's), and those a call's worst case, about a
// hundred tokens with the mock, no longer fits in.
const raisable = (state: TokenSnapshot) => state.rows.filter(row => !('removed' in row && row.removed));
const tight = (state: TokenSnapshot) => raisable(state).filter(row => row.limit - row.used - row.reserved < 150);

// What must hold after every step, whatever came before, and why.
function invariants(label: string, state: TokenSnapshot, run: Graph) {
  const held = new Map(state.pauses.map(pause => [pause.agent, pause]));
  const name = (id: string) => run.agents.find(agent => agent.id === id)?.name ?? id;
  // One owner (R5-3): the graph shows exactly the pauses the token service holds, never one it does not, never fewer.
  for (const agent of run.agents) assert.equal(agent.status === 'paused', held.has(agent.id), `${label}: ${agent.name} is ${agent.status}, and the token service ${held.has(agent.id) ? 'holds' : 'holds no'} pause for it`);
  assert.deepEqual(paused(state), state.pauses.map(pause => pause.agent).sort(), `${label}: paused and pauses disagree`);
  for (const pause of state.pauses) {
    assert.equal(pause.removed, !run.agents.some(agent => agent.id === pause.agent), `${label}: removed is wrong for ${pause.agent}`);
    // An agent that left keeps its pause only while a reservation is still its own (R5-3).
    if (pause.removed) assert.ok(state.reservations.some(item => item.agent === pause.agent), `${label}: a removed agent keeps a pause with nothing to settle`);
  }
  // Pause all pauses every agent and is named as a hold on each (R5-2, R5-4).
  if (state.stopped) for (const agent of run.agents) assert.ok(held.get(agent.id)?.reasons.some(reason => reason.kind === 'pause_all'), `${label}: Pause all is on and ${agent.name} does not say so`);
  // A way back is on screen whenever anything is paused (R5-5), and every pause says what releases it (R5-4).
  if (state.stopped || state.pauses.length) assert.ok(resumable(state) && pauseSummary(state, name), `${label}: something is paused and no Resume eligible agents is offered`);
  for (const pause of state.pauses) {
    const sentence = pauseSentence(pause, name);
    if (!pause.removed) assert.match(sentence, /[Uu]se Resume eligible agents\.$/, `${label}: ${sentence}`);
    if (pause.reasons.some(reason => reason.kind === 'budget')) assert.match(sentence, /Raise (its limit|their limits) in Details/, `${label}: ${sentence}`);
  }
  // No demo runs in this walk, so nothing may leave the run paused for a Resume demo with nothing to resume (R5-2).
  assert.notEqual(run.status, 'paused', `${label}: the run is paused without a demo`);
}

async function walk(mode: 'mock' | 'real', seed: number, steps: number) {
  // A fixed generator, so a failing step reproduces.
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const agents = () => [...graphState().agents.map(agent => agent.id), 'missing'];
  // Exports taken along the way: importing one brings back agents removed since, with whatever the service still holds.
  const files = [safeStringify(graphState())];
  const counts: Record<string, number> = {};
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  let names = 0;
  const commands: [string, (state: TokenSnapshot) => Promise<Reply>][] = [
    // Resume comes twice as often as Pause all, so calls also meet budgets and not only Pause all.
    ['pause all', () => tokens({ action: 'kill' })],
    ['resume', () => tokens({ action: 'resume' })],
    ['resume', () => tokens({ action: 'resume' })],
    // The operator raises what Budgets names, mostly a row without room for a call, to room for one call or for many.
    ['raise a limit', state => { const row = pick(tight(state).length && random() < 0.8 ? tight(state) : raisable(state)); return tokens({ action: 'limit', scope: row.scope, id: row.id, limit: row.used + row.reserved + pick([150, 5000]) }); }],
    ['raise a limit', state => { const row = pick(tight(state).length ? tight(state) : raisable(state)); return tokens({ action: 'limit', scope: row.scope, id: row.id, limit: row.used + row.reserved + 5000 }); }],
    // Exactly what is used: full when anything is used, and too small for any call when nothing is. Now and then a row
    // the server refuses to change: a removed agent's, or one that does not exist.
    ['fill a scope', state => { const row = pick(random() < 0.8 ? raisable(state) : state.rows); return tokens({ action: 'limit', scope: row.scope, id: random() < 0.9 ? row.id : 'missing', limit: Math.max(1, row.used + row.reserved) }); }],
    ['new period', () => tokens({ action: 'new-period' })],
    ['call', () => provider({ action: 'complete', input: `Question ${Math.floor(random() * 100)}`, agentId: pick(agents()) })],
    ['call', () => provider({ action: 'complete', input: 'Question', agentId: pick(agents()) })],
    ['connection test', () => provider({ action: 'test' })],
    ['quote', () => provider({ action: 'quote', input: 'Question', agentId: pick(agents()) })],
    ['add', () => graph({ action: 'add', name: `Agent ${++names}`, objective: 'Work.', parentId: pick([null, null, ...agents()]) })],
    ['remove', () => graph({ action: 'remove-agent', id: pick(agents()) })],
    ['graph limits', () => graph({ action: 'budget', depth: pick([3, 5]), nodes: pick([12, 50]), cents: 100 })],
    ['reset', () => graph({ action: 'reset', objective: 'Start over.' })],
    ['export', async () => { files.push(safeStringify(graphState())); return { status: 200 }; }],
    ['import', () => importFile(pick(files))],
  ];
  const accepted = new Set<string>();
  await withRunMode(mode, async () => {
    for (let step = 0; step < steps; step++) {
      const [command, send] = pick(commands);
      const label = `${mode} step ${step} (${command})`;
      const before = await tokenState(); const graphBefore = graphState();
      const answer = await send(before);
      const after = await tokenState(); const graphAfter = graphState();
      invariants(label, after, graphAfter);
      if (answer.status < 400) accepted.add(command);
      // Every refusal says why, in a sentence or a known code, and a refused graph or budget command changes nothing.
      else {
        assert.ok(typeof answer.error === 'string' && answer.error.length > 0, `${label}: refused with nothing to say`);
        if (['add', 'reset', 'import'].includes(command) && before.stopped) assert.equal(answer.error, pauseAllRefusal, `${label}: the refusal names the way`);
        if (!['call', 'connection test'].includes(command)) {
          assert.deepEqual(graphAfter, graphBefore, `${label}: refused and the graph changed`);
          assert.deepEqual(paused(after), paused(before), `${label}: refused and the pauses changed`);
        }
        if (typeof answer.error === 'string') count(`${command}: ${answer.error}`);
      }
      // A quote never pauses anyone, whatever it answers (the Run once question asks before anything is held).
      if (command === 'quote') assert.deepEqual(paused(after), paused(before), `${label}: a quote changed the pauses`);
      // A call pauses at most the agent it was made for; the connection test's is the Coordinator.
      const newly = paused(after).filter(id => !before.paused.includes(id));
      if (command === 'call') assert.ok(newly.length <= 1, `${label}: one call paused ${newly.length} agents`);
      if (command === 'connection test') assert.ok(newly.every(id => id === 'root'), `${label}: the connection test paused ${newly.join(', ')}`);
      if (newly.length && (command === 'call' || command === 'connection test')) count('a call paused its agent');
      // A resume releases exactly the agents that nothing but Pause all holds, says whom, and every other hold stays.
      if (command === 'resume' && answer.status === 200) {
        const free = before.pauses.filter(pause => !pause.removed && pauseAllOnly(pause)).map(pause => pause.agent).sort();
        assert.deepEqual(Array.isArray(answer.resumed) ? [...answer.resumed].sort() : answer.resumed, free, `${label}: resumed`);
        assert.equal(after.stopped, false, `${label}: Pause all is still on`);
        const kept = (pauses: TokenSnapshot['pauses']) => pauses.map(pause => ({ ...pause, reasons: pause.reasons.filter(reason => reason.kind !== 'pause_all') })).filter(pause => !free.includes(pause.agent)).sort((a, b) => a.agent.localeCompare(b.agent));
        assert.deepEqual(kept(after.pauses), kept(before.pauses), `${label}: a hold changed on resume`);
        count(free.length ? 'resume released someone' : 'resume released no one');
        if (after.pauses.some(pause => pause.reasons.some(reason => reason.kind === 'budget'))) count('resume left a full scope holding an agent');
        if (before.stopped && after.pauses.length) count('Pause all turned off with other holds left');
      }
      if (after.pauses.some(pause => !pause.removed && !pause.reasons.length)) count('a pause nothing holds');
    }
  });
  return { accepted, counts, labels: [...new Set(commands.map(([label]) => label))] };
}

test('R5-7 a seeded walk over pauses and the ways out keeps one owner, a visible way back and a reason for every pause (MOCK)', async () => {
  const { accepted, counts, labels } = await walk('mock', 20260930, 2000);
  assert.deepEqual([...accepted].sort(), [...labels].sort(), `every command was accepted at least once: ${JSON.stringify(counts)}`);
  // The walk reached what the round is about, not only the easy paths.
  for (const reached of ['resume released someone', 'resume released no one', 'resume left a full scope holding an agent', 'Pause all turned off with other holds left', 'a pause nothing holds',
    'call: Token or monetary budget exhausted.', 'call: Preflight reservation exceeds token or monetary budget.', 'call: Agent paused.', `add: ${pauseAllRefusal}`, `import: ${pauseAllRefusal}`, `reset: ${pauseAllRefusal}`])
    assert.ok(counts[reached], `the walk never reached "${reached}": ${JSON.stringify(counts)}`);
});

// It goes on from where the MOCK walk left the server, holds included: without a key no call in REAL pauses anyone, so
// only that state gives it full scopes to keep holding agents through a resume.
test('R5-7 the walk goes on in REAL without a key: every call is refused before anything is held, and the same invariants hold', async () => {
  const { accepted, counts } = await walk('real', 20260931, 500);
  for (const command of ['pause all', 'resume', 'raise a limit', 'new period', 'add', 'remove', 'reset', 'import', 'graph limits']) assert.ok(accepted.has(command), `${command} was never accepted`);
  assert.ok(counts['call: unconfigured'] && counts['resume released someone'], JSON.stringify(counts));
  assert.ok(!Object.keys(counts).some(key => key.startsWith('call: ') && key !== 'call: unconfigured' && key !== 'call: invalid_request'), `a REAL call without a key got past the connection: ${JSON.stringify(counts)}`);
});
