import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditExceptions, auditVerdict } from '../scripts/audit-policy.mjs';

// Synthetic `npm audit --json` reports in npm's shape; nothing here asks the registry.
type Fix = boolean | { name: string; version: string; isSemVerMajor: boolean };
const major: Fix = { name: 'shadcn', version: '1.0.0', isSemVerMajor: true };
const advisory = (name: string, id: string, severity: string) => ({ source: 1, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${id}`, severity, range: '<=4.0.7' });
const entry = (name: string, severity: string, via: unknown[], fixAvailable: Fix) => ({ name, severity, isDirect: false, via, effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable });
const report = (...entries: ReturnType<typeof entry>[]) => ({ auditReportVersion: 2, vulnerabilities: Object.fromEntries(entries.map(item => [item.name, item])), metadata: {} });
const picomatch = (fix: Fix = major) => entry('picomatch', 'high', [advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')], fix);
// Vulnerable only through picomatch: judged where the advisory is picomatch's own.
const micromatch = entry('micromatch', 'high', ['picomatch'], major);
const today = '2026-11-17';

test('R10-A picomatch\'s advisory without a fixed release passes the audit through 2026-12-17, with what reaches it, and fails the day after', () => {
  const verdict = auditVerdict(report(picomatch(), micromatch), today);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.excepted.map(item => [item.id, item.package, item.until]), [['GHSA-fc5q-39xc-vjpf', 'picomatch', '2026-12-17']]);
  assert.equal(auditVerdict(report(picomatch(), micromatch), '2026-12-17').passed, true, 'the last day still holds');
  const lapsed = auditVerdict(report(picomatch(), micromatch), '2026-12-18');
  assert.equal(lapsed.passed, false, 'the day after, the gate fails again');
  assert.deepEqual(lapsed.blocking.map(item => [item.id, item.lapsed]), [['GHSA-fc5q-39xc-vjpf', 'its exception lapsed after 2026-12-17']]);
});

test('R6-A a fix ends an exception at once, whether in range or minor', () => {
  for (const fix of [true, { name: 'picomatch', version: '4.0.8', isSemVerMajor: false }] satisfies Fix[]) {
    const verdict = auditVerdict(report(picomatch(fix), micromatch), today);
    assert.equal(verdict.passed, false, JSON.stringify(fix));
    assert.equal(verdict.blocking[0]?.lapsed, 'a fix exists, so its exception no longer applies');
  }
});

test('R6-A every other high or critical advisory still fails the audit, the excepted package\'s own included, and moderate or low ones do not', () => {
  const proxy = entry('proxy-addr', 'critical', [advisory('proxy-addr', 'GHSA-jqcg-44mw-7w3h', 'critical')], true);
  const other = auditVerdict(report(picomatch(), proxy), today);
  assert.equal(other.passed, false);
  assert.deepEqual([other.blocking.map(item => item.package), other.excepted.map(item => item.package)], [['proxy-addr'], ['picomatch']]);
  // The exception names one advisory of one package: a second picomatch advisory, or the same id elsewhere, still blocks.
  const second = entry('picomatch', 'high', [advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high'), advisory('picomatch', 'GHSA-aaaa-bbbb-cccc', 'high')], major);
  assert.deepEqual(auditVerdict(report(second), today).blocking.map(item => item.id), ['GHSA-aaaa-bbbb-cccc']);
  const elsewhere = entry('micromatch', 'high', [advisory('micromatch', 'GHSA-fc5q-39xc-vjpf', 'high')], major);
  assert.deepEqual(auditVerdict(report(elsewhere), today).blocking.map(item => item.package), ['micromatch']);
  // The braces exception was removed by the operator (2026-11-17): its advisory blocks again if it ever comes back.
  const braces = entry('braces', 'high', [advisory('braces', 'GHSA-vfj7-8cjw-p6xm', 'high')], major);
  assert.deepEqual(auditVerdict(report(braces), today).blocking.map(item => [item.package, item.id]), [['braces', 'GHSA-vfj7-8cjw-p6xm']]);
  // As with --audit-level=high.
  const mild = entry('lodash', 'moderate', [advisory('lodash', 'GHSA-1111-2222-3333', 'moderate'), advisory('lodash', 'GHSA-4444-5555-6666', 'low')], true);
  assert.equal(auditVerdict(report(mild), today).passed, true);
  assert.equal(auditVerdict(report(), today).passed, true, 'a clean report passes');
});

test('R6-A no report fails the audit: the registry did not answer', () => {
  for (const nothing of [undefined, null, 'npm ERR!', {}, { error: { code: 'ENOTFOUND', summary: 'request failed' } }]) {
    const verdict = auditVerdict(nothing, today);
    assert.equal(verdict.passed, false, JSON.stringify(nothing));
    assert.match(verdict.reason, /registry did not answer/);
  }
});

test('R10-A the exceptions are the operator\'s: exactly one, for picomatch, until 2026-12-17', () => {
  assert.deepEqual(auditExceptions.map(({ id, package: name, until }) => ({ id, package: name, until })), [{ id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', until: '2026-12-17' }]);
  assert.match(auditExceptions[0].why, /no fixed release/);
});
