# SaintPetrus — current status

Branch: `night/price-schema`, a linear continuation of `night/m0-m2`, `night/deepseek` and `night/orca`. Remote repository: `joaoheliodev/SaintPetrus`. Permanent rules live in `AGENTS.md`; timestamped events live in the append-only `NIGHT-LOG.md`.

## Verified in round C (2026-09-15)

Run on this tree without any API key: lint, the app ES2017 and core ES2022 typechecks, 292 tests in 29 suites and the production build passed, as they did after every task in the round, and directory and full-history Gitleaks scans found no leaks. No provider request was made, including `GET /models`.

The suite covers the delivered behavior below with synthetic fixtures only. Browser checks and the results of earlier rounds are historical evidence from the commits and handoffs that delivered them, and were not repeated.

## Delivered

- **Workspace, credentials and proxy (M0–M2, RF-01).** Loopback server, memory-only credentials with opt-in OS-keyring encryption, and a provider proxy that owns the timeout, the single active request and redaction.
- **Core integration.** The §5.4 detectors and the RF-07 handoff come from `lib/core`, which typechecks on its own.
- **Token and USD budgets (RF-06).** Global, agent, model and session scopes. Preflight reserves at peak with no cache hits before provider I/O, reconciliation prices the served model with the reported cache split, and unresolved reservations expire into conservative usage that accepts manual reconciliation.
- **Event feed and artifact preview.** Both off by default (`SAINTPETRUS_FEED`, `SAINTPETRUS_PREVIEW`). The preview runs generated code in a script-only sandbox under CSP; its Chromium isolation check passed on 2026-09-07 and is reproducible with `npm run test:browser`.
- **Providers.** OpenAI Responses, Gemini `generateContent`, DeepSeek with its own adapter and strict usage parser, and the mock. Status mapping lives in each adapter, thinking capabilities in one table, and chain of thought stays out of context, events, previews and artifacts.
- **Repository discipline (Orca O1–O5).** `AGENTS.md`, ratchet tests, exhaustive `unbilled | billed | unverifiable` verdicts, one server owner per state and anchored reference decisions.
- **Price schema.** Optional `expiresAt` with a preflight horizon covering the reservation TTL (P1); the enforced total `costAccountedUsd` named apart from its unmeasured part `costUnmeasuredUsd` (P2).
- **Round C.** Orphan permanent rules moved into `AGENTS.md`, local refusal verdicts proven unreachable with a live reservation, and the deferred price dimensions and first real call protocol documented.

## Not verified or pending

- No provider has answered a real request. Gemini step 1B and DeepSeek D7 wait for explicit operator approval and follow `docs/reference/first-real-call.md`. `GET /models` is not approved.
- Step 1B also owes a forced real provider error with fragment checks, 429 and timeout if feasible, context export and enabled-feed credential scans, and sanitized real fixtures with a regression fix for each observed divergence.
- DeepSeek has no model ID and no price in configuration, so selecting it is refused with `model_not_allowlisted` until the operator enters both from the browser.
- The configured OpenAI and Gemini rates were verified on 2026-09-07. Account and model availability are unverified.
- The response cache is off (`cacheTtlMs` 0) until a real key is validated, so the per-model determinism declarations are dormant.
- P3, a provider-scoped worst case for reservation expiry, is a proposal awaiting the operator's monetary decision. The all-model floor stays.
- Long-context tiers and cache-write pricing are not modeled; see `docs/reference/deferred-price-dimensions.md`.
- The Responses streaming path and real error, quota and timeout handling are tested only with synthetic transport.
- The full RF-02 panel is pending. RF-03 and RF-04 are out of scope.

## Open debts and limits

- Counters, budgets, reservations, graph, events and artifacts are process-local. Restarting clears them; this is not a durable ledger.
- An unresolved reservation converts after `reservationTtlMs` (300000 ms in the shipped policy) at the greater of the hold and the dearest model at peak with no cache hits, and stays marked as an expired estimate until manual reconciliation.
- The input counter is approximate. The monetary ceiling is a guard, not a proof of the invoice.
- Configured credential fragments of 12 or more characters are redacted; shorter substrings cannot be told apart from ordinary text.
- Native Windows and macOS keyrings are unverified. The Linux keyring roundtrip passed with synthetic material.
- Generated preview code can exhaust CPU or memory; a sandbox is not a resource quota.
- The Gitleaks suppression in `tests/core/token-estimate.test.ts` stays for a public counter name and is pinned by a ratchet.
- `lib/utils.ts` remains the one naming exception, waiting on a decision.

## Execution notes

- In the Codex sandbox `npm run build` fails with `Could not parse output from TypeScript's --showConfig` because nested Node processes are refused (`spawnSync /usr/bin/node EPERM`). The operator runs the build there.
- Under the installed Node 26, the first build after any edit prints `DEP0205` from `@tailwindcss/node` calling `module.register()`. It is a dependency warning, and the build passes.
