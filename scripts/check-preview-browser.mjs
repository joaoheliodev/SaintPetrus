// Independent disposable Chromium test session; never accesses the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const port = Number(process.env.TEST_APP_PORT ?? 3210);
const profile = await mkdtemp('.audit/chromium-test-');
const child = spawn(process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
const timeout = setTimeout(() => child.kill('SIGTERM'), 45000);
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/); if (match) resolve(match[1]); });
    child.on('error', reject); child.on('exit', () => reject(new Error('Disposable Chromium exited before debugger connected.')));
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  let sequence = 0; const pending = new Map(); const contexts = new Map(); const logs = []; const navigations = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result); }
    if (message.method === 'Runtime.executionContextCreated') contexts.set(`${message.sessionId}:${message.params.context.id}`, { ...message.params.context, sessionId: message.sessionId });
    if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(`${message.sessionId}:${message.params.executionContextId}`);
    if (message.method === 'Log.entryAdded') logs.push(message.params.entry.text);
    if (message.method === 'Target.attachedToTarget') {
      const childSession = message.params.sessionId;
      for (const domain of ['Page', 'Runtime', 'Log']) void call(`${domain}.enable`, {}, childSession);
      void call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, childSession);
    }
    if (message.method === 'Page.frameNavigated') navigations.push(message.params.frame.url);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
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
  console.log('PASS: live updates, JS rendering, prior version/source, fetch blocked by CSP, navigation blocked by parent CSP, storage/parent inaccessible, allow-scripts only.');
} finally {
  clearTimeout(timeout); socket?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  await rm(profile, { recursive: true, force: true });
}
