// The suite may grow but never shrink or skip: AGENTS.md states the floor and CI holds every run to it.
const count = (output, name) => {
  const values = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
  return values.length ? Number(values.at(-1)[1]) : undefined;
};

export function testFloorProblems(output, agents) {
  const floor = agents.match(/It stands at (\d+) today\./)?.[1];
  if (!floor) return ['AGENTS.md does not state the test floor.'];
  const tests = count(output, 'tests');
  if (tests === undefined) return ['The test run printed no summary.'];
  const problems = [];
  if (tests < Number(floor)) problems.push(`${tests} tests ran, below the floor of ${floor}.`);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) {
    const value = count(output, name);
    if (value === undefined || value > 0) problems.push(`${name}: ${value ?? 'missing'}; it must be 0.`);
  }
  return problems;
}
