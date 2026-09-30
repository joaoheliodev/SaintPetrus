# Security policy

## Reporting a vulnerability

Report privately. Use GitHub private vulnerability reporting on this repository (Security, then "Report a
vulnerability") when it is enabled. Otherwise write to **[SECURITY CONTACT: placeholder, to be provided by the
maintainer]** and wait for a private channel before sending details. Never attach keys, cookies, unredacted
transcripts or screenshots to a public issue.

## If a key leaks

Revoke it with the provider first, then review the provider's usage and billing for the period it was
exposed, then coordinate any history cleanup with the maintainers. Renaming the repository or changing its
visibility does not remove history, and contributors must not rewrite shared history without explicit
authorization. A key that reached a published commit is compromised even if the commit is later removed.

## Threat model

SaintPetrus is a single-user tool that runs on the operator's own machine. It protects two things above all:
provider keys, and the money a key can spend.

**Assets.** Provider API keys; the provider balance they draw on; the integrity of the operator's policy
(`config/token-policy.json`) and price table (`config/prices.json`), which decide what may be spent; and the
content of the graph (objectives, model answers, events, exports), which can hold whatever the operator typed.

**Trust boundaries and threats.**

| Boundary | Threat | Mitigation |
| --- | --- | --- |
| Other websites in the same browser | Cross-site requests to the local API, DNS rebinding, framing the panel to trick clicks | Loopback binding; Host check; every state-changing request needs the exact page Origin and a JSON content type; the credential route also needs a client header, plus same-origin Fetch Metadata from a browser; no CORS; `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| The browser page | A key left in the page or its storage | The key lives only in an uncontrolled password field until one POST; no browser storage reference exists in the code, pinned at zero by a test |
| Model output | Prompt injection, markup or script in answers, chain-of-thought echoing the prompt | Answers render as text, never HTML; reasoning text never enters events, previews, artifacts or the cache; generated code runs only in the isolated preview origin (see below); exports and events are redacted |
| Provider APIs | Rerouting to a dearer model, unknown usage shapes, error bodies echoing input, redirects, huge or slow responses | The served model is the price key and an unpriced one stays `unverifiable`; usage parsers fail closed and record only field names; error bodies are never read; redirects are refused; bodies are bounded; one call at a time with a timeout |
| The operator's budget | Concurrent calls passing the same ceiling, lost contact treated as free, underestimated input | Synchronous four-scope reservations at peak with no cache hits before any I/O; timeouts and 5xx never release the hold; expiry converts at the dearer of hold and eligible price; the first real call per provider is checked against the invoice |
| The public repository | A key committed by accident | Gitleaks in the pre-commit hook (fails closed) and in CI; restricted paths such as `data/` refused even when forced; `.env*` ignored; tests use generated synthetic material only |

**Out of scope, and residual risk.**

- **Other processes of the same OS account are trusted.** The local API authenticates browsers, not programs:
  any local process can send the right Host and Origin headers, configure a key and spend it. The same
  account can also read process memory and, through its own keyring, decrypt a remembered key. Do not run
  SaintPetrus on a shared account or expose its port through a tunnel or proxy.
- JavaScript cannot erase strings. The request header built for each provider call holds the key until
  garbage collection; application buffers are zeroed.
- Remembered keys are ciphertext in the operator's user data directory, readable by that OS account; anyone with
  the account and its keyring can decrypt them.
- The content security policy allows inline scripts because Next.js hydrates with them; a nonce-based policy
  is a possible later hardening.
- The preview sandbox isolates origin and network, not CPU or memory: a runaway script can freeze its tab.
- The input token count is approximate, so the ledger can undercount; that is why the first invoice matters.
- Keyring integration was exercised on Linux only; macOS and Windows paths are covered by test doubles.
- Dependencies are audited in CI (`npm audit --audit-level=high`) and installed from the lockfile; a
  compromised upstream package is outside what this project can detect.

## Credentials

Keys are entered through `npm run key -- set <provider>` in an interactive local
terminal. Input is hidden, not accepted as argv, and sent to the loopback backend.
Alternatively, the Connection view accepts a key in a transient password field. Only its
same-origin local configuration POST may carry that key. The field is cleared on
submission/close; it is never put in React state or browser storage. Completion
requests carry no key. Both UI configuration and terminal configuration are
validated by the backend; browser configuration requires same-origin Fetch Metadata.
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
remembered key into memory. Build and the automated suite do not access the real OS keyring. A separate
manual Linux roundtrip was verified with synthetic material; Windows/macOS
native execution remains unverified.
Native platform integration requires verification on each supported OS.

Ciphertext lives in `vault/` under the OS user data directory, never in the checkout: `~/.local/share/saintpetrus`
(or `$XDG_DATA_HOME/saintpetrus`) on Linux, `~/Library/Application Support/SaintPetrus` on macOS and
`%APPDATA%\SaintPetrus` on Windows; `SAINTPETRUS_DATA_DIR` overrides it with an absolute path. It is tied to the
OS account and keyring and is not a portable backup. Earlier versions kept it in `data/vault` inside the checkout;
at startup the server copies each file to the new place, verifies the copy byte for byte and only then deletes the
original. A file already present in the new place is never overwritten: the old copy stays and the server says so.

## Key lifecycle (audited 2026-09-27)

| Stage | Where the key is | How long | How it ends |
| --- | --- | --- | --- |
| UI entry | Uncontrolled password field; never React state or browser storage | Until submit or close | The field is cleared on both |
| Terminal entry | `npm run key -- set <provider>` reads hidden TTY input; argv and extra arguments are refused | Until the local POST is sent | Nothing is kept or printed |
| Transport | One loopback POST to `/api/credentials` with the exact Origin, JSON and a client header | One request | Body never logged or echoed |
| Backend memory | A `Buffer` per provider in `Credentials`, registered with the redactor | Until Disconnect, Forget key, a replacement key or process exit; there is no idle expiry | The buffer is zeroed |
| Each provider call | A `Buffer` copy handed to the adapter, then the request header string | One provider request | The copy is zeroed; the header string cannot be zeroed in JavaScript |
| Remembered (opt-in) | AES-256-GCM ciphertext in `vault/<provider>.json` under the OS user data directory; the master key stays in the OS keyring (on Windows, a DPAPI-wrapped master sits next to it) | Until forgotten | **Forget key** in Connect AI deletes the selected provider's file and clears its memory; `npm run key -- forget <provider>` does the same for any provider, including after a restart, when no key is in memory and the panel shows no saved copy |

The saved graph, `graph.json`, sits in the same user data directory with the same permissions, written through the
redactor like the export. It is read back at startup through the strict parser that checks an import, so a file
edited outside the app is untrusted input like any other: unknown fields, credential-shaped text, foreign
providers, oversize files and impossible graphs are refused, and a refused file is set aside, never overwritten.
When the store cannot write the graph, the local, read-only `GET /api/graph/persistence` and the warning under the
top bar give only the parser's own sentence (it names a field) or a fixed one, never the refused text or a path.
A key pasted into the graph before it was configured is taken out of the graph in memory when it is configured, and
the store saves the redacted copy at once; so the file stops holding it, and a later **Disconnect** or **Forget key**
cannot write it back. The live event feed redacts again as it sends, so an event retained from before the key was
configured does not repeat it. Copies the file system keeps of replaced blocks are outside what the app controls.

The accounting journal, `accounting.jsonl`, sits beside it with the same permissions (0700/0600). Each record is one
JSON line, synced before the change it records can take effect, and holds only IDs, counts, amounts, price versions,
verdicts and times: never a key, a prompt, an instruction or an answer. It is read back through a strict record
format. A record cut short by a stop is dropped; anything else unreadable moves the whole file aside as
`accounting-rejected-<time>.jsonl`, never overwritten, and real calls stay blocked until the operator starts a new
budget period, a manual action that is itself journaled. A failed write blocks real calls the same way, and a failure
before a call releases its hold before any provider I/O.

A legacy `data/` stays ignored by Git and refused by the pre-commit hook and CI's tracked-path
check, even when forced. The vault directory is kept at 0700 and each file at 0600 where the
platform supports it. There is no plaintext fallback: an unavailable keyring refuses persistence.
Disconnect clears memory only; Forget key also deletes the saved copy and cancels a call in
flight. A key never reaches browser storage, cookies, URLs, logs, API responses, events,
exports, receipts or the dispatch ledger.

## Local network and output boundaries

Launchers bind only 127.0.0.1 and reject override arguments. Next telemetry and
request logging are disabled. Do not run the scaffold through a public tunnel.
Host and Origin checks reject cross-origin/rebinding requests; no permissive CORS.
Every response of the main listener carries a Content Security Policy (only this origin,
no framing of the app, no plugins, no base or foreign form targets, connections to this
origin only, frames only for the isolated preview origin), `X-Frame-Options: DENY`,
`nosniff`, `no-referrer`, same-origin opener and resource policies and a Permissions-Policy.
Scripts keep `'unsafe-inline'` because Next hydrates with inline scripts, and development adds
`'unsafe-eval'` and its reload socket; a nonce-based policy is a possible later hardening.
`npm run test:e2e` checks the page against these headers in a disposable Chromium.
Provider traffic leaves only from the adapters, to each provider's fixed endpoint, and only
for the selected provider.

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
