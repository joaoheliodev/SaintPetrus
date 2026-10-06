import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
// One line per sentence, however the file wraps it.
const flat = (text: string) => text.replace(/\s+/g, ' ');
const mitBody = (text: string) => flat(text.slice(text.indexOf('Permission is hereby granted')));
const grant = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction';
const asIs = 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED';
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;

test('R6-1 the repository is MIT licensed, copyright 2026 João Hélio dos Reis Souza, and says so where npm and GitHub read it (operator decision Q-06)', () => {
  const license = read('LICENSE');
  assert.ok(license.startsWith('MIT License\n'), 'GitHub reads the first line');
  assert.match(license, /^Copyright \(c\) 2026 João Hélio dos Reis Souza$/m);
  assert.ok(flat(license).includes(grant), 'the grant');
  assert.ok(flat(license).includes(asIs), 'and the "AS IS" disclaimer');
  assert.ok(license.endsWith('SOFTWARE.\n') && !license.includes('\r'), 'LF, one final newline');
  for (const path of ['package.json', 'lib/core/package.json']) assert.equal(JSON.parse(read(path)).license, 'MIT', path);
  const readme = read('README.md');
  assert.match(readme, /^## License$/m);
  assert.ok(readme.includes('[LICENSE](LICENSE)'), 'the README links the file');
});

test('R6-1 the components the shadcn CLI generated keep shadcn/ui\'s MIT notice, verbatim', () => {
  const notice = read('components/ui/LICENSE');
  assert.ok(notice.startsWith('MIT License\n'));
  assert.match(notice, /^Copyright \(c\) 2023 shadcn$/m);
  assert.equal(mitBody(notice), mitBody(read('LICENSE')), 'the same MIT terms');
  assert.ok(read('README.md').includes('[components/ui/LICENSE](components/ui/LICENSE)'), 'and the README says where it is');
});

test('R6-1 the files a visitor reads first publish no e-mail address', () => {
  for (const path of ['LICENSE', 'README.md', 'SECURITY.md', 'components/ui/LICENSE']) assert.doesNotMatch(read(path), email, path);
});
