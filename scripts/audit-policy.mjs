// The gate's audit step: `npm audit --audit-level=high`, judged here so that the one advisory the operator excepted
// (AGENTS.md, Operator decisions, 2026-10-06) does not fail it while every other high or critical advisory still does.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only the operator adds, renews or extends an entry. One lapses on its date, or as soon as a non-major fix exists.
export const auditExceptions = [
  { id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', until: '2026-10-20', why: 'no fixed release exists; only the shadcn CLI and ESLint run it, never the server' },
];
const blockingSeverities = ['high', 'critical'];

/**
 * @param {unknown} report the JSON of `npm audit --json`
 * @param {string} today YYYY-MM-DD, UTC
 * @param {typeof auditExceptions} [exceptions]
 */
export function auditVerdict(report, today, exceptions = auditExceptions) {
  const vulnerabilities = report !== null && typeof report === 'object' && !('error' in report) ? Reflect.get(report, 'vulnerabilities') : undefined;
  if (vulnerabilities === null || typeof vulnerabilities !== 'object') return { passed: false, reason: 'npm audit gave no report: the registry did not answer.', blocking: [], excepted: [] };
  const blocking = []; const excepted = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    // A fix within the declared ranges, or a minor one: the advisory is fixable, so no exception applies to it.
    const fixable = entry.fixAvailable === true || (entry.fixAvailable !== null && typeof entry.fixAvailable === 'object' && entry.fixAvailable.isSemVerMajor === false);
    // A string names a package this one is vulnerable through; that advisory is judged where it is its own.
    for (const advisory of entry.via ?? []) {
      if (advisory === null || typeof advisory !== 'object' || !blockingSeverities.includes(advisory.severity)) continue;
      const id = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(advisory.url ?? ''))?.[0] ?? String(advisory.source);
      const found = { id, package: advisory.name ?? name, severity: advisory.severity, title: String(advisory.title ?? ''), fixable };
      const exception = exceptions.find(item => item.id === id && item.package === found.package);
      if (exception && today <= exception.until && !fixable) excepted.push({ ...found, until: exception.until, why: exception.why });
      else blocking.push({ ...found, ...(exception ? { lapsed: fixable ? 'a fix exists, so its exception no longer applies' : `its exception lapsed after ${exception.until}` } : {}) });
    }
  }
  return { passed: blocking.length === 0, reason: blocking.length ? `${blocking.length} high or critical ${blocking.length === 1 ? 'advisory' : 'advisories'} without an exception.` : 'No high or critical advisory without an exception.', blocking, excepted };
}

// stdout only: npm writes its notices to stderr, and they are not JSON.
function auditJson() {
  const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm'];
  return new Promise(resolve => {
    let output = '';
    const child = spawn(npm[0], [...npm.slice(1), 'audit', '--audit-level=high', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => resolve(undefined));
    child.on('close', () => { try { resolve(JSON.parse(output)); } catch { resolve(undefined); } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verdict = auditVerdict(await auditJson(), new Date().toISOString().slice(0, 10));
  for (const item of verdict.excepted) console.log(`audit: excepted until ${item.until} by operator decision (AGENTS.md): ${item.id} ${item.severity} in ${item.package}, ${item.why}.`);
  for (const item of verdict.blocking) console.log(`audit: ${item.severity} ${item.id} in ${item.package}${item.title ? `: ${item.title}` : ''}${item.fixable ? ' (a fix is available: npm audit fix)' : ''}${item.lapsed ? `; ${item.lapsed}` : ''}`);
  console.log(`audit: ${verdict.reason}`);
  process.exitCode = verdict.passed ? 0 : 1;
}
