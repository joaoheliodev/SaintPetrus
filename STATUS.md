# SaintPetrus — current status

Branch: `night/m0-m2`. Latest application commit: `9b3a2cd` (RF-06).
Core integration: `114813a`. Tracked Gitleaks configuration: `c1e77b7`.
Last completed checks: 200 tests, lint, both typechecks, build and three Gitleaks scans. Remote CI for 9b3a2cd passed. These checks used synthetic credentials and mock transport, not real provider calls.

## Current objective

Step 0: separate this rewritable status from the pure append-only NIGHT-LOG.md.
Step 1: prepare a low-budget real-key test, then validate actual usage, cost estimate, response shape, provider errors, timeout/429 when feasible, and context export. Stop and report after step 1. No later step authorized before this gate closes.

## Open debts

- Counters, limits and cache are process-local; restarting clears accounting state.
- Reservations without trustworthy usage do not expire and can block further execution. Expiration belongs to step 2, not this step.
- A live Gitleaks suppression remains on tests/core/token-estimate.test.ts:18 for a verified public counter-name assertion. It is not proof against future leaks.
- Native Windows/macOS keyrings are unverified. Linux roundtrip was tested with synthetic material only.
- No real provider call has been executed. Mock success does not establish real-provider security or schema compatibility.
- Only mock prices and models are configured by default as of this snapshot. Real model/rates and low limits are not yet prepared.

## Real validation results

Not executed: awaiting preparation and a key entered by the user in the local RF-01 UI, with persistence unchecked. Never paste a key into chat, documentation, fixtures or source.
No real response fixtures captured. No real-vs-mock divergence claimed yet.

## Records

NIGHT-LOG.md contains timestamped events only. Historical narrative summaries remain in Git history. This file is rewritten as verification state changes.
