import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { busLine, graphLine, graphTitle, isNoise, relativeTime } from '../lib/activity-log';
import { GraphActivity } from '../components/activity-log';

test('U6 activity lines are named for people, with the detail under them', () => {
  assert.equal(graphTitle('edge.created'), 'Connection created'); assert.equal(graphTitle('agent.output'), 'Run once answered');
  assert.equal(graphTitle('command.move'), 'Your change applied'); assert.equal(graphTitle('something.new'), 'something.new', 'an unknown type is shown as sent');
  assert.deepEqual(graphLine({ id: 7, type: 'agent.removed', message: 'Agent removed.', at: 1000 }, 1000 + 125_000), { key: 'graph-7', title: 'Agent removed', detail: 'Agent removed.', time: '2m' });
  assert.equal(graphLine({ id: 8, type: 'x', message: '' }, 0).time, '', 'no receive time, no label');
  const bus = busLine({ id: 3, type: 'budget.refused', role: 'Writer', payload: 'Token budget exhausted.', timestamp: '2026-09-27T10:00:00.000Z', source: 'a', destination: 'b' }, Date.parse('2026-09-27T10:00:30.000Z'));
  assert.deepEqual(bus, { key: 'bus-3', title: 'Budget refused', agent: 'Writer', detail: 'a → b · Token budget exhausted.', time: '30s' });
});

test('U6 relative time reads at a glance', () => {
  assert.deepEqual([0, 4_999, 5_000, 59_999, 60_000, 3_599_999, 3_600_000, 86_400_000, -5].map(delta => relativeTime(0, delta)), ['now', 'now', '5s', '59s', '1m', '59m', '1h', '1d', 'now']);
});

test('U6 card moves and demo output are hidden until asked for, and nothing is rendered as HTML', () => {
  assert.ok(isNoise('agent.moved') && isNoise('mock.delta')); assert.ok(!isNoise('edge.created'));
  const events = [
    { id: 3, type: 'agent.moved', message: 'Agent moved.', at: 0 },
    { id: 2, type: 'edge.created', message: 'Connection <b>created</b>.', at: 0 },
    { id: 1, type: 'agent.moved', message: 'Agent moved.', at: 0 },
  ];
  const markup = renderToStaticMarkup(React.createElement(GraphActivity, { events, revision: 3 }));
  assert.doesNotMatch(markup, /Card moved/); assert.match(markup, /\(2 hidden\)/);
  assert.match(markup, /<span class="activity-title">Connection created<\/span><span class="activity-detail">⎿ Connection &lt;b&gt;created&lt;\/b&gt;\.<\/span>/);
  assert.match(markup, /<small>revision 3<\/small>/, 'the revision is there, but small');
  assert.match(renderToStaticMarkup(React.createElement(GraphActivity, { events: [], revision: 0 })), /No changes since this page opened\. Earlier work is on the canvas/, 'an empty log never claims the graph is empty');
});

test('U6 the drawer under the canvas collapses, and the Activity view has the whole log', async () => {
  const workspace = await readFile('components/workspace.tsx', 'utf8');
  assert.match(workspace, /aria-expanded=\{drawerOpen\} onClick=\{\(\) => setDrawerOpen\(!drawerOpen\)\}/);
  assert.equal(workspace.match(/<GraphActivity events=\{events\} revision=\{graph\.revision\} \/>/g)?.length, 2, 'the drawer and the Activity view');
  assert.doesNotMatch(workspace, /Server events · revision|Live feed disabled on server|Preview disabled:/, 'notices moved to Connection → Optional features');
});
