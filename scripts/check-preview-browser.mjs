// Independent disposable Chromium test session; never accesses the user's browser profile.
import assert from 'node:assert/strict';
import { launchChromium } from './disposable-chromium.mjs';
const port = Number(process.env.TEST_APP_PORT ?? 3210);
const contexts = new Map(); const logs = []; const navigations = []; const dialogs = []; let sessionId;
const { call, close } = await launchChromium({ timeoutMs: 45000, onEvent: (message, send) => {
  if (message.method === 'Runtime.executionContextCreated') contexts.set(`${message.sessionId}:${message.params.context.id}`, { ...message.params.context, sessionId: message.sessionId });
  if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(`${message.sessionId}:${message.params.executionContextId}`);
  if (message.method === 'Log.entryAdded') logs.push(message.params.entry.text);
  if (message.method === 'Target.attachedToTarget') {
    const childSession = message.params.sessionId;
    for (const domain of ['Page', 'Runtime', 'Log']) send(`${domain}.enable`, {}, childSession).catch(() => {});
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, childSession).catch(() => {});
  }
  if (message.method === 'Page.frameNavigated') navigations.push(message.params.frame.url);
  // Running the preview mock replaces the graph, so the panel asks first; this disposable instance accepts.
  if (message.method === 'Page.javascriptDialogOpening') { dialogs.push(message.params.message); send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(() => {}); }
} });
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  for (const domain of ['Page', 'Runtime', 'Log']) await call(`${domain}.enable`, {}, sessionId);
  await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  const evaluate = async (expression, contextId) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId: contextId.id } : {}) }, (contextId && contextId.sessionId) || sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async fn => { for (let i = 0; i < 80; i++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Browser assertion timed out.'); };
  await call('Page.navigate', { url: `http://127.0.0.1:${port}` }, sessionId);
  await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Run preview mock')`));
  await until(() => evaluate(`document.querySelector('header [role=status]')?.textContent.includes('Configured')`));
  const baseline = await evaluate(`Number(document.querySelector('[aria-label="Artifact preview"]').textContent.match(/Version: (\\d+)/)?.[1] ?? 0)`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Run preview mock').click()`);
  await until(() => evaluate(`Number(document.querySelector('[aria-label="Artifact preview"]')?.textContent.match(/Version: (\\d+)/)?.[1] ?? 0) >= ${baseline + 3}`));
  await new Promise(resolve => setTimeout(resolve, 500));
  const context = await until(async () => {
    for (const ctx of contexts.values()) {
      if (!ctx.auxData?.isDefault) continue;
      try { if (await evaluate('!!document.getElementById("network")', ctx)) return ctx; } catch { /* A replaced version invalidates its context. */ }
    }
    return undefined;
  });
  assert.equal(await evaluate('document.body.dataset.generated', context), 'yes');
  console.log('PASS: versions and generated script rendered');
  await evaluate('probe()', context);
  assert.equal(await evaluate('document.getElementById("network").textContent', context), 'Network blocked');
  assert.ok(logs.some(text => text.includes('connect-src')), 'CSP blocked fetch, not merely a failed server');
  assert.equal(await evaluate('try { localStorage.length; "accessible" } catch { "blocked" }', context), 'blocked');
  assert.equal(await evaluate('try { document.cookie; "accessible" } catch { "blocked" }', context), 'blocked');
  assert.equal(await evaluate('try { parent.document.body; "accessible" } catch { "blocked" }', context), 'blocked');
  console.log('PASS: fetch blocked by CSP');
  await evaluate('navigateProbe()', context);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(logs.some(text => text.includes('frame-src')), 'Parent CSP blocked self-navigation');
  assert.ok(!navigations.some(url => url.includes('/api/graph')), 'No backend navigation committed');
  console.log('PASS: self-navigation blocked');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Previous version').click()`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Artifact preview"]').textContent.includes('Version: ${baseline + 2}')`));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Show source').click()`);
  assert.ok(await evaluate(`document.querySelector('.artifact-preview pre').textContent.includes('Stage two')`));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Run preview mock').click()`);
  await until(() => evaluate(`Array.from(document.querySelectorAll('[aria-label="Artifact preview"] select option')).some(o=>Number(o.value)>=${baseline + 6})`));
  assert.ok(await evaluate(`document.querySelector('[aria-label="Artifact preview"]').textContent.includes('Version: ${baseline + 2}')`), 'Paused view stays on historical version despite new events');
  assert.equal(await evaluate(`document.querySelector('iframe').getAttribute('sandbox')`), 'allow-scripts');
  assert.ok(dialogs.length >= 2 && dialogs.every(text => text.startsWith('Run the preview mock?')), 'each run asked before replacing the graph');
  console.log('PASS: live updates, JS rendering, prior version/source, fetch blocked by CSP, navigation blocked by parent CSP, storage/parent inaccessible, allow-scripts only.');
} finally { await close(); }
