import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [mode, ...extra] = process.argv.slice(2);
if (!['dev', 'start', 'build'].includes(mode) || extra.length) {
  console.error('Usage: npm run dev, npm start or npm run build. Set PORT if needed.');
  process.exit(1);
}
const port = process.env.PORT || '3000';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  console.error('PORT must be an integer from 1024 to 65535.');
  process.exit(1);
}
const args = [mode, ...(mode === 'build' ? ['--webpack'] : ['--hostname', '127.0.0.1', '--port', port])];
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...args], {
  stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
