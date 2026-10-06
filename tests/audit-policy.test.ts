import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditExceptions, auditVerdict } from '../scripts/audit-policy.mjs';

// Synthetic `npm audit --json` reports in npm's shape; nothing here asks the registry.
type Fix = boolean | { name: string; version: string; isSemVerMajor: boolean };
const major: Fix = { name: 'shadcn', version: '1.0.0', isSemVerMajor: true };
const advisory = (name: string, id: string, severity: string) => ({ source: 1, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${id}`, severity, range: '<=3.0.3' });
const entry = (name: string, severity: string, via: unknown[], fixAvailable: Fix) => ({ name, severity, isDirect: false, via, effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable });
const report = (...entries: ReturnType<typeof entry>[]) => ({ auditReportVersion: 2, vulnerabilities: Object.fromEntries(entries.map(item => [item.name, item])), metadata: {} });
const braces = (fix: Fix = major) => entry('braces', 'high', [advisory('braces', 'GHSA-vfj7-8cjw-p6xm', 'high')], fix);
// Vulnerable only through braces: judged where the advisory is braces' own.
const micromatch = entry('micromatch', 'high', ['braces'], major);

test('R6-A braces\' advisory without a fixed release passes the audit through 2026-10-20, with what reaches it, and fails the day after', () => {
  const verdict = auditVerdict(report(braces(), micromatch), '2026-10-06');
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.excepted.map(item => [item.id, item.package, item.until]), [['GHSA-vfj7-8cjw-p6xm', 'braces', '2026-10-20']]);
  assert.equal(auditVerdict(report(braces(), micromatch), '2026-10-20').passed, true, 'the last day still holds');
  const lapsed = auditVerdict(report(braces(), micromatch), '2026-10-21');
  assert.equal(lapsed.passed, false, 'the day after, the gate fails again');
  assert.deepEqual(lapsed.blocking.map(item => [item.id, item.lapsed]), [['GHSA-vfj7-8cjw-p6xm', 'its exception lapsed after 2026-10-20']]);
});

test('R6-A a fix for braces ends its exception at once, whether in range or minor', () => {
  for (const fix of [true, { name: 'micromatch', version: '4.0.9', isSemVerMajor: false }] satisfies Fix[]) {
    const verdict = auditVerdict(report(braces(fix), micromatch), '2026-10-06');
    assert.equal(verdict.passed, false, JSON.stringify(fix));
    assert.equal(verdict.blocking[0]?.lapsed, 'a fix exists, so its exception no longer applies');
  }
});

test('R6-A every other high or critical advisory still fails the audit, braces\' own included, and moderate or low ones do not', () => {
  const proxy = entry('proxy-addr', 'critical', [advisory('proxy-addr', 'GHSA-jqcg-44mw-7w3h', 'critical')], true);
  const other = auditVerdict(report(braces(), proxy), '2026-10-06');
  assert.equal(other.passed, false);
  assert.deepEqual([other.blocking.map(item => item.package), other.excepted.map(item => item.package)], [['proxy-addr'], ['braces']]);
  // The exception names one advisory of one package: a second braces advisory, or the same id elsewhere, still blocks.
  const second = entry('braces', 'high', [advisory('braces', 'GHSA-vfj7-8cjw-p6xm', 'high'), advisory('braces', 'GHSA-aaaa-bbbb-cccc', 'high')], major);
  assert.deepEqual(auditVerdict(report(second), '2026-10-06').blocking.map(item => item.id), ['GHSA-aaaa-bbbb-cccc']);
  const elsewhere = entry('micromatch', 'high', [advisory('micromatch', 'GHSA-vfj7-8cjw-p6xm', 'high')], major);
  assert.deepEqual(auditVerdict(report(elsewhere), '2026-10-06').blocking.map(item => item.package), ['micromatch']);
  // As with --audit-level=high.
  const mild = entry('lodash', 'moderate', [advisory('lodash', 'GHSA-1111-2222-3333', 'moderate'), advisory('lodash', 'GHSA-4444-5555-6666', 'low')], true);
  assert.equal(auditVerdict(report(mild), '2026-10-06').passed, true);
  assert.equal(auditVerdict(report(), '2026-10-06').passed, true, 'a clean report passes');
});

test('R6-A no report fails the audit: the registry did not answer', () => {
  for (const nothing of [undefined, null, 'npm ERR!', {}, { error: { code: 'ENOTFOUND', summary: 'request failed' } }]) {
    const verdict = auditVerdict(nothing, '2026-10-06');
    assert.equal(verdict.passed, false, JSON.stringify(nothing));
    assert.match(verdict.reason, /registry did not answer/);
  }
});

test('R6-A the exceptions are the operator\'s: exactly one, for braces, until 2026-10-20', () => {
  assert.deepEqual(auditExceptions.map(({ id, package: name, until }) => ({ id, package: name, until })), [{ id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', until: '2026-10-20' }]);
  assert.match(auditExceptions[0].why, /no fixed release/);
});
