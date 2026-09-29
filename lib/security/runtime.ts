import { vaultDirectory } from '../server/user-data';
import { Credentials } from './credentials';
import { EncryptedVault } from './encrypted-vault';
import { OSKeyring } from './os-keyring';
const local = globalThis as typeof globalThis & { saintpetrusCredentials?: Credentials };
export function credentials() {
  if (!local.saintpetrusCredentials) {
    const directory = vaultDirectory();
    local.saintpetrusCredentials = new Credentials(new EncryptedVault(directory, new OSKeyring(directory)));
  }
  return local.saintpetrusCredentials;
}
