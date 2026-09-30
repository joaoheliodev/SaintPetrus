// The gate AGENTS.md requires before every commit: CI's blocking steps, in CI's order, so what passes here passes
// there. CI installs with `npm ci` and then runs this script; the Gitleaks job stays apart.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Through the npm that started this script (`npm run gate`), so no shell is involved on any platform.
const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm'];
export const gateSteps = [
  { name: 'check-staged --tracked', command: [process.execPath, 'scripts/check-staged.mjs', '--tracked'] },
  { name: 'npm audit --audit-level=high', command: [...npm, 'audit', '--audit-level=high'],
    onFailure: 'Fix an advisory with a patch or minor release and a green gate. With no fix available, or if the registry did not answer, stop and report: this step is never skipped.' },
  { name: 'lint', command: [...npm, 'run', 'lint'] },
  { name: 'typecheck', command: [...npm, 'run', 'typecheck'] },
  { name: 'tests, held to the floor in AGENTS.md', command: [...npm, 'test'], floor: true },
  { name: 'build', command: [...npm, 'run', 'build'],
    onFailure: 'In the Codex sandbox the build fails with "Could not parse output from TypeScript\'s --showConfig": that is the environment (AGENTS.md). Report the gate up to here and leave the build to the operator.' },
];

/** @param {string[]} command @param {{ capture?: boolean, echo?: boolean }} [options] @returns {Promise<{ code: number, output: string }>} */
export function runCommand(command, { capture = false, echo = true } = {}) {
  return new Promise(resolve => {
    let output = '';
    const child = spawn(command[0], command.slice(1), { stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit' });
    if (capture) for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream?.on('data', chunk => { output += chunk; if (echo) sink.write(chunk); });
    }
    child.on('error', error => resolve({ code: 1, output: `${output}${error.message}\n` }));
    child.on('close', code => resolve({ code: code ?? 1, output }));
  });
}

// The same check CI ran on the same output: scripts/check-test-floor.mjs reads it from a file.
async function heldToFloor(output, run) {
  const directory = await mkdtemp(join(tmpdir(), 'saintpetrus-gate-'));
  try {
    const file = join(directory, 'test-output.txt'); await writeFile(file, output);
    return (await run([process.execPath, 'scripts/check-test-floor.mjs', file], {})).code === 0;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** @param {{ steps?: typeof gateSteps, run?: typeof runCommand, log?: (line: string) => void }} [options] */
export async function runGate({ steps = gateSteps, run = runCommand, log = line => console.log(line) } = {}) {
  for (const step of steps) {
    log(`\ngate: ${step.name}`);
    const result = await run(step.command, { capture: step.floor === true });
    // As CI's bash with pipefail: the run must pass and its output must hold the floor.
    const passed = (step.floor ? await heldToFloor(result.output, run) : true) && result.code === 0;
    if (!passed) { log(`\ngate: FAILED at ${step.name}.${step.onFailure ? ` ${step.onFailure}` : ''}`); return 1; }
  }
  log('\ngate: passed');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runGate();
