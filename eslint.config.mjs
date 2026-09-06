import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals, ...nextTs,
  { files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'], ignores: ['lib/security/redact.ts'], rules: { 'no-console': 'error' } },
  globalIgnores(['.next/**', 'next-env.d.ts']),
]);
