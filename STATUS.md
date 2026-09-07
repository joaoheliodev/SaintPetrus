# SaintPetrus — current status

Branch: `night/m0-m2`. Latest application commit: `9b3a2cd` (RF-06).
Core integration: `114813a`. Tracked Gitleaks configuration: `c1e77b7`.
Last completed checks: 200 tests, lint, both typechecks, build and three Gitleaks scans. Remote CI for 9b3a2cd passed. These checks used synthetic credentials and mock transport, not real provider calls.

## Current objective

New scope: item 1 event bus + optional SSE feed, then item 2 isolated visual preview. Both exposures disabled by default. Real-provider validation remains unexecuted and pending; it is not claimed complete.

Item 1 complete: the authorized Node entrypoint conditionally registers SSE; disabled endpoint returned HTTP 404 in a running server. Browser verified live agent-created delivery, newest-first ordering, filtering and clicking through to the existing agent inspector. Full RF-02 remains pending. 205 tests, lint, both typechecks and build passed. Item 2 next; independent preview exposure will default off. Real-key validation remains pending.

## Open debts

- Counters, limits and cache are process-local; restarting clears accounting state.
- Reservations without trustworthy usage do not expire and can block further execution. Expiration belongs to step 2, not this step.
- A live Gitleaks suppression remains on tests/core/token-estimate.test.ts:18 for a verified public counter-name assertion. It is not proof against future leaks.
- Native Windows/macOS keyrings are unverified. Linux roundtrip was tested with synthetic material only.
- No real provider call has been executed. Mock success does not establish real-provider security or schema compatibility.
- Previously mock-only defaults: GPT-5 nano is now explicitly allowlisted with published standard rates (input USD 0.05/M, output USD 0.40/M). Account availability remains unverified. Cached-input discounts are not accounted for.

## Real validation results

Not executed: awaiting preparation and a key entered by the user in the local RF-01 UI, with persistence unchecked. Never paste a key into chat, documentation, fixtures or source.
No real response fixtures captured. No real-vs-mock divergence claimed yet.

## Records

NIGHT-LOG.md contains timestamped events only. Historical narrative summaries remain in Git history. This file is rewritten as verification state changes.

## Step 1 preparation — 2026-09-07

Global, agent, model and session limits: 1,024 tokens each. GPT-5 nano output cap: 128 tokens. Cache disabled. These are process-local token limits with approximate reservations, not an independent dollar spending ceiling.
Provider credentials remain memory-only by default; the live UI checkbox was verified unchecked. Server runs exclusively at http://127.0.0.1:3100, mock disabled, GPT-5 nano preselected. No key was entered by the agent.
Documentation-based mismatch corrected: GPT-5 nano rejects temperature, which the adapter previously always sent. The adapter now omits it for this model and requests minimal reasoning. This is not a captured real-provider divergence. Sources: https://developers.openai.com/api/docs/models/gpt-5-nano and https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2 .
Checks executed: 201 tests passed, lint passed, both typechecks passed, production build passed without an API key. The new test uses synthetic transport, never a real fixture. Its first run failed with `Invalid credential.` because random binary test material contained prohibited bytes; corrected to generated hexadecimal text and rerun successfully.
Remaining step 1: user enters key through RF-01 with Remember unchecked and presses Connect only; execute one successful minimal real call; compare raw usage/reconciliation/cost/schema; force and inspect a real provider error including credential fragments; test 429/timeout if feasible; scan export; capture only sanitized regression fixtures for observed divergences. No real tests have run. Do not proceed to step 2.
The first step-0 commit attempt failed with `spawnSync git EPERM`; after the granted permission, the hook remained active and the commit succeeded.

## Optional feed verification in progress

205 tests pass, including redaction reaching an SSE response, fragment redaction, HTML rendered as escaped text, bounded immutable-to-consumers history, cumulative tokens and disabled route registry with internal bus recording. Lint, both typechecks and build passed. No API key used. Initial sandbox build failed with `Could not parse output from TypeScript's --showConfig.`; it passed after permission was granted. Browser SSE delivery, type filtering and agent selection are now verified after the approved entrypoint integration.
Known redaction boundary: configured credential fragments of 12+ characters are masked; arbitrary shorter substrings cannot reliably be distinguished from ordinary text. No claim of universal fragment detection.
