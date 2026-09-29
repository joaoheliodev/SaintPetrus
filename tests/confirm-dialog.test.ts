import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmProvider, nextQuestion, splitQuestion, useConfirm, type ConfirmRequest } from '../components/confirm-dialog';

test('U8 a question becomes a title and its detail, without changing a word', () => {
  assert.deepEqual(splitQuestion('Reset the graph? Every agent except the coordinator is removed.'), { title: 'Reset the graph?', detail: 'Every agent except the coordinator is removed.' });
  assert.deepEqual(splitQuestion('Send one call to mock-v1? It reserves 80 tokens.'), { title: 'Send one call to mock-v1?', detail: 'It reserves 80 tokens.' });
  assert.deepEqual(splitQuestion('No question mark.'), { title: 'No question mark.', detail: '' });
});

test('U8 without the provider nothing can be confirmed, and a closed provider renders only its children', async () => {
  let ask: ((request: ConfirmRequest) => Promise<boolean>) | undefined;
  const Probe = () => { ask = useConfirm(); return React.createElement('p', null, 'child'); };
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(await ask?.({ message: 'Delete? Really.', confirmLabel: 'Delete' }), false);
  assert.equal(renderToStaticMarkup(React.createElement(ConfirmProvider, null, React.createElement(Probe))), '<p>child</p>');
  const answers: boolean[] = [];
  const first = { message: 'First?', confirmLabel: 'Go', resolve: (answer: boolean) => { answers.push(answer); } };
  const second = { message: 'Second?', confirmLabel: 'Go', resolve: () => {} };
  assert.equal(nextQuestion(first, second), second); assert.deepEqual(answers, [false], 'an unanswered question is refused when replaced');
  assert.equal(nextQuestion(null, first), first);
});

test('U8 no native dialog is left, and every confirmation keeps its question and names its action', async () => {
  const files = (await readdir('components')).filter(name => name.endsWith('.tsx')).map(name => `components/${name}`);
  const sources = await Promise.all(files.map(path => readFile(path, 'utf8')));
  for (const [index, source] of sources.entries()) assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/, files[index]);
  const all = sources.join('\n');
  for (const [question, label] of [
    ['Reset the graph?', 'Reset graph'], ['Load the demo?', 'Load demo'], ['Load the preview demo?', 'Load preview demo'],
    ['Import ${file.name}?', 'Import graph'], ['selected connections`}?', 'Delete'], ['Remove ${agent.name}?', 'Remove agent'],
    ['Disconnect the ${status?.provider ?? \'\'} key?', 'Disconnect'], ['Forget the ${status?.provider ?? \'\'} key?', 'Forget key'],
    ['Pause every agent?', 'Pause all agents'], ['Replace the expired estimate ${item.id}', 'Apply confirmed usage'], ['Add this price validity?', 'Add validity'],
  ]) {
    const at = all.indexOf(question); assert.ok(at > 0, question);
    assert.ok(all.slice(at, at + 400).includes(`confirmLabel: '${label}'`), `${question} → ${label}`);
  }
  assert.match(all, /confirm\(\{ message: runQuestion\(quoted\.data\?\.quote\), confirmLabel: 'Send \(1 call\)' \}\)/);
  assert.match(await readFile('components/confirm-dialog.tsx', 'utf8'), /initialFocus=\{cancel\}/, 'focus starts on Cancel');
});
