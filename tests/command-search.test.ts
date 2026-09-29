import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterCommands, isPaletteShortcut } from '../lib/command-search';

const commands = [
  { id: 'a', label: 'Go to Budgets', group: 'View' },
  { id: 'b', label: 'Reset graph…', group: 'Graph', disabled: true },
  { id: 'c', label: 'Open Budget writer', group: 'Agent' },
  { id: 'd', label: 'Load demo…', group: 'Graph' },
];

test('U9 the palette keeps every word typed, in any case, and never offers a disabled action', () => {
  assert.deepEqual(filterCommands(commands, '').map(item => item.id), ['a', 'c', 'd'], 'disabled actions are not offered');
  assert.deepEqual(filterCommands(commands, 'budget').map(item => item.id), ['a', 'c'], 'the list keeps its order');
  assert.deepEqual(filterCommands(commands, 'AGENT budg').map(item => item.id), ['c'], 'group names match too');
  assert.deepEqual(filterCommands(commands, 'reset').map(item => item.id), []);
});

test('U9 Ctrl+K or Cmd+K opens it, nothing else', () => {
  const key = (fields: Partial<KeyboardEvent>) => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...fields });
  assert.ok(isPaletteShortcut(key({ ctrlKey: true }))); assert.ok(isPaletteShortcut(key({ metaKey: true, key: 'K' })));
  assert.ok(!isPaletteShortcut(key({}))); assert.ok(!isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }))); assert.ok(!isPaletteShortcut(key({ ctrlKey: true, key: 'j' })));
});

test('U9 each palette entry calls the same handler as its button, confirmations included', async () => {
  const workspace = await readFile('components/workspace.tsx', 'utf8');
  for (const call of ["run: () => void loadDemo()", "run: () => void loadPreviewDemo()", "run: () => void askToPauseAll(tokens.command, confirm)", "run: () => importInput.current?.click()", "run: () => { setView('workspace'); setResetOpen(true); }"]) assert.ok(workspace.includes(call), call);
  assert.match(workspace, /aria-keyshortcuts="Control\+K"><Search \/>Commands<kbd>Ctrl K<\/kbd>/, 'the shortcut is visible in the top bar');
  assert.match(await readFile('components/token-panel.tsx', 'utf8'), /onClick=\{\(\) => void askToPauseAll\(command, confirm\)\}>Pause all agents</);
});
