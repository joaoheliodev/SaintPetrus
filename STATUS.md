# SaintPetrus — current status

Branch: `night/provider-validation-ready`, continuing `night/provider-validation` from the operator's price-admin commit `0662647` on `night/price-admin`, following `night/price-schema`. Remote repository: `joaoheliodev/SaintPetrus`. Permanent rules live in `AGENTS.md`; timestamped events live in the append-only `NIGHT-LOG.md`.

## Verification checkpoint (2026-09-27)

Run in a cloud session without any API key: lint, both typechecks, the full suite at the floor stated in
`AGENTS.md` (463 tests at the end of the UI round) with zero failures or skips, and `npm run build` passed before
every commit of the finishing session. After a fresh `npm ci`, `npm audit` reported 0 vulnerabilities and the
keyless `npm run dev` main flow passed the browser check. `npm run test:e2e` passed in development and in
production and `npm run test:browser` passed. Gitleaks found nothing in the staged diff of any commit, in the
working directory, in the branch range `0662647..HEAD` or in the full history. CI passed on every push of
the branch (40 runs). Two independent reviewer agents audited `0662647..HEAD`; their findings and dispositions are in
`.prompts/FINISH-BACKLOG.md`. No provider request was made, including `GET /models`.

## Delivered

- **Workspace, credentials and proxy (M0–M2, RF-01).** Loopback server, memory-only credentials with opt-in OS-keyring encryption, and a provider proxy that owns the timeout, the single active request and redaction.
- **Core integration.** The §5.4 detectors and the RF-07 handoff come from `lib/core`, which typechecks on its own.
- **Token and USD budgets (RF-06).** Global, agent, model and session scopes. Preflight reserves at peak with no cache hits before provider I/O, reconciliation prices the served model with the reported cache split, and unresolved reservations expire into conservative usage that accepts manual reconciliation.
- **Event feed and artifact preview.** Both off by default (`SAINTPETRUS_FEED`, `SAINTPETRUS_PREVIEW`). The preview runs generated code in a script-only sandbox under CSP; its Chromium isolation check passed on 2026-09-07 and is reproducible with `npm run test:browser`.
- **Providers.** OpenAI Responses, Gemini `generateContent`, DeepSeek with its own adapter and strict usage parser, and the mock. Status mapping lives in each adapter, thinking capabilities in one table, and chain of thought stays out of context, events, previews and artifacts.
- **Repository discipline (Orca O1–O5).** `AGENTS.md`, ratchet tests, exhaustive `unbilled | billed | unverifiable` verdicts, one server owner per state and anchored reference decisions.
- **Price schema.** Optional `expiresAt` with a preflight horizon covering the reservation TTL (P1); the enforced total `costAccountedUsd` named apart from its unmeasured part `costUnmeasuredUsd` (P2).
- **Provider-scoped expiry floor (P3).** Implemented: capture the validated provider and tariff candidates; narrow only when every usable candidate has price-side provider metadata, otherwise retain the global floor. Charge at least the original hold in all four scopes. Request allowlisting does not remove price-only reroute candidates.
- **Round C.** Orphan permanent rules moved into `AGENTS.md`, local refusal verdicts proven unreachable with a live reservation, and the deferred price dimensions and first real call protocol documented.
- **Finishing session (2026-09-27).** Served-model price keys for Gemini and OpenAI; an unpriced served model stays `unverifiable`; unreadable usage names its fields; per-call receipts (`GET /api/receipts`) and an upstream dispatch counter; a startup-only validation timeout; DeepSeek in the terminal key helper; an empty probe never verifies. Forget key in the panel; a content security policy on every response. The panel works keyless in `npm run dev`; agents can be edited, run once and connected from the keyboard; destructive actions ask first; keyboard moves are saved; focus and field contrast meet WCAG AA. README, `docs/architecture.md`, the `SECURITY.md` threat model and `CHANGELOG.md` rewritten or added; CI holds the test floor. The review then fixed a regression of this branch in which the running app lost every provider failure's code (the custom server and the routes hold separate copies of the modules; failures now carry a `Symbol.for` brand), graph refusals that lost their message for the same reason, a browser check that could have made a real call, settled calls that could be failed again, lax OpenAI usage parsing and a verification race. The backlog, decisions and questions for the operator live in `.prompts/FINISH-BACKLOG.md`.

## Operator decisions Q-01 to Q-10 (2026-09-27)

- **Q-01** The mock is the default in every mode; `SAINTPETRUS_MODE=real` opts into real providers at startup and is
  pinned for the process. The header always shows MOCK or REAL. The retired `SAINTPETRUS_MOCK*` variables stop startup.
- **Q-02** Nothing implemented, as answered.
- **Q-03** An agent can be removed after a confirmation, never while it holds an in-flight, unverifiable or
  unreconciled reservation; its accounting rows stay, marked as a removed agent.
- **Q-04** The graph is saved in the user data directory and restored at startup; import is untrusted input (strict
  format, 4 MiB, unknown fields and credential-shaped text refused, no model in the format). The export stays
  redacted; accounting stayed process-local until R-02.
- **Q-05, Q-06** No answer, so the security contact stays a marked placeholder and there is no LICENSE.
- **Q-07** OpenAI is out of the allowlist and not offered until validated; no snapshot or price was added.
- **Q-08** Remembered keys moved to the user data directory (0700/0600); a legacy `data/vault` is copied, verified
  byte for byte and only then deleted, at startup.
