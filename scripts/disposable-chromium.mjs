// A throwaway headless Chromium for the browser checks: a fresh profile under the OS temporary directory, loopback
// only, never the user's browser or profile, and removed afterwards even when Chromium dies or the run is interrupted.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

export async function launchChromium({ timeoutMs, onEvent = () => {} }) {
  const profile = await mkdtemp(join(tmpdir(), 'saintpetrus-chromium-'));
  // Chromium refuses to start its sandbox as root (containers); this disposable browser only reaches 127.0.0.1.
  const rootOnly = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const child = spawn(process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', [...rootOnly, '--headless', '--no-proxy-server', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const pending = new Map(); let sequence = 0; let socket;
  // A call that can never be answered must fail, or the run would hang past its own cleanup.
  const failPending = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('exit', () => failPending(new Error('Disposable Chromium exited.')));
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const interrupt = () => { child.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); process.exit(130); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const close = async () => {
    clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    socket?.close(); child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
    await rm(profile, { recursive: true, force: true });
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error('Browser connection closed.')); return; }
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      child.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/); if (match) resolve(match[1]); });
      child.on('error', reject); child.on('exit', () => reject(new Error('Disposable Chromium exited before debugger connected.')));
    });
    socket = new WebSocket(endpoint); await once(socket, 'open');
  } catch (error) { await close(); throw error; }
  socket.addEventListener('close', () => failPending(new Error('Browser connection closed.')));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) { onEvent(message, call); return; }
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error.message)); else request?.resolve(message.result);
  });
  return { call, close };
}
