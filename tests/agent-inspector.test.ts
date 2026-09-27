import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentInspector } from '../components/agent-inspector';
import { createGraph } from '../lib/orchestrator';

test('F3 the inspector renders the server agent as text and offers an edit, not a form, until asked', () => {
  const agent = { ...createGraph().agents[0], name: '<img src=x onerror=alert(1)>', context: { objective: 'Objective <b>text</b>', summary: 'Summary', artifacts: [] } };
  const markup = renderToStaticMarkup(React.createElement(AgentInspector, { agent, pending: false, command: async () => null }));
  assert.match(markup, /aria-label="Agent inspector"/);
  assert.match(markup, /Edit name and objective/);
  assert.doesNotMatch(markup, /aria-label="Edit agent"/, 'the edit form opens only on request');
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;') && !markup.includes('<img src=x'), 'agent text is escaped, never HTML');
  assert.ok(markup.includes('Objective &lt;b&gt;text&lt;/b&gt;'));
});
