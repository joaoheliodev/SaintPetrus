import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentPlacement, agentRole, agentStatuses } from '../lib/agent-status';
import { AgentStatusBadge } from '../components/agent-status-badge';
import { connectionLabel } from '../components/provider-status';
import type { ProviderStatusSnapshot } from '../lib/providers/runtime';

test('U1 every agent status has its own label, icon and colour, so none depends on colour alone', () => {
  const entries = Object.entries(agentStatuses);
  assert.deepEqual(entries.map(([, value]) => value.label), ['Ready', 'Running', 'Completed', 'Paused', 'Blocked']);
  const fields: ('label' | 'icon' | 'tone')[] = ['label', 'icon', 'tone'];
  for (const field of fields) assert.equal(new Set(entries.map(([, value]) => value[field])).size, entries.length, `${field} is unique per status`);
  const blocked = renderToStaticMarkup(React.createElement(AgentStatusBadge, { status: 'blocked' }));
  assert.match(blocked, /class="status tone-red"/); assert.match(blocked, /<svg[^>]*aria-hidden="true"/); assert.match(blocked, />Blocked<\/span>$/);
  assert.notEqual(renderToStaticMarkup(React.createElement(AgentStatusBadge, { status: 'ready' })).match(/<svg[^>]*class="([^"]+)"/)?.[1], blocked.match(/<svg[^>]*class="([^"]+)"/)?.[1], 'Ready and Blocked draw different icons');
});

test('U1 roles and levels are written out', () => {
  assert.equal(agentRole({ id: 'root', parentId: null }), 'Coordinator');
  assert.equal(agentRole({ id: 'a', parentId: null }), 'Agent');
  assert.equal(agentRole({ id: 'b', parentId: 'a' }), 'Subagent');
  assert.equal(agentPlacement({ id: 'b', parentId: 'a', depth: 2 }), 'Subagent · level 2');
  assert.equal(agentPlacement({ id: 'root', parentId: null, depth: 0 }), 'Coordinator · level 0');
});

test('U1 the connection chip names what Run once uses and leaves MOCK or REAL to the mode badge', () => {
  const base: ProviderStatusSnapshot = { provider: 'mock', model: 'mock-v1', connected: true, mocked: true, mockAvailable: true, verified: true, state: 'verified', mode: 'mock' };
  assert.equal(connectionLabel(base), '● Connected · mock-v1');
  assert.equal(connectionLabel({ ...base, state: 'configured', verified: false }), '◐ Configured, not verified · mock-v1');
  assert.equal(connectionLabel({ ...base, provider: 'gemini', model: 'fictitious-model', mocked: false, mockAvailable: false, mode: 'real' }), '● Connected · gemini · fictitious-model');
  assert.equal(connectionLabel({ ...base, state: 'disconnected', connected: false, verified: false }), '○ Disconnected');
});

test('U1 cards and the inspector no longer show the graph file provider label', async () => {
  const [workspace, inspector] = await Promise.all(['components/workspace.tsx', 'components/agent-inspector.tsx'].map(path => readFile(path, 'utf8')));
  assert.doesNotMatch(workspace, /\{a\.provider\}|L\{a\.depth\}/);
  assert.doesNotMatch(inspector, /\{agent\.provider\}/);
  assert.match(workspace, /<AgentStatusBadge status=\{a\.status\} \/>/); assert.match(workspace, /agentPlacement\(a\)/);
});

// WCAG AA from the colour tokens themselves, so a palette edit that loses contrast fails here.
const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
const luminance = (hex: string) => [0, 1, 2].map(index => { const value = channel(hex, index); return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: string, b: string) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
test('U1 status colours reach 4.5:1 on every surface they sit on', async () => {
  const css = await readFile('app/globals.css', 'utf8');
  const token = (name: string) => { const value = css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1]; assert.ok(value, name); return value; };
  for (const tone of ['neutral', 'blue', 'green', 'amber', 'red']) for (const surface of ['background', 'card', 'accent']) {
    const ratio = contrast(token(`status-${tone}`), token(surface));
    assert.ok(ratio >= 4.5, `status-${tone} on ${surface}: ${ratio.toFixed(2)}`);
  }
});
