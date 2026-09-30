import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PauseNotice, ResumeEligibleButton, type TokenSource } from '../components/token-panel';
import { AgentInspector } from '../components/agent-inspector';
import { ConfirmProvider } from '../components/confirm-dialog';
import { TokenService } from '../lib/tokens/service';
import type { Prices, TokenPolicy } from '../lib/tokens/config';
import { createGraph, type Agent } from '../lib/orchestrator';

// Fictitious policy for this test only; nothing is called.
const band = { inputCacheHitPerMillion: 0, inputCacheMissPerMillion: 0, outputPerMillion: 0 };
const policy: TokenPolicy = { global: 1000, perAgent: 1000, perModel: 1000, perSession: 1000, costLimitsUsd: { global: 1, perAgent: 1, perModel: 1, perSession: 1 }, cacheTtlMs: 0, reservationTtlMs: 100, models: { 'mock-v1': { provider: 'mock', max_tokens: 64, temperature: 0 } } };
const prices: Prices = { date: '2026-09-30', currency: 'USD', models: { 'mock-v1': { effectiveAt: '1970-01-01', verifiedAt: '1970-01-01', peakWindowsUtc: [], offPeak: band, peak: band } } };
const agents = [{ id: 'root', name: 'Coordinator' }, { id: 'a', name: 'Writer' }];
const source = (data: TokenSource['data'], resumeReply?: unknown): TokenSource => ({ data, error: '', pending: false, priceError: '', command: async () => true, resume: async () => true, resumeReply });
const service = () => new TokenService(policy, prices, { ids: () => ['root', 'a'], pause: () => {}, pauseAll: () => {} });
const render = (element: React.ReactElement) => renderToStaticMarkup(element);

test('R5-5 Resume eligible agents stands beside Pause all agents only while something is paused', () => {
  const tokens = service();
  assert.equal(render(React.createElement(ResumeEligibleButton, { tokens: source(tokens.snapshot()) })), '', 'nothing paused, no button');
  assert.equal(render(React.createElement(ResumeEligibleButton, { tokens: source(undefined) })), '', 'nor before the server answered');
  tokens.kill();
  assert.match(render(React.createElement(ResumeEligibleButton, { tokens: source(tokens.snapshot()) })), /<button[^>]*>Resume eligible agents<\/button>/);
});

test('R5-5 the notice under the top bar says what the last resume did and what holds each agent, and leads to Budgets', () => {
  const tokens = service();
  assert.equal(render(React.createElement(PauseNotice, { tokens: source(tokens.snapshot()), agents, open: () => {} })), '', 'silent while nothing is paused');
  tokens.kill();
  const paused = render(React.createElement(PauseNotice, { tokens: source(tokens.snapshot()), agents, open: () => {} }));
  assert.match(paused, /role="status" class="pause-notice"/);
  assert.match(paused, /<strong>Pause all agents is on, so every agent is paused\. Use Resume eligible agents to run them again\.<\/strong>/);
  assert.match(paused, /<button[^>]*>Open Budgets<\/button>/);
  tokens.setLimit('agent', 'a', 0); tokens.resume();
  const held = tokens.snapshot();
  const after = render(React.createElement(PauseNotice, { tokens: source(held, { resumed: ['root'], paused: held.paused }), agents, open: () => {} }));
  assert.match(after, /Resumed Coordinator\./); assert.match(after, /<strong>1 agent is paused\.<\/strong>/);
  assert.match(after, /Writer is paused: the agent budget for Writer is full in tokens\. Raise its limit in Details, then use Resume eligible agents\./);
});

test('R5-5 the panel of a Paused agent says why and opens Budgets; a Ready one says nothing of it', () => {
  const root = createGraph().agents[0];
  const panel = (agent: Agent) => render(React.createElement(ConfirmProvider, null, React.createElement(AgentInspector, { agent, agents: [agent], pending: false, command: async () => null, connect: async () => {}, pause: 'Coordinator is paused: Pause all agents is on. Use Resume eligible agents.', openBudgets: () => {} })));
  const paused = panel({ ...root, status: 'paused' });
  assert.match(paused, /class="inspector-pause" role="status"><p>Coordinator is paused: Pause all agents is on\. Use Resume eligible agents\.<\/p><button[^>]*>Open Budgets<\/button>/);
  assert.doesNotMatch(panel(root), /inspector-pause/);
});
