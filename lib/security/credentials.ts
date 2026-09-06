import { EncryptedVault, type ProviderId, providerId } from './encrypted-vault';
import { registerSecret } from './redact';
export class Credentials {
  private entries = new Map<ProviderId, { secret: Buffer; unregister: () => void; remembered: boolean }>();
  constructor(private readonly vault: EncryptedVault) {}
  async configure(provider: ProviderId, secret: Buffer, remember = false) {
    providerId(provider);
    if (!secret.length || secret.length > 4096 || /[\r\n\0]/.test(secret.toString())) throw new Error('Invalid credential.');
    // Persistence requires explicit opt-in. Failure never silently falls back to plaintext.
    if (remember) await this.vault.save(provider, secret); else await this.vault.forget(provider);
    this.disconnect(provider);
    const copy = Buffer.from(secret);
    this.entries.set(provider, { secret: copy, unregister: registerSecret(copy), remembered: remember });
  }
  async restore(provider: ProviderId) {
    const secret = await this.vault.load(provider);
    try { this.disconnect(provider); const copy = Buffer.from(secret); this.entries.set(provider, { secret: copy, unregister: registerSecret(copy), remembered: true }); }
    finally { secret.fill(0); }
  }
  disconnect(provider: ProviderId) {
    const entry = this.entries.get(provider); if (!entry) return;
    entry.unregister(); entry.secret.fill(0); this.entries.delete(provider);
  }
  async forget(provider: ProviderId) { this.disconnect(provider); await this.vault.forget(provider); }
  status(provider: ProviderId) { const entry = this.entries.get(provider); return { provider, connected: !!entry, remembered: entry?.remembered ?? false }; }
  async use<T>(provider: ProviderId, callback: (key: Buffer) => Promise<T>): Promise<T> {
    const entry = this.entries.get(provider); if (!entry) throw new Error('Provider not connected.');
    const copy = Buffer.from(entry.secret);
    try { return await callback(copy); } finally { copy.fill(0); }
  }
}
