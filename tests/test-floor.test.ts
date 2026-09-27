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

test('D5 CI holds every run to the floor in AGENTS.md', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /shell: bash\n\s+run: \|\n\s+npm test 2>&1 \| tee test-output\.txt\n\s+node scripts\/check-test-floor\.mjs test-output\.txt/, 'the run keeps pipefail and checks the same output');
  assert.equal(testFloorProblems(`# tests ${readFileSync('AGENTS.md', 'utf8').match(/It stands at (\d+) today\./)?.[1]}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0`, readFileSync('AGENTS.md', 'utf8')).length, 0, 'the repository floor is readable');
});
