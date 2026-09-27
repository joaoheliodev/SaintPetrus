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
const args = mode === 'build' ? [require.resolve('next/dist/bin/next'), 'build', '--webpack'] : ['--import', 'tsx', 'scripts/server.ts', mode];
// Development starts with the keyless mock unless SAINTPETRUS_MOCK is set; start and build never get this default.
const child = spawn(process.execPath, args, {
  stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...(mode === 'dev' ? { SAINTPETRUS_MOCK_DEFAULT: 'true' } : {}) },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
