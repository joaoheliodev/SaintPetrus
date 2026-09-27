import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
// Remembered keys and the persisted graph belong to the operator's account, not to a checkout that can be copied,
// archived or pushed. An override must be absolute so it never resolves inside whatever directory the server runs from.
export function userDataDirectory(env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  const override = env.SAINTPETRUS_DATA_DIR;
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) throw new Error('SAINTPETRUS_DATA_DIR must be an absolute path.');
    return override;
  }
  if (platform === 'win32') return join(env.APPDATA && isAbsolute(env.APPDATA) ? env.APPDATA : join(home, 'AppData', 'Roaming'), 'SaintPetrus');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'SaintPetrus');
  return join(env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'saintpetrus');
}
export const vaultDirectory = () => join(userDataDirectory(), 'vault');
// Where earlier versions kept remembered keys: inside the checkout.
export const legacyVaultDirectory = (cwd = process.cwd()) => join(cwd, 'data', 'vault');
