// Usage: node scripts/check-test-floor.mjs <file holding the output of npm test>
import { readFileSync } from 'node:fs';
import { testFloorProblems } from './test-floor.mjs';
const [file] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/check-test-floor.mjs <test output file>'); process.exit(2); }
const problems = testFloorProblems(readFileSync(file, 'utf8'), readFileSync('AGENTS.md', 'utf8'));
for (const problem of problems) console.error(problem);
if (problems.length) process.exit(1);
console.log('Test floor held: no failures, cancellations, skips or todos.');
