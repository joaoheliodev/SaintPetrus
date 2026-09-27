import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = () => readFile('components/workspace.tsx', 'utf8');

test('U2 every command that replaces the canvas is sent only after a confirmation on the same line', async () => {
  const source = await workspace();
  const lines = source.split('\n');
  for (const action of ['start', 'preview-mock', 'reset']) {
    const sending = lines.filter(line => line.includes(`command({ action: '${action}'`));
    assert.ok(sending.length > 0, `${action} is still reachable`);
    for (const line of sending) assert.match(line, /window\.confirm\('(Load the demo\?|Load the preview demo\?|Reset the graph\?)|if \(await command\(\{ action: 'reset'/, `${action} asks first`);
  }
  // resetGraph confirms before its awaited command on the previous line.
  assert.match(source, /async function resetGraph\(\) \{\n\s+if \(!window\.confirm\('Reset the graph\?/);
  // Import still confirms with the file name before replacing anything.
  assert.match(source, /window\.confirm\(`Import \$\{file\.name\}\?/);
});

test('U2 the demo is loaded from the More menu or the empty canvas, never from the main toolbar', async () => {
  const source = await workspace();
  assert.doesNotMatch(source, /Run mock|Run preview mock|Mock limits|Project objective/);
  assert.match(source, /<MenuItem disabled=\{pending \|\| active\} onClick=\{loadDemo\}><Play \/>Load demo…<\/MenuItem>/);
  assert.equal(source.match(/onClick=\{loadDemo\}/g)?.length, 2, 'the menu item and the empty-canvas link');
  assert.match(source, /\{lonely && <div className="canvas-hint">.*onClick=\{loadDemo\}/);
});

test('U2 graph limits and the demo cost are separate, and the objective sits with Reset graph', async () => {
  const source = await workspace();
  assert.match(source, /aria-label="Graph limits"><summary>Graph limits /);
  assert.match(source, /\{mockEnabled && <details className="budget-card" aria-label="Demo cost"><summary>Demo cost /);
  const graphLimits = source.slice(source.indexOf('aria-label="Graph limits"'), source.indexOf('aria-label="Demo cost"'));
  assert.doesNotMatch(graphLimits, /maxCostCents: Number/, 'the demo cost limit is not a graph limit');
  const reset = source.slice(source.indexOf('<DialogTitle>Reset graph</DialogTitle>'));
  assert.match(reset, /<textarea id="objective"/);
  assert.match(reset, /The objective the Coordinator receives when the graph is reset/);
});
