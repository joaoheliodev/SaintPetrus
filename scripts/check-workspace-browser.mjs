// Disposable Chromium smoke check of the main flow against a running local instance; never uses the user's profile.
// Start the app first, for example `PORT=3310 npm run dev`, then `TEST_APP_PORT=3310 npm run test:e2e`.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const port = Number(process.env.TEST_APP_PORT ?? 3310);
await mkdir('.audit', { recursive: true });
const profile = await mkdtemp('.audit/chromium-workspace-');
// Chromium refuses to start its sandbox as root (containers); this disposable browser only reaches 127.0.0.1.
const rootOnly = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const child = spawn(process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', [...rootOnly, '--headless', '--no-proxy-server', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
const problems = []; const dialogs = []; let documentHeaders;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/); if (match) resolve(match[1]); });
    child.on('error', reject); child.on('exit', () => reject(new Error('Disposable Chromium exited before debugger connected.')));
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  let sequence = 0; const pending = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  let session;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result); return; }
    const { method, params } = message;
    if (method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(params.entry.text)) problems.push(`CSP: ${params.entry.text}`);
    if (method === 'Runtime.exceptionThrown') problems.push(`Exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(`console.error: ${params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')}`);
    if (method === 'Network.responseReceived' && params.type === 'Document' && params.response.url.startsWith(`http://127.0.0.1:${port}/`)) documentHeaders = params.response.headers;
    // Destructive actions ask first; the smoke check accepts and records each question.
    if (method === 'Page.javascriptDialogOpening') { dialogs.push(params.message); void call('Page.handleJavaScriptDialog', { accept: true }, session); }
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await call('Target.attachToTarget', { targetId, flatten: true }));
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await call(`${domain}.enable`, {}, session);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (fn, label) => { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${label}`); };
  const click = text => evaluate(`(() => { const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!target) return false; target.click(); return true; })()`);
  const type = (selector, value) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await call('Page.navigate', { url: `http://127.0.0.1:${port}` }, session);
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 1 && document.body.textContent.includes('Coordinator')`), 'canvas with the coordinator');
  assert.ok(documentHeaders, 'the document response was observed');
  const header = name => Object.entries(documentHeaders).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
  assert.match(header('content-security-policy'), /frame-ancestors 'none'/); assert.equal(header('x-frame-options'), 'DENY');
  console.log('PASS: page rendered under the security headers');
  await until(() => click('Add agent'), 'Add agent button');
  await until(() => evaluate(`!!document.querySelector('[role=dialog] textarea')`), 'add agent dialog');
  await type('[role=dialog] input', 'Smoke agent'); await type('[role=dialog] textarea', 'Exercise the main flow in a real browser.');
  await until(() => click('Create agent'), 'Create agent button');
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 2`), 'second node on the canvas');
  console.log('PASS: agent created through the server');
  await until(() => evaluate(`document.querySelector('.inspector h2')?.textContent === 'Smoke agent'`), 'new agent selected in the inspector');
  await until(() => click('Edit name and objective'), 'edit button');
  await until(() => evaluate(`!!document.querySelector('form[aria-label="Edit agent"] input')`), 'edit form');
  await type('form[aria-label="Edit agent"] input', 'Renamed smoke agent');
  await until(() => click('Save'), 'save button');
  await until(() => evaluate(`Array.from(document.querySelectorAll('.react-flow__node h3')).some(h => h.textContent === 'Renamed smoke agent')`), 'renamed node card');
  console.log('PASS: agent edited through the server');
  const mocked = await evaluate(`!document.querySelector('.statusbar')?.textContent.includes('Mock disabled')`);
  await type('section[aria-label="Run this agent"] textarea', 'Say something short.');
  await until(() => click('Send (1 call)'), 'run button');
  const answer = await until(() => evaluate(`document.querySelector('section[aria-label="Run this agent"] [role=status]')?.textContent || ''`), 'run result');
  if (mocked) {
    assert.match(answer, /^Mock answer/);
    await until(() => evaluate(`(() => { const tab = Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent === 'Output'); tab?.click(); return document.querySelector('.inspector pre')?.textContent.startsWith('MOCK:'); })()`), 'answer recorded as the agent output');
    console.log('PASS: agent ran once through the mock and its output was recorded by the server');
  } else {
    assert.match(answer, /No provider is connected/);
    console.log('PASS: running without a provider explains what is missing');
  }
  await until(() => click('Tokens'), 'Tokens button');
  await until(() => evaluate(`document.body.textContent.includes('Budgets and consumption') && document.querySelectorAll('.token-table tbody tr').length > 0`), 'token table');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  console.log('PASS: token controls loaded from the server');
  await until(() => click('Connect AI'), 'Connect AI button');
  await until(() => evaluate(`document.body.textContent.includes('Keys go only to this local backend')`), 'connection panel');
  console.log('PASS: connection panel opened');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(problems, [], 'no CSP violation, uncaught exception or console error');
  console.log(`PASS: no CSP violations, exceptions or console errors${dialogs.length ? `; confirmations seen: ${dialogs.length}` : ''}.`);
} finally {
  clearTimeout(timeout); socket?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  await rm(profile, { recursive: true, force: true });
}
