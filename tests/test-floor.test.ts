import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testFloorProblems } from '../scripts/test-floor.mjs';

const agents = 'The test count is a floor, not a target. It stands at 10 today.';
const summary = (tests: number, extra: Record<string, number> = {}) => ['ok 1 - something', `# tests ${tests}`, '# suites 2', `# pass ${tests}`, ...['fail', 'cancelled', 'skipped', 'todo'].map(name => `# ${name} ${extra[name] ?? 0}`)].join('\n');

test('D5 a run at or above the AGENTS.md floor with nothing skipped passes', () => {
  assert.deepEqual(testFloorProblems(summary(10), agents), []);
  assert.deepEqual(testFloorProblems(summary(12), agents), []);
});

test('D5 a shrinking, skipping, failing or unreadable run is refused', () => {
  assert.match(testFloorProblems(summary(9), agents).join(), /9 tests ran, below the floor of 10/);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.match(testFloorProblems(summary(10, { [name]: 1 }), agents).join(), new RegExp(`${name}: 1`), name);
  assert.deepEqual(testFloorProblems('no summary here', agents), ['The test run printed no summary.']);
  assert.deepEqual(testFloorProblems(summary(10), 'no floor'), ['AGENTS.md does not state the test floor.']);
  assert.match(testFloorProblems(summary(10).replace('# skipped 0\n', ''), agents).join(), /skipped: missing/);
});

test('D5 CI holds every run to the floor in AGENTS.md, through the gate', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  // The gate runs the tests and scripts/check-test-floor.mjs on the same output (tests/gate.test.ts).
  assert.deepEqual([...ci.matchAll(/^\s*- run: (.+)$/gm)].map(match => match[1]), ['npm ci', 'npm run gate'], 'CI installs and runs the gate, and nothing else');
  assert.equal(testFloorProblems(`# tests ${readFileSync('AGENTS.md', 'utf8').match(/It stands at (\d+) today\./)?.[1]}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0`, readFileSync('AGENTS.md', 'utf8')).length, 0, 'the repository floor is readable');
});

test('R1 the floor check reads the spec reporter as well as TAP, so newer Node cannot fail it by format alone', () => {
  const spec = (tests: number, skipped = 0) => ['✔ something (1ms)', `ℹ tests ${tests}`, 'ℹ suites 2', `ℹ pass ${tests}`, 'ℹ fail 0', 'ℹ cancelled 0', `ℹ skipped ${skipped}`, 'ℹ todo 0', 'ℹ duration_ms 12'].join('\n');
  assert.deepEqual(testFloorProblems(spec(10), agents), []);
  assert.match(testFloorProblems(spec(9), agents).join(), /below the floor of 10/);
  assert.match(testFloorProblems(spec(10, 1), agents).join(), /skipped: 1/);
});
