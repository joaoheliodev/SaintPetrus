import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals, ...nextTs,
  { files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'], ignores: ['lib/security/redact.ts'], rules: { 'no-console': 'error' } },
  // Preserve the external core byte-for-byte except documented import adaptation.
  { files: ['lib/core/dirty-context.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^topSig$' }] } },
  globalIgnores(['.next/**', 'next-env.d.ts']),
]);
