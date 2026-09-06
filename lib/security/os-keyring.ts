import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Keyring } from './encrypted-vault';
export class KeyringMissing extends Error {}
type Runner = (program: string, args: string[], input?: string) => Promise<string>;
export const runKeyringCommand: Runner = (program, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; let hasErrorOutput = false; const timer = setTimeout(() => { child.kill(); reject(new Error('OS keyring unavailable.')); }, 10000);
  child.stdout.on('data', data => { output += data.toString(); if (output.length > 16384) child.kill(); });
  child.stderr.on('data', () => { hasErrorOutput = true; }); // Never retain or log helper errors.
  child.on('error', () => { clearTimeout(timer); reject(new Error('OS keyring unavailable.')); });
  child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else if ((program === 'secret-tool' && args[0] === 'lookup' && code === 1 && !hasErrorOutput) || (program === 'security' && args[0] === 'find-generic-password' && code === 44)) reject(new KeyringMissing()); else reject(new Error('OS keyring unavailable.')); });
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
export class OSKeyring implements Keyring {
  constructor(private readonly directory: string, private readonly platform = process.platform, private readonly run: Runner = runKeyringCommand) {}
  async loadOrCreate(): Promise<Buffer> {
    let text: string;
    if (this.platform === 'linux') {
      text = await this.run('secret-tool', ['lookup', 'application', 'saintpetrus', 'purpose', 'vault-master']).catch(error => { if (error instanceof KeyringMissing) return ''; throw new Error('OS keyring unavailable; persistence refused.'); });
      if (!text) {
        const master = randomBytes(32);
        try { await this.run('secret-tool', ['store', '--label=SaintPetrus vault', 'application', 'saintpetrus', 'purpose', 'vault-master'], master.toString('base64')); return master; }
        catch { master.fill(0); throw new Error('OS keyring unavailable; persistence refused.'); }
      }
    } else if (this.platform === 'darwin') {
      text = await this.run('security', ['find-generic-password', '-a', 'local', '-s', 'SaintPetrus.vault', '-w']).catch(error => { if (error instanceof KeyringMissing) return ''; throw new Error('OS keyring unavailable; persistence refused.'); });
      if (!text) {
        const master = randomBytes(32);
        // Interactive stdin avoids placing key material in process arguments.
        try { await this.run('security', ['-i'], `add-generic-password -a local -s SaintPetrus.vault -w '${master.toString('base64')}'\n`); return master; }
        catch { master.fill(0); throw new Error('OS keyring unavailable; persistence refused.'); }
      }
    } else if (this.platform === 'win32') {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = join(this.directory, 'master.dpapi');
      let wrapped: string | null = null;
      try { wrapped = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('OS vault unavailable.'); }
      const method = wrapped ? 'Unprotect' : 'Protect';
      const master = wrapped ? null : randomBytes(32);
      const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
      try {
        const result = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], wrapped ?? master!.toString('base64'));
        if (master) { await writeFile(file, result, { mode: 0o600, flag: 'wx' }); return master; }
        text = result;
      } catch { master?.fill(0); throw new Error('OS keyring unavailable; persistence refused.'); }
    } else throw new Error('OS keyring not supported; persistence refused.');
    const key = Buffer.from(text, 'base64');
    if (key.length !== 32) { key.fill(0); throw new Error('Invalid OS keyring entry.'); }
    return key;
  }
}
