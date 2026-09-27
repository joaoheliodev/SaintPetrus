# Changelog

Notable changes, newest first. Dates are UTC. No release has been tagged; entries are grouped by the branch
that carried them.

## Unreleased: `night/provider-validation-ready` (2026-09-27)

Everything that could be finished without a call to a real provider. No request with a real key was made.
The test floor rose from 338 to 384.

### Provider validation

- Gemini is priced by the model its `modelVersion` names, without the `models/` prefix; OpenAI by the
  response's `model`, usually a dated snapshot of the alias. Requested and served models are both recorded,
  and a divergence publishes `provider.rerouted`.
- A served model with no captured price is reported as `unverifiable`: the hold stays, the agent pauses, the
  feed says why (`provider.unpriced`) and the route answers 409 `served_model_unpriced`. It is never priced at
  the requested model's tariff and never released.
- Unreadable usage shapes from Gemini and DeepSeek record the names of the fields the response carried, never
  a value. The reasoning share of completion tokens is reported as its own count when a provider states it.
- Every settled call leaves a bounded, redacted receipt (last 200), readable at `GET /api/receipts`: verdict,
  outcome, requested and served model, captured price versions, dispatch, reservation and reported usage.
- The proxy counts every request that actually leaves for a provider, recorded immediately before the network
  call and exposed at `GET /api/provider`; refusals before dispatch never count.
- `SAINTPETRUS_VALIDATION_TIMEOUT_MS` shortens the provider timeout for the operator's timeout test. It is read
  once at startup, off by default, never settable from a request, and does not bypass preflight or budgets.
- `npm run key -- set deepseek` works with the same rules as the other providers.
- A connection probe that returns no visible text no longer verifies the connection: it answers 422
  `empty_output`, keeps its billed usage and shows "No visible output".
- `docs/provider-validation.md` and the reference pages describe the new evidence and list which gaps are
  resolved and which remain.

### Fixed

- Resetting the graph while a call was in flight could corrupt settled accounting: a failing pause hook undid
  a reconciliation and left the reservation jammed or released twice.
- Synthetic mock calls no longer write reconciliation entries into the operator's `config/prices.json`.
- A card moved with the arrow keys was never saved and snapped back; in a group drag only the grabbed card was
  saved. Every settled move is now saved, one request per card at a time, always with the newest position.
- Keyboard focus on canvas cards and connections was invisible because React Flow's stylesheet removes the
  outline; field edges were drawn at 2.43:1 contrast. Both now meet WCAG AA.

### Added

- `npm run dev` starts with the keyless mock, so the whole panel works without a key; `npm start` does not,
  and an explicit `SAINTPETRUS_MOCK` always wins.
- The inspector edits an agent's name and objective, connects the agent to another from the keyboard, and
  **Run once** sends one budgeted call whose answer becomes the agent's output.
- **Forget key** in the connection panel clears the selected provider's key from memory and deletes its remembered
  ciphertext; the terminal helper covers any provider.
- Export context is reachable from the project bar.
- Reset, running the mock, pausing all agents, disconnecting or forgetting a key, deleting a connection,
  adding a price validity and applying confirmed usage all ask first.
- Empty and unavailable states for the feed, the preview, reservations and the connection badge.
- `npm run test:e2e`, a dependency-free browser check of the main flow, keyboard paths, visible focus,
  control names, confirmations and the content security policy.

### Security

- Every response of the local server carries a content security policy, `X-Frame-Options: DENY`,
  `nosniff`, `no-referrer`, same-origin opener and resource policies and a Permissions-Policy.
- `SECURITY.md` has a threat model and a table following a key from entry to erasure.
- New tests pin the local boundaries of the token, price, provider, credential, graph and artifact routes.
- `.gitignore` covers every `.env*` file, logs, key stores and build output.

### Documentation

- The README was rewritten from the code, and `docs/architecture.md` follows one call through the modules.
