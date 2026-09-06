import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export interface Keyring { loadOrCreate(): Promise<Buffer>; }
export type ProviderId = 'openai' | 'anthropic' | 'openrouter';
export const providers: ProviderId[] = ['openai', 'anthropic', 'openrouter'];
export function providerId(value: unknown): ProviderId {
  if (typeof value !== 'string' || !providers.includes(value as ProviderId)) throw new Error('Unsupported provider.');
  return value as ProviderId;
}
export class EncryptedVault {
  constructor(private readonly directory: string, private readonly keyring: Keyring) {}
  private async key(salt: Buffer) {
    const master = await this.keyring.loadOrCreate();
    try { return Buffer.from(hkdfSync('sha256', master, salt, 'saintpetrus-vault-v1', 32)); }
    finally { master.fill(0); }
  }
  async save(provider: ProviderId, secret: Buffer) {
    providerId(provider); const salt = randomBytes(16), iv = randomBytes(12), key = await this.key(salt);
    const aad = Buffer.from(`saintpetrus:${provider}:1`);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
      const record = { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = join(this.directory, `${provider}.json`), temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 }); await rename(temporary, file);
    } finally { key.fill(0); }
  }
  async load(provider: ProviderId): Promise<Buffer> {
    providerId(provider);
    const record = JSON.parse(await readFile(join(this.directory, `${provider}.json`), 'utf8'));
    if (record.version !== 1) throw new Error('Unsupported vault version.');
    const key = await this.key(Buffer.from(record.salt, 'base64'));
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
      cipher.setAAD(Buffer.from(`saintpetrus:${provider}:1`)); cipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(record.ciphertext, 'base64')), cipher.final()]);
    } finally { key.fill(0); }
  }
  async forget(provider: ProviderId) {
    providerId(provider);
    await unlink(join(this.directory, `${provider}.json`)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}