- **Q-09** Run once stays and asks first with the server's quote of the most it reserves, from the same checks.
- **Q-10** An unpriced served model's expiry converts at the greater of estimate and reported usage per dimension,
  at least at the requested model's peak, cache-miss rate; the agent waits for manual reconciliation.

## UI round (2026-09-27)

Presentation only (no route, contract, file format, accounting, payload, configuration, mode, header or CSP
change): a sidebar of views, a top bar with the connection chip, budget meter, Ctrl+K palette and Pause all; one
interface vocabulary (`AGENTS.md`); an agent panel whose Run tab shows message, answer, tokens, latency and the
server-accounted cost together; Budgets with a summary and the way out of a block; a readable Activity log; a First
steps bar; in-app confirmations opening on Cancel; the demo and every graph replacement behind the More menu. Open
questions are in `.prompts/FINISH-BACKLOG.md` (Phase 8, "Questions for João").

## Round 3 (2026-09-28)

- **Q-U3** The mock answers "MOCK answer: no model was called and nothing was billed."; `agent.output` says "Answer
  recorded.". Verification semantics are unchanged.
- **Q-U2** Graph events name the agent (also on `agent.removed`), the connection's source and target, and carry the
  server's `at`; `isGraphEvent` is strict. Activity shows the name and the server time.
- **Q-U1** Run once sends the agent's objective, unchanged, as the system instruction; quote and call share
  `TokenService.plan`. The connection test keeps `Reply OK.` with the first agent's summary.
- **R-01** Credential-shaped text is refused at creation and edit; provider output is redacted before the 8000
  cut; the graph store never writes a file its own parser would refuse, keeping the last valid one and warning.
- **R-02** Accounting is journaled (`accounting.jsonl`) and rebuilt at start: global, agent and model consumption
  and cost, limits changed in Budgets, reservations with deadlines, `unverifiable` states, pauses and the last 200
  receipts. The session budget and the mock's usage stay per process. A call in flight at a crash returns
  `unverifiable` with its agent paused. An unreadable journal is set aside and blocks real calls until **Start a new
  budget period**.

## Not verified or pending

- No provider has answered a real request. Gemini step 1B and DeepSeek D7 wait for explicit operator approval and follow `docs/reference/first-real-call.md`. `GET /models` is not approved.
- Step 1B also owes a forced real provider error with fragment checks, 429 and timeout if feasible, context export and enabled-feed credential scans, and sanitized real fixtures with a regression fix for each observed divergence.
- DeepSeek has no model ID and no price in configuration, so selecting it is refused with `model_not_allowlisted` until the operator enters both from the browser.
- The configured OpenAI and Gemini rates were verified on 2026-09-07. Account and model availability are unverified.
- OpenAI is not supported until the operator validates it: it is out of the allowlist and the panel does not offer it (Q-07). Once added back, it is priced by the dated snapshot its response names.
- The response cache is off (`cacheTtlMs` 0) until a real key is validated, so the per-model determinism declarations are dormant.
- Long-context tiers and cache-write pricing are not modeled; see `docs/reference/deferred-price-dimensions.md`.
- The Responses streaming path and real error, quota and timeout handling are tested only with synthetic transport.
- The full RF-02 panel is pending. RF-03 and RF-04 are out of scope.
- Agent removal (Q-03), graph persistence and import (Q-04) are implemented; accounting is journaled since R-02.
- There is no LICENSE file and the security contact in `SECURITY.md` is a marked placeholder: Q-05 and Q-06 came back empty.
- Accessibility was checked in Chromium (contrast, control names, visible focus, keyboard paths), not with a screen reader.
- When usage cannot be parsed, the served model the response named is not carried into receipts or manual reconciliation (F-01). The panel's Forget key reaches only the selected provider; the terminal helper reaches any (F-02).
- In `npm run dev` only, about one browser-check run in fifteen found the canvas cards focused without their outline; production never did. The cause is unproven (R1-16).

## Open debts and limits

- The graph and the global, agent and model accounting survive a restart. The session budget, the mock's usage, events, artifacts and the dispatch ledger are process-local. The journal is a checkpoint log, not an invoice: the input counter is still approximate.
- An unresolved reservation converts after `reservationTtlMs` (300000 ms in the shipped policy) at the greater of the hold and the dearest eligible captured model at peak with no cache hits, using P3's provider rule, and stays marked as an expired estimate until manual reconciliation.
- The input counter is approximate. The monetary ceiling is a guard, not a proof of the invoice.
- Configured credential fragments of 12 or more characters are redacted; shorter substrings cannot be told apart from ordinary text.
- Native Windows and macOS keyrings are unverified. The Linux keyring roundtrip passed with synthetic material.
- Generated preview code can exhaust CPU or memory; a sandbox is not a resource quota.
- The Gitleaks suppression in `tests/core/token-estimate.test.ts` stays for a public counter name and is pinned by a ratchet.
- `lib/utils.ts` remains the one naming exception, waiting on a decision.

## Execution notes

- In the Codex sandbox `npm run build` fails with `Could not parse output from TypeScript's --showConfig` because nested Node processes are refused (`spawnSync /usr/bin/node EPERM`). The operator runs the build there.
- Under the installed Node 26, the first build after any edit prints `DEP0205` from `@tailwindcss/node` calling `module.register()`. It is a dependency warning, and the build passes.
