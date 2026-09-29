import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentInspector } from '../components/agent-inspector';
import { createGraph } from '../lib/orchestrator';

test('F3 the inspector renders the server agent as text and offers an edit, not a form, until asked', () => {
  const agent = { ...createGraph().agents[0], name: '<img src=x onerror=alert(1)>', context: { objective: 'Objective <b>text</b>', summary: 'Summary', artifacts: [] } };
  const markup = renderToStaticMarkup(React.createElement(AgentInspector, { agent, agents: [agent], pending: false, command: async () => null, connect: async () => {} }));
  assert.match(markup, /aria-label="Agent inspector"/);
  assert.match(markup, /Edit name and objective/);
  assert.doesNotMatch(markup, /aria-label="Edit agent"/, 'the edit form opens only on request');
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;') && !markup.includes('<img src=x'), 'agent text is escaped, never HTML');
  assert.ok(markup.includes('Objective &lt;b&gt;text&lt;/b&gt;'));
});

test('Q3 the inspector offers a keyboard path to connect the selected agent to any other, never to itself', () => {
  const [root] = createGraph().agents;
  const others = [{ id: 'writer', name: 'Writer <b>' }, { id: 'critic', name: 'Critic' }];
  const render = (agents: { id: string; name: string }[]) => renderToStaticMarkup(React.createElement(AgentInspector, { agent: root, agents: [root, ...agents], pending: false, command: async () => null, connect: async () => {} }));
  const markup = render(others);
  const section = markup.slice(markup.indexOf('aria-label="Connect this agent"'));
  assert.ok(section.includes('<label>Connect to<select'), 'the list is labelled');
  assert.deepEqual([...section.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]), ['', 'writer', 'critic'], 'every other agent, and not the selected one');
  assert.ok(section.includes('Writer &lt;b&gt;'), 'names are text');
  assert.match(section, /<button[^>]*disabled=""[^>]*>.*Connect<\/button>/, 'nothing is sent until a target is chosen');
  assert.match(render([]), /<select disabled=""/, 'with no other agent there is nothing to pick');
});

test('R1 the panel says which actions call a provider, and a busy proxy is not reported as a budget refusal', async () => {
  const { verificationMessage } = await import('../components/provider-status');
  assert.match(verificationMessage(409, 'busy'), /still running/);
  assert.notEqual(verificationMessage(409, 'busy'), verificationMessage(409), 'busy is not the budget or policy refusal');
  const workspace = await (await import('node:fs/promises')).readFile('components/workspace.tsx', 'utf8');
  assert.ok(!workspace.includes('No API calls to LLMs'), 'Run once can call a real provider, so the panel must not deny it');
  assert.match(workspace, /Only Run once and connection tests call a provider/);
});
