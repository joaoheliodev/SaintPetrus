import { join } from 'node:path';
import { Credentials } from './credentials';
import { EncryptedVault } from './encrypted-vault';
import { OSKeyring } from './os-keyring';
const local = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials };
export function credentials() {
  if (!local.saintpetrusCredentials) {
    const directory = join(process.cwd(), 'data', 'vault');
    local.saintpetrusCredentials = new Credentials(new EncryptedVault(directory, new OSKeyring(directory)));
  }
  return local.saintpetrusCredentials;
}
