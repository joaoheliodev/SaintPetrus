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
const problems = []; const dialogs = []; const decisions = []; let documentHeaders;
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
    // Destructive actions ask first; the check records each question and answers from `decisions`, accepting by default.
    if (method === 'Page.javascriptDialogOpening') { dialogs.push(params.message); void call('Page.handleJavaScriptDialog', { accept: decisions.length ? decisions.shift() : true }, session); }
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
  // A real key press always ends with keyup; React Flow matches shortcuts against the keys still held.
  const press = async key => { for (const phase of ['keydown', 'keyup']) { await evaluate(`document.dispatchEvent(new KeyboardEvent('${phase}', { key: '${key}', code: '${key}', bubbles: true }))`); await new Promise(resolve => setTimeout(resolve, 150)); } };
  // Trusted key presses from the browser's own input pipeline, so Tab moves focus as it does for a person.
  const keyCodes = { Tab: 9, Enter: 13, Escape: 27, ArrowRight: 39 };
  const key = async name => { for (const type of ['rawKeyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: keyCodes[name] }, session); await new Promise(resolve => setTimeout(resolve, 120)); };
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
  const serverPosition = id => evaluate(`fetch('/api/graph', { cache: 'no-store' }).then(r => r.json()).then(g => g.agents.find(a => a.id === ${JSON.stringify(id)})?.position ?? null)`);
  const movedId = await evaluate(`Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.textContent.includes('Renamed smoke agent'))?.getAttribute('data-id')`);
  const start = await serverPosition(movedId);
  await evaluate(`document.querySelector('.react-flow__node[data-id="${movedId}"]').focus()`);
  await key('Enter');
  await until(() => evaluate(`document.querySelector('.react-flow__node[data-id="${movedId}"]')?.classList.contains('selected')`), 'card selected from the keyboard');
  for (let step = 0; step < 4; step++) await key('ArrowRight');
  await until(async () => (await serverPosition(movedId))?.x === start.x + 20, 'keyboard move saved by the server');
  console.log('PASS: a card moved with the arrow keys stays where it went');
  const grip = await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="${movedId}"] .agent-card-head').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, x, y) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, session);
  const dropped = await serverPosition(movedId);
  await mouse('mousePressed', grip.x, grip.y);
  for (let step = 1; step <= 5; step++) await mouse('mouseMoved', grip.x + step * 12, grip.y + step * 8);
  await mouse('mouseReleased', grip.x + 60, grip.y + 40);
  await until(async () => (await serverPosition(movedId))?.x > dropped.x + 10, 'mouse drag saved by the server');
  console.log('PASS: a dragged card is saved where it was dropped');
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
  const exported = await evaluate(`(async () => { const link = document.querySelector('a[href="/api/graph/export"][download]'); if (!link) return 'missing link'; const response = await fetch(link.href); const body = await response.json(); return response.status === 200 && Array.isArray(body.agents) ? 'ok' : 'bad export'; })()`);
  assert.equal(exported, 'ok');
  console.log('PASS: context export link downloads the server snapshot');
  await until(() => click('Tokens'), 'Tokens button');
  await until(() => evaluate(`document.body.textContent.includes('Budgets and consumption') && document.querySelectorAll('.token-table tbody tr').length > 0`), 'token table');
  assert.ok(await evaluate(`document.body.textContent.includes('No held or expired reservations.')`), 'empty reservation state is explicit');
  await press('Escape');
  console.log('PASS: token controls loaded from the server');
  await until(() => click('Connect AI'), 'Connect AI button');
  await until(() => evaluate(`document.body.textContent.includes('Keys go only to this local backend')`), 'connection panel');
  console.log('PASS: connection panel opened');
  await press('Escape');
  await until(() => evaluate(`!document.body.textContent.includes('Keys go only to this local backend')`), 'connection panel closed');
  const nodes = () => evaluate(`document.querySelectorAll('.react-flow__node').length`);
  const edges = () => evaluate(`document.querySelectorAll('.react-flow__edge').length`);
  await until(() => evaluate(`(() => { const item = Array.from(document.querySelectorAll('.agent-list-open')).find(b => b.textContent.includes('Coordinator')); item?.click(); return !!item; })()`), 'coordinator selected');
  await until(() => click('Add subagent'), 'Add subagent button');
  await until(() => evaluate(`!!document.querySelector('[role=dialog] textarea')`), 'add subagent dialog');
  await type('[role=dialog] textarea', 'A delegated subtask.');
  await until(() => click('Create subagent'), 'Create subagent button');
  await until(async () => await nodes() === 3 && await edges() === 1, 'subagent with its delegation edge');
  // Delete the connection from the keyboard: first refuse, then confirm.
  const edgeId = await evaluate(`document.querySelector('.react-flow__edge')?.getAttribute('data-id')`);
  const pressDelete = async () => { await evaluate(`document.querySelector('.react-flow__edge-path, .react-flow__edge-interaction')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await until(() => evaluate(`document.querySelector('.react-flow__edge.selected') !== null`), 'edge selected'); await press('Delete'); };
  decisions.push(false); await pressDelete(); await until(() => dialogs.some(text => text.startsWith('Delete the selected connection')), 'deletion question');
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await edges(), 1, 'a refused deletion keeps the connection');
  const asked = dialogs.length; await pressDelete(); await until(() => dialogs.length > asked, 'second deletion question');
  await until(async () => await edges() === 0, 'confirmed deletion');
  assert.ok(edgeId, 'the edge had an identity');
  console.log('PASS: connection deletion asks first and honours the answer');
  decisions.push(false); await until(() => click('Reset graph'), 'Reset graph button'); await until(() => dialogs.some(text => text.startsWith('Reset the graph?')), 'reset question');
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await nodes(), 3, 'a refused reset keeps the graph');
  await until(() => click('Reset graph'), 'Reset graph button'); await until(async () => await nodes() === 1, 'graph reset after confirmation');
  console.log('PASS: reset asks first and honours the answer');
  await until(() => click('Pause all agents'), 'Pause all agents button'); await until(() => dialogs.some(text => text.startsWith('Pause every agent?')), 'pause question');
  await until(() => evaluate(`document.querySelector('.react-flow__node .status')?.textContent.includes('Paused')`), 'agents paused');
  console.log('PASS: pause all asks first and pauses every agent');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(problems, [], 'no CSP violation, uncaught exception or console error');
  console.log(`PASS: no CSP violations, exceptions or console errors${dialogs.length ? `; confirmations seen: ${dialogs.length}` : ''}.`);
} finally {
  clearTimeout(timeout); socket?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  await rm(profile, { recursive: true, force: true });
}
