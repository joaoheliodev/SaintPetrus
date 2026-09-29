import { chmod, mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// Provider ciphertexts and the Windows DPAPI-wrapped master; anything else in the old directory is left alone.
const vaultFile = (name: string) => /^[a-z]+\.json$/.test(name) || name === 'master.dpapi';
export type VaultMigration = { moved: string[]; kept: string[] };
// Copy, verify, then delete: a key file leaves the checkout only once an identical copy exists in the new place. A name
// already present there is never overwritten; the old copy stays for the operator to compare and remove.
export async function migrateLegacyVault(legacy: string, target: string): Promise<VaultMigration> {
  let names: string[];
  try { names = (await readdir(legacy)).filter(vaultFile).sort(); }
  catch (error) { if (Reflect.get(Object(error), 'code') === 'ENOENT') return { moved: [], kept: [] }; throw error; }
  const moved: string[] = []; const kept: string[] = [];
  if (!names.length) return { moved, kept };
  await mkdir(target, { recursive: true, mode: 0o700 }); await chmod(target, 0o700);
  for (const name of names) {
    const source = join(legacy, name), destination = join(target, name);
    const bytes = await readFile(source);
    try { await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (Reflect.get(Object(error), 'code') === 'EEXIST') { kept.push(name); continue; } throw error; }
    const copy = await readFile(destination);
    if (!copy.equals(bytes)) { await unlink(destination); throw new Error('A remembered key file could not be verified after copying; the original was kept.'); }
    await unlink(source); moved.push(name);
  }
  await rmdir(legacy).catch(() => { /* Not empty: other files or a kept copy stay where they were. */ });
  return { moved, kept };
}
