import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gateSteps, runCommand, runGate } from '../scripts/gate.mjs';

type Run = { code: number; output: string };
const floor = readFileSync('AGENTS.md', 'utf8').match(/It stands at (\d+) today\./)?.[1];
const summary = (skipped: number) => `# tests ${floor}\n# pass ${floor}\n# fail 0\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n`;
// The real scripts/check-test-floor.mjs on the output the gate wrote; everything else is simulated.
function gateRun(outcomes: (command: string[]) => Run) {
  const ran: string[] = [];
  const run = async (command: string[]): Promise<Run> => {
    if (command.includes('scripts/check-test-floor.mjs')) {
      const checked = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
      return { code: checked.status ?? 1, output: `${checked.stdout}${checked.stderr}` };
    }
    ran.push(command.slice(-2).join(' ')); return outcomes(command);
  };
  return { run, ran };
}

test('R4-6 the gate is CI\'s blocking steps in CI\'s order, and CI runs nothing else', () => {
  assert.deepEqual(gateSteps.map(step => step.name), ['check-staged --tracked', 'npm audit --audit-level=high', 'lint', 'typecheck', 'tests, held to the floor in AGENTS.md', 'build']);
  const ends = [['scripts/check-staged.mjs', '--tracked'], ['audit', '--audit-level=high'], ['run', 'lint'], ['run', 'typecheck'], ['test'], ['run', 'build']];
  gateSteps.forEach((step, index) => assert.deepEqual(step.command.slice(-ends[index].length), ends[index], step.name));
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.gate, 'node scripts/gate.mjs');
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.deepEqual([...ci.matchAll(/^\s*- run: (.+)$/gm)].map(match => match[1]), ['npm ci', 'npm run gate']);
  assert.match(ci, /uses: gitleaks\/gitleaks-action@v2/, 'the Gitleaks job stays');
});

test('R4-6 the gate stops at the first step that fails and says what to do; the audit is never skipped', async () => {
  const { run, ran } = gateRun(command => ({ code: command.includes('audit') ? 1 : 0, output: '' }));
  const lines: string[] = [];
  assert.equal(await runGate({ run, log: line => { lines.push(line); } }), 1);
  assert.deepEqual(ran, ['scripts/check-staged.mjs --tracked', 'audit --audit-level=high'], 'nothing runs after the failing step');
  assert.match(lines.join('\n'), /FAILED at npm audit --audit-level=high\. .*registry did not answer.*never skipped/);
});

test('R4-6 the test step fails on its own exit code and on the floor, as CI\'s pipefail run did', async () => {
  const gateWith = async (tests: Run) => {
    const { run, ran } = gateRun(command => command[command.length - 1] === 'test' ? tests : { code: 0, output: '' });
    return { code: await runGate({ run, log: () => {} }), ran };
  };
  const clean = await gateWith({ code: 0, output: summary(0) });
  assert.equal(clean.code, 0); assert.equal(clean.ran[clean.ran.length - 1], 'run build', 'held to the floor, the build runs last');
  const skipped = await gateWith({ code: 0, output: summary(1) });
  assert.equal(skipped.code, 1, 'a skipped test fails the gate'); assert.ok(!skipped.ran.includes('run build'), 'and the build never runs');
  assert.equal((await gateWith({ code: 1, output: summary(0) })).code, 1, 'a failing run fails the gate even when its summary reads clean');
  assert.equal((await gateWith({ code: 0, output: 'no summary' })).code, 1, 'and so does a run that printed no summary');
});

test('R4-6 a gate command reports its exit code and, when asked, what it printed', async () => {
  const result = await runCommand([process.execPath, '-e', 'console.log("out"); console.error("err"); process.exit(3)'], { capture: true, echo: false });
  assert.equal(result.code, 3); assert.match(result.output, /out/); assert.match(result.output, /err/);
  assert.equal((await runCommand(['saintpetrus-no-such-command'], { capture: true, echo: false })).code, 1, 'a command that cannot start fails the step');
});
