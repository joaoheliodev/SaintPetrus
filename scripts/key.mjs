// Terminal-only credential entry: no browser form, argv secret or shell-history secret.
import { stdin, stdout } from 'node:process';
const [action, provider, flag] = process.argv.slice(2);
if (!['set', 'disconnect', 'forget', 'restore'].includes(action) || !['gemini', 'openai', 'anthropic', 'openrouter'].includes(provider) || (flag && flag !== '--remember') || (flag && action !== 'set')) {
  console.error('Usage: npm run key -- set|disconnect|forget|restore gemini|openai|anthropic|openrouter [--remember]'); process.exit(1);
}
const port = process.env.PORT || '3000';
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) { console.error('Invalid PORT.'); process.exit(1); }
async function readSecret() {
  if (!stdin.isTTY) throw new Error('Use an interactive terminal.');
  stdout.write('Provider key (hidden; never paste it into chat): '); stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', receive); stdout.write('\n'); };
    const receive = chunk => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { value = ''; cleanup(); reject(new Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value); value = ''; return; }
        if (character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 4096) value += character;
      }
    };
    stdin.on('data', receive);
  });
}
try {
  const body = { action, provider, remember: flag === '--remember' };
  if (action === 'set') body.key = await readSecret();
  const origin = `http://127.0.0.1:${port}`;
  const result = await fetch(`${origin}/api/credentials`, { method: 'POST', redirect: 'error', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'X-SaintPetrus-Client': 'terminal',
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  delete body.key;
  // Do not print response text or errors returned by an unexpected local service.
  if (!result.ok) throw new Error('Operation failed. Check server and unlocked OS keyring if remembering.');
  console.log('Credential operation completed. No credential value returned.');
} catch { console.error('Credential operation failed or cancelled. No credential value logged.'); process.exitCode = 1; }
