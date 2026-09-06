# Security policy

## Reporting and revocation

Use GitHub private vulnerability reporting when available. Otherwise request a
private channel from the maintainer without posting sensitive details publicly.
Never attach keys, cookies, unredacted transcripts or screenshots to issues.

If a credential leaks: revoke it with the provider FIRST; review usage; then
coordinate history cleanup with maintainers. Renaming or changing repository
visibility does not remove history. Contributors must not rewrite shared history
without explicit authorization. This work does not rewrite or force-push history.

## Credentials

Keys are entered through `npm run key -- set openai` in an interactive local
terminal. Input is hidden, not accepted as argv, and sent to the loopback backend.
The browser has no key field and cannot invoke the credential-write endpoint.
Browser API responses contain connection status only. Do not put keys in URLs,
query strings, browser storage, shell commands or .env files. .env.example is a
placeholder reference, not a request to populate it with a real credential.

Default storage is backend memory only. `disconnect` clears registered buffers;
`forget` also removes persisted ciphertext. JavaScript strings and in-flight HTTP
library buffers cannot provide a secure-memory erasure guarantee; application
buffers are zeroed and references released on disconnect/completion.

`--remember` is explicit opt-in: AES-256-GCM with random salt and nonce, authenticated
provider identity, and HKDF-SHA-256 derivation from a random OS-protected master.
Linux uses Secret Service via libsecret's secret-tool; macOS uses Keychain via
security; Windows wraps the master with DPAPI CurrentUser. No plaintext fallback.
Keyring unavailable/locked means persistence fails. `restore` explicitly loads a
remembered key into memory. Neither build nor tests access the real OS keyring.
Native platform integration requires verification on each supported OS.

Ciphertext lives under ignored data/vault with restrictive file permissions where
supported. It is tied to the OS account/keyring and is not a portable backup.

## Local network and output boundaries

Launchers bind only 127.0.0.1 and reject override arguments. Next telemetry and
request logging are disabled. Do not run the scaffold through a public tunnel.
Host and Origin checks reject cross-origin/rebinding requests; no permissive CORS.
LLM connectivity is not part of M1. M2 permits only the configured provider route.

Application log, error, response and context-export serialization uses a shared
redactor for registered secrets and key-shaped strings. ESLint prohibits direct
console calls in application/server modules except the sanitizer. No raw provider
response body should be logged. Framework/native memory dumps are outside this
application-level guarantee; do not publish them without independent review.

## Contributor checks

Install Gitleaks on PATH and run npm run setup:hooks. The hook fails closed if the
tool is missing and rejects restricted staged paths even when forced into Git.
CI scans Git history and runs dependency auditing, lint, typecheck, tests and build.
No dependency installation occurs during the build; fonts are local system fonts.
Before committing/pushing, scan directory, history and staged content. Next.js
creates ephemeral encryption keys inside ignored .next during build/dev: stop the
servers and discard this generated directory before the final directory scan.
Never suppress a source finding to get a green scan.
