// Command-line contract of the terminal key helper. It never takes the key itself: that is read hidden from the TTY.
// Providers match the backend credential store in lib/security/encrypted-vault.ts, which a test pins.
export const keyActions = ['set', 'disconnect', 'forget', 'restore'];
export const keyProviders = ['gemini', 'openai', 'deepseek', 'anthropic', 'openrouter'];
export const keyUsage = `Usage: npm run key -- ${keyActions.join('|')} ${keyProviders.join('|')} [--remember]`;
// Extra arguments are refused rather than ignored, so a key typed on the command line is never mistaken for accepted.
export function parseKeyArguments(argv) {
  const [action, provider, flag, ...extra] = argv;
  if (extra.length || !keyActions.includes(action) || !keyProviders.includes(provider)) return undefined;
  if (flag !== undefined && (flag !== '--remember' || action !== 'set')) return undefined;
  return { action, provider, remember: flag === '--remember' };
}
