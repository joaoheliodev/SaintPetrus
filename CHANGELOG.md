# Changelog

Notable changes, newest first. Dates are UTC. No release has been tagged; entries are grouped by the branch
that carried them.

## Unreleased: `night/provider-validation-ready` (2026-09-27)

Everything that could be finished without a call to a real provider. No request with a real key was made.
The test floor rose from 338 to 427.

### Provider validation

- Gemini is priced by the model its `modelVersion` names, without the `models/` prefix; OpenAI by the
  response's `model`, usually a dated snapshot of the alias. Requested and served models are both recorded,
  and a divergence publishes `provider.rerouted`.
- A served model with no captured price is reported as `unverifiable`: the hold stays, the agent pauses, the
  feed says why (`provider.unpriced`) and the route answers 409 `served_model_unpriced`. It is never settled at
  the requested model's tariff and never released; that tariff is only a floor when the hold expires.
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

### Fixed after independent review

- In the running app every provider failure lost its code: the custom server built the provider proxy from its own
  copy of the modules, and the routes' `instanceof` checks failed against it, so a 401, 404, 429, busy or timeout
  became an unverifiable call answered with 400. Failures now carry a `Symbol.for` brand and the server pins only
  the timeout value. A regression of this branch, found by both reviewers.
- Graph refusals answered "Invalid request." in the running app for the same reason; they return their message again.
- The browser check refuses an instance with a keyed provider connected or with existing work, keeps its profile in
  the OS temporary directory and always removes it; the preview check answers the confirmation it had been stuck on.
- A call whose counters have settled can no longer be failed afterwards, and only the mock is ever priced as asked.
- OpenAI usage is parsed as strictly as the other providers', and DeepSeek names its fields when the served model is
  missing.
- A connection probe that finishes after the key or selection changed no longer verifies the new pair.
- A busy proxy is no longer reported as a budget refusal, the setup panel no longer says no provider is ever
  called, and the CI floor check reads the spec reporter as well as TAP.

### Added

- Every mode starts with the keyless mock, so the whole panel works without a key; `SAINTPETRUS_MODE=real` at
  startup is the only way to real providers, and the header always shows MOCK or REAL. The former
  `SAINTPETRUS_MOCK` variables stop the server at startup.
- Remembered keys live in the OS user data directory; a legacy `data/vault` is moved there at startup, each
  file copied and verified before the original is deleted.
- OpenAI is out of the allowlist and not offered until the operator validates it.
- An unpriced served model's expiry converts at the greater of the estimate and the reported usage in each
  dimension, priced at least at the requested model's peak, cache-miss rate.
- The inspector edits an agent's name and objective, connects the agent to another from the keyboard, and
  **Run once** sends one budgeted call whose answer becomes the agent's output. It asks first, showing the
  tokens and dollars the call reserves at most, quoted by `POST /api/provider` `{ action: 'quote' }` through the
  same checks as the call, with nothing reserved or sent.
- **Forget key** in the connection panel clears the selected provider's key from memory and deletes its remembered
  ciphertext; the terminal helper covers any provider.
- **Remove** in the inspector deletes an agent and its connections after a confirmation. The route answers 409
  while the agent holds a reservation (in flight, unverifiable or awaiting reconciliation); the coordinator, a
  parent and an agent in a mock run are refused. Its accounting rows stay, marked as a removed agent.
- Export context is reachable from the project bar. **Import graph** reads an exported file back as untrusted
  input: at most 4 MiB, exact format with unknown fields refused, no credential-shaped text, providers limited to
  `Unconfigured` and `Mock`, and only graphs the canvas could have built. Refused while accounting is unsettled.
- The graph is saved to the user data directory (0700 directory, 0600 file, redacted, written atomically) and
  restored at startup through the same parser; a file that fails it is set aside. Accounting stays process-local.
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
