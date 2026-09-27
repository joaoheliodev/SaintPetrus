// Disposable Chromium smoke check of the main flow against a running local instance; never uses the user's profile.
// Start the app first, for example `PORT=3310 npm run dev`, then `TEST_APP_PORT=3310 npm run test:e2e`.
import assert from 'node:assert/strict';
import { launchChromium } from './disposable-chromium.mjs';
const port = Number(process.env.TEST_APP_PORT ?? 3310);
const problems = []; const dialogs = []; const decisions = []; let documentHeaders; let session;
const { call, close } = await launchChromium({ timeoutMs: 180000, onEvent: ({ method, params }, send) => {
  if (method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(params.entry.text)) problems.push(`CSP: ${params.entry.text}`);
  if (method === 'Runtime.exceptionThrown') problems.push(`Exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(`console.error: ${params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')}`);
  if (method === 'Network.responseReceived' && params.type === 'Document' && params.response.url.startsWith(`http://127.0.0.1:${port}/`)) documentHeaders = params.response.headers;
  // Destructive actions ask first; the check records each question and answers from `decisions`, accepting by default.
  if (method === 'Page.javascriptDialogOpening') { dialogs.push(params.message); send('Page.handleJavaScriptDialog', { accept: decisions.length ? decisions.shift() : true }, session).catch(() => {}); }
} });
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await call('Target.attachToTarget', { targetId, flatten: true }));
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await call(`${domain}.enable`, {}, session);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (fn, label) => { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${label}`); };
  // Graph-replacing actions live in the More menu: open it, then pick the item by its visible name.
  const menu = async text => {
    await until(() => click('More'), 'More menu');
    return until(() => evaluate(`(() => { const item = Array.from(document.querySelectorAll('[role=menuitem]')).find(i => i.textContent.trim() === ${JSON.stringify(text)} && !i.hasAttribute('data-disabled')); if (!item) return false; item.click(); return true; })()`), `${text} menu item`);
  };
  // The agent panel has a Run and a Details tab; a person switches before reaching what is on the other one.
  const tab = name => until(() => evaluate(`(() => { const item = Array.from(document.querySelectorAll('.inspector [role=tab]')).find(t => t.textContent.trim() === ${JSON.stringify(name)}); if (!item) return false; item.click(); return item.getAttribute('aria-selected') === 'true'; })()`), `${name} tab`);
  const click = text => evaluate(`(() => { const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!target) return false; target.click(); return true; })()`);
  // A real key press always ends with keyup; React Flow matches shortcuts against the keys still held.
  const press = async key => { for (const phase of ['keydown', 'keyup']) { await evaluate(`document.dispatchEvent(new KeyboardEvent('${phase}', { key: '${key}', code: '${key}', bubbles: true }))`); await new Promise(resolve => setTimeout(resolve, 150)); } };
  // Trusted key presses from the browser's own input pipeline, so Tab moves focus as it does for a person.
  const keyCodes = { Tab: 9, Enter: 13, Escape: 27, ArrowRight: 39, ArrowDown: 40 }; const keyText = { Enter: '\r' };
  const key = async name => {
    const base = { key: name, code: name, windowsVirtualKeyCode: keyCodes[name] };
    await call('Input.dispatchKeyEvent', keyText[name] ? { ...base, type: 'keyDown', text: keyText[name] } : { ...base, type: 'rawKeyDown' }, session);
    await call('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, session); await new Promise(resolve => setTimeout(resolve, 120));
  };
  // Every visible control needs a name a screen reader can announce.
  const unnamed = () => evaluate(`(() => {
    const visible = element => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const nameOf = element => {
      const label = element.getAttribute('aria-label')?.trim(); if (label) return label;
      const by = element.getAttribute('aria-labelledby'); if (by) { const text = by.split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (text) return text; }
      if (element.labels?.length) { const text = Array.from(element.labels).map(item => item.textContent).join(' ').trim(); if (text) return text; }
      if (element.matches('button, a, summary, [role=tab]')) { const text = element.textContent.trim(); if (text) return text; }
      return element.getAttribute('title')?.trim() ?? '';
    };
    return Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab]')).filter(visible).filter(element => !nameOf(element)).map(element => element.outerHTML.slice(0, 160));
  })()`);
  const type = (selector, value) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await call('Page.navigate', { url: `http://127.0.0.1:${port}` }, session);
  // This check clicks Send, resets the graph and pauses every agent: it runs only against a fresh instance that has
  // no keyed provider connected, so it can never make a real, billed call or destroy someone's work.
  await until(() => evaluate(`location.origin === 'http://127.0.0.1:${port}' && document.readyState === 'complete'`), 'page load');
  const guard = await evaluate(`(async () => { const provider = await (await fetch('/api/provider', { cache: 'no-store' })).json(); const graph = await (await fetch('/api/graph', { cache: 'no-store' })).json(); const tokens = await (await fetch('/api/tokens', { cache: 'no-store' })).json(); return { keyed: provider.connected === true && provider.mocked !== true, fresh: graph.agents.length === 1 && graph.edges.length === 0 && graph.status === 'idle' && graph.agents[0].status === 'ready' && tokens.stopped === false }; })()`);
  if (guard.keyed) throw new Error('Refusing to run: a keyed provider is connected and this check would send it a real, billed call. Start a fresh instance with the mock or without a key.');
  if (!guard.fresh) throw new Error('Refusing to run: this instance is not fresh (a graph, a paused agent or the kill switch), and this check resets the graph and pauses every agent. Start a fresh instance.');
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 1 && document.body.textContent.includes('Coordinator')`), 'canvas with the coordinator');
  assert.ok(documentHeaders, 'the document response was observed');
  const header = name => Object.entries(documentHeaders).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
  assert.match(header('content-security-policy'), /frame-ancestors 'none'/); assert.equal(header('x-frame-options'), 'DENY');
  console.log('PASS: page rendered under the security headers');
  assert.deepEqual(await unnamed(), [], 'main page controls are named');
  const firstSteps = () => evaluate(`document.querySelector('.first-steps h2')?.textContent ?? 'gone'`);
  assert.equal(await firstSteps(), 'First steps · 0 of 3', 'a fresh canvas starts with the checklist');
  await until(() => click('Add agent'), 'Add agent button');
  await until(() => evaluate(`!!document.querySelector('[role=dialog] textarea')`), 'add agent dialog');
  assert.deepEqual(await unnamed(), [], 'add agent dialog controls are named');
  await type('[role=dialog] input', 'Smoke agent'); await type('[role=dialog] textarea', 'Exercise the main flow in a real browser.');
  await until(() => click('Create agent'), 'Create agent button');
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 2`), 'second node on the canvas');
  await until(async () => await firstSteps() === 'First steps · 1 of 3', 'first step checked from the server graph');
  console.log('PASS: agent created through the server; first steps 1 of 3');
  await until(() => evaluate(`document.querySelector('.inspector h2')?.textContent === 'Smoke agent'`), 'new agent selected in the inspector');
  await tab('Details');
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
  const mocked = await evaluate(`document.querySelector('.mode-badge')?.textContent === 'MOCK'`);
  await tab('Run');
  await type('section[aria-label="Run this agent"] textarea', 'Say something short.');
  // Run once asks first with the server's quote: refuse once, then accept.
  decisions.push(false); await until(() => click('Send (1 call)'), 'run button');
  await until(() => dialogs.some(text => text.startsWith('Send one call to ') && text.includes(' tokens')), 'run question with the reserved maximum');
  await until(async () => await evaluate(`document.querySelector('section[aria-label="Run this agent"] [role=status]')?.textContent`) === 'Not sent.', 'declined run not sent');
  await until(() => click('Send (1 call)'), 'run button');
  const answer = await until(() => evaluate(`(text => text && text !== 'Not sent.' ? text : '')(document.querySelector('section[aria-label="Run this agent"] [role=status]')?.textContent)`), 'run result');
  if (mocked) {
    assert.match(answer, /^Mock answer/);
    // The message, the answer, its tokens, latency and cost sit together under the Send button.
    const exchange = await until(() => evaluate(`(() => { const box = document.querySelector('section[aria-label="Last exchange"]'); const facts = box?.querySelector('.exchange-facts')?.textContent ?? ''; return box && /\\$\\d/.test(facts) ? { message: box.querySelector('.exchange-message')?.textContent, answer: box.querySelector('.exchange-answer')?.textContent, facts } : null; })()`), 'last exchange with its cost');
    assert.equal(exchange.message, 'Say something short.'); assert.match(exchange.answer, /^MOCK:/); assert.match(exchange.facts, /\d+ tokens.* · \d+ ms · /);
    const recorded = await evaluate(`fetch('/api/graph', { cache: 'no-store' }).then(r => r.json()).then(g => g.agents.find(a => a.name === 'Renamed smoke agent')?.output ?? '')`);
    assert.match(recorded, /^MOCK:/, 'the server recorded the answer as the agent output');
    console.log(`PASS: agent ran once through the mock; the Run tab shows message, answer and "${exchange.facts}"`);
  } else {
    assert.match(answer, /No provider is connected/);
    console.log('PASS: running without a provider explains what is missing');
  }
  const exported = await evaluate(`(async () => { const link = document.querySelector('a[href="/api/graph/export"][download]'); if (!link) return 'missing link'; const response = await fetch(link.href); const body = await response.json(); return response.status === 200 && Array.isArray(body.agents) ? 'ok' : 'bad export'; })()`);
  assert.equal(exported, 'ok');
  console.log('PASS: graph export link downloads the server snapshot');
  // Budgets, Prices and Connection are views of the main column, reached from the sidebar; the canvas stays as it was.
  // The top-bar meter reads the same snapshot and leads to Budgets.
  assert.match(await until(() => evaluate(`document.querySelector('.budget-meter')?.textContent.match(/^Budget \\d+%/)?.[0]`), 'budget meter'), /^Budget \d+%/);
  await evaluate(`document.querySelector('.budget-meter').click()`);
  await until(() => evaluate(`document.body.textContent.includes('Budgets and consumption') && document.querySelectorAll('.token-table tbody tr').length > 0`), 'token table');
  assert.ok(await evaluate(`document.body.textContent.includes('No held or expired reservations.')`), 'empty reservation state is explicit');
  assert.match(await evaluate(`document.querySelector('.budget-status')?.textContent ?? ''`), /\w/, 'the summary says in a sentence how the budgets stand');
  assert.deepEqual(await unnamed(), [], 'budget controls are named');
  await until(() => click('Prices'), 'Prices view');
  await until(() => evaluate(`!!document.querySelector('form[aria-label="Add price validity"]')`), 'price form');
  assert.deepEqual(await unnamed(), [], 'price controls are named');
  console.log('PASS: budget and price controls loaded from the server');
  // Activity names each action for a person; the arrow-key and drag moves above are hidden until asked for.
  await until(() => click('Activity'), 'Activity view');
  await until(() => evaluate(`document.querySelector('.activity-view .activity-lines')?.textContent.includes('Agent created')`), 'activity lines');
  assert.equal(await evaluate(`document.querySelector('.activity-view .activity-lines').textContent.includes('Card moved')`), false, 'card moves hidden by default');
  await evaluate(`document.querySelector('.activity-view .activity-bar input').click()`);
  await until(() => evaluate(`document.querySelector('.activity-view .activity-lines').textContent.includes('Card moved')`), 'card moves shown on request');
  assert.deepEqual(await unnamed(), [], 'activity controls are named');
  console.log('PASS: Activity shows readable lines and hides card moves until asked');
  await until(() => click('Connection'), 'Connection view');
  await until(() => evaluate(`document.body.textContent.includes('Keys go only to this local backend') && document.body.textContent.includes('Optional features')`), 'connection view');
  assert.deepEqual(await unnamed(), [], 'connection controls are named');
  console.log('PASS: connection view opened');
  await until(() => click('Workspace'), 'Workspace view');
  await until(() => evaluate(`!document.body.textContent.includes('Keys go only to this local backend') && document.querySelectorAll('.react-flow__node').length === 2 && getComputedStyle(document.querySelector('.workspace-view')).visibility === 'visible'`), 'back on the canvas with its agents');
  const nodes = () => evaluate(`document.querySelectorAll('.react-flow__node').length`);
  const edges = () => evaluate(`document.querySelectorAll('.react-flow__edge').length`);
  await until(() => evaluate(`(() => { const item = Array.from(document.querySelectorAll('.agent-list-open')).find(b => b.textContent.includes('Coordinator')); item?.click(); return !!item; })()`), 'coordinator selected');
  await until(() => click('Add subagent'), 'Add subagent button');
  await until(() => evaluate(`!!document.querySelector('[role=dialog] textarea')`), 'add subagent dialog');
  await type('[role=dialog] textarea', 'A delegated subtask.');
  await until(() => click('Create subagent'), 'Create subagent button');
  await until(async () => await nodes() === 3 && await edges() === 1, 'subagent with its delegation edge');
  if (mocked) await until(async () => await firstSteps() === 'gone', 'checklist done once an agent was added, connected and run');
  // Delete the connection from the keyboard: first refuse, then confirm.
  const edgeId = await evaluate(`document.querySelector('.react-flow__edge')?.getAttribute('data-id')`);
  const pressDelete = async () => { await evaluate(`document.querySelector('.react-flow__edge-path, .react-flow__edge-interaction')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await until(() => evaluate(`document.querySelector('.react-flow__edge.selected') !== null`), 'edge selected'); await press('Delete'); };
  decisions.push(false); await pressDelete(); await until(() => dialogs.some(text => text.startsWith('Delete the selected connection')), 'deletion question');
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await edges(), 1, 'a refused deletion keeps the connection');
  const asked = dialogs.length; await pressDelete(); await until(() => dialogs.length > asked, 'second deletion question');
  await until(async () => await edges() === 0, 'confirmed deletion');
  assert.ok(edgeId, 'the edge had an identity');
  console.log('PASS: connection deletion asks first and honours the answer');
  // Connect two existing agents without a mouse: pick the target in the inspector, Tab to Connect, press Enter.
  await until(() => evaluate(`(() => { const item = Array.from(document.querySelectorAll('.agent-list-open')).find(b => b.textContent.includes('Renamed smoke agent')); item?.click(); return document.querySelector('.inspector h2')?.textContent === 'Renamed smoke agent'; })()`), 'smoke agent selected');
  await tab('Details');
  await evaluate(`document.querySelector('section[aria-label="Connect this agent"] select').focus()`);
  await key('ArrowDown');
  await until(() => evaluate(`document.querySelector('section[aria-label="Connect this agent"] select').value !== ''`), 'target chosen from the keyboard');
  await key('Tab'); assert.equal(await evaluate(`document.activeElement?.textContent`), 'Connect');
  await key('Enter');
  await until(async () => await edges() === 1, 'connection created from the keyboard');
  console.log('PASS: two agents connected from the keyboard');
  // Walk the whole page with Tab from a fresh load; every stop, cards and connections included, must show where focus is.
  await call('Page.reload', {}, session);
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 3 && document.querySelectorAll('.react-flow__edge').length === 1`), 'canvas after reload');
  const hidden = []; let stops = 0;
  for (; stops < 150; stops++) {
    await key('Tab');
    const focus = await evaluate(`(() => { const element = document.activeElement; if (!element || element === document.body || element.dataset.tabStop) return null; element.dataset.tabStop = 'seen'; if (element.localName === 'nextjs-portal') return { id: 'development overlay', shown: true }; const style = getComputedStyle(element); const path = element.matches('.react-flow__edge') ? element.querySelector('.react-flow__edge-path') : null; const shown = path ? parseFloat(getComputedStyle(path).strokeWidth) >= 3 : (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2) || style.boxShadow !== 'none'; return { id: element.outerHTML.slice(0, 160) + (shown ? '' : ' (override loaded: ' + Array.from(document.styleSheets).some(sheet => { try { return Array.from(sheet.cssRules).some(rule => rule.cssText.includes('react-flow__node-agent')); } catch { return false; } }) + ')'), shown }; })()`);
    if (!focus) break;
    if (!focus.shown) hidden.push(focus.id);
  }
  await evaluate(`document.querySelectorAll('[data-tab-stop]').forEach(element => delete element.dataset.tabStop)`);
  assert.ok(stops > 20, `Tab reached ${stops} stops`);
  assert.deepEqual(hidden, [], 'every focus stop is visible');
  console.log(`PASS: ${stops} Tab stops, each with a visible focus indicator`);
  if (mocked) {
    // The demo replaces the canvas: it is one menu away and asks first; refusing keeps every agent.
    decisions.push(false); await menu('Load demo…'); await until(() => dialogs.some(text => text.startsWith('Load the demo?')), 'load demo question');
    await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await nodes(), 3, 'a refused demo keeps the graph');
    console.log('PASS: the demo is behind a menu and a confirmation');
  }
  await menu('Reset graph…');
  await until(() => evaluate(`!!document.querySelector('[role=dialog] #objective') && document.body.textContent.includes('The objective the Coordinator receives when the graph is reset')`), 'reset dialog with the coordinator objective');
  decisions.push(false); await until(() => click('Reset graph'), 'Reset graph button'); await until(() => dialogs.some(text => text.startsWith('Reset the graph?')), 'reset question');
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await nodes(), 3, 'a refused reset keeps the graph');
  await until(() => click('Reset graph'), 'Reset graph button'); await until(async () => await nodes() === 1, 'graph reset after confirmation');
  console.log('PASS: reset asks first and honours the answer');
  await until(async () => await firstSteps() === 'First steps · 0 of 3', 'checklist back on a reset canvas');
  await until(() => click('Dismiss'), 'dismiss first steps'); await until(async () => await firstSteps() === 'gone', 'checklist dismissed');
  console.log('PASS: first steps follow the graph and can be dismissed');
  await until(() => click('Pause all agents'), 'Pause all agents button'); await until(() => dialogs.some(text => text.startsWith('Pause every agent?')), 'pause question');
  await until(() => evaluate(`document.querySelector('.react-flow__node .status')?.textContent.includes('Paused')`), 'agents paused');
  console.log('PASS: pause all asks first and pauses every agent');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(problems, [], 'no CSP violation, uncaught exception or console error');
  console.log(`PASS: no CSP violations, exceptions or console errors${dialogs.length ? `; confirmations seen: ${dialogs.length}` : ''}.`);
} finally { await close(); }
