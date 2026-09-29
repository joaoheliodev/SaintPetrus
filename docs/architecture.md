# Architecture

SaintPetrus is one Node.js process. `scripts/next.mjs` validates the command line and environment, then starts
`scripts/server.ts`, a small HTTP server that binds to `127.0.0.1`, sets the security headers on every
response and hands everything else to Next.js. Pages and most API routes are ordinary Next.js App Router
files. The long-lived streams (the graph stream, the optional event feed and the optional artifact stream)
are registered in the custom server instead, so a disabled feature has no route at all. So is the read-only
`GET /api/graph/persistence`, because only the custom server's copy of the modules holds the `GraphStore`. With the preview
enabled, a second listener on its own loopback port serves only the isolated preview document.

Authoritative state lives in process-wide singletons kept on `globalThis`, so the custom server and every
route handler share the same graph, token service, provider proxy, credential store, event bus and artifact
store. Nothing is written to a database. The token service reads two files when it is first used and keeps
them for the life of the process: `config/token-policy.json` (the model allowlist and budgets) and
`config/prices.json` (tariff validities, which the price route appends to).
Each kind of state has exactly one server owner; read
[reference/state-ownership.md](reference/state-ownership.md) before adding a reader, cache or fallback.

## Modules

| Area | Modules | What they own |
| --- | --- | --- |
| Launch | `scripts/next.mjs`, `scripts/server.ts` | Loopback binding, telemetry off, the dev-only mock default, security headers, optional routes and the preview listener |
| Local boundary | `lib/server/http.ts`, `lib/server/read-json.ts`, `lib/server/security-headers.ts` | Host, exact Origin and JSON checks, bounded request bodies, graph command dispatch, the content security policy |
| Graph | `lib/orchestrator.ts`, `lib/server/graph-service.ts`, `lib/server/graph-document.ts`, `lib/server/graph-store.ts`, `lib/server/graph-http.ts`, `lib/graph-persistence.ts`, `lib/server/runtime.ts`, `lib/providers/mock-provider.ts` | Agent and edge rules, the server-owned graph, its revisioned stream, the strict file format for import and the saved copy, whether that copy keeps up, the mock demonstration |
| Browser | `app/page.tsx`, `components/*`, `lib/store.ts`, `lib/graph-sync.ts`, `lib/use-graph-transport.ts`, `lib/node-moves.ts`, `lib/graph-deletion.ts`, `lib/agent-status.ts`, `lib/run-exchange.ts`, `lib/budget-summary.ts`, `lib/activity-log.ts`, `lib/first-steps.ts`, `lib/command-search.ts` | The sidebar of views, the canvas and the agent panel; a projection of server snapshots guarded by revision; commands; settled node moves; edge-only deletion; how status, exchanges, budgets, activity, first steps and commands are named on screen, never computed in place of the server |
| Credentials | `lib/security/credentials.ts`, `lib/security/encrypted-vault.ts`, `lib/security/os-keyring.ts`, `lib/security/runtime.ts`, `app/api/credentials`, `scripts/key.mjs` | Keys in backend memory, opt-in encrypted copies under a keyring-held key, the terminal helper |
| Redaction | `lib/security/redact.ts` | Secret-shaped text removed from inputs, outputs, events, exports and JSON responses |
| Providers | `lib/providers/adapter.ts`, `openai.ts`, `gemini.ts`, `deepseek.ts`, `response-stream.ts`, `model-id.ts`, `thinking-policy.ts` | One adapter per provider: fixed endpoint, no redirects, bounded body, status-to-code mapping, strict usage parsing, the served model id |
| Proxy | `lib/providers/proxy.ts`, `lib/providers/dispatch-ledger.ts`, `lib/providers/runtime.ts`, `app/api/provider` | One active call, the timeout, the record of every upstream dispatch, the selected provider and its verification state |
| Budgets | `lib/tokens/config.ts`, `pricing.ts`, `service.ts`, `receipts.ts`, `accounting-journal.ts`, `accounting-state.ts`, `runtime.ts`, `app/api/tokens`, `app/api/receipts` | The policy, preflight and reconciliation arithmetic, four-scope reservations, expiry, the response cache, pause transitions, receipts and the accounting journal that rebuilds them at start |
| Prices | `lib/prices/catalog.ts`, `app/api/prices` | Validity records in `config/prices.json`, captured tariffs and the journal of reconciled intervals |
| Events | `lib/events/bus.ts`, `lib/events/http.ts` | A bounded, redacted, process-local event sequence and its optional feed |
| Preview | `lib/preview/store.ts`, `lib/preview/http.ts` | Artifact versions from model output and the isolated preview document |
| Core | `lib/core/*` | Dependency-free token estimate, health detectors and handoff; typechecked on its own |

## Graph events

`GraphService` publishes one event per change on `GET /api/graph/stream`: `{ id, type, message, snapshot, at, agent?,
source?, target? }`. `id` is the revision and the only order; `at` is the server's clock, for display only.
`agent`, `source` and `target` are `{ id, name }` as they were when the event happened, so a removal or rename later
does not rewrite history. The stream passes through the redactor. `isGraphEvent` in `lib/orchestrator.ts` accepts only
these keys and requires `at`. A command response is logged as a placeholder under its revision until the stream's
event for that revision replaces the log line; the graph itself is taken only by the revision guard.

## One call, end to end

This is **Run once** in the inspector. **Connect and verify** takes the same path with a fixed probe message,
reasoning turned off where the provider allows it, and no response cache.

1. **Browser.** The inspector first posts `{ action: 'quote', input, agentId }` to `/api/provider`. The route
   answers `{ quote: { provider, model, cached, reservedTokens, reservedCostUsd } }` from `TokenService.quote`,
   which runs the same admission checks as step 3 without reserving, pausing or sending anything. A refusal
   answers exactly as the call would. The inspector shows that maximum in a confirmation, and only after it is
   accepted posts `{ action: 'complete', input, agentId }`. Neither body ever carries a key, a model or a URL.
2. **Local boundary.** The route checks Host, the exact page Origin and the JSON content type, reads a
   bounded body and refuses unknown fields. The agent must exist in the graph. The instruction (system prompt) is
   the agent's objective, unchanged, for both the quote and the call; the connection test instead sends `Reply OK.`
   with the first agent's summary.
3. **Admission.** `TokenService.execute` expires overdue reservations, then refuses before any I/O when the
   selected model is not allowlisted for its provider, the input is empty or too long, the agent or the whole
   service is paused, or no effective price exists.
4. **Price capture.** The catalog captures every tariff usable at this moment, including prices for models the
   provider might reroute to. The call will be reconciled against this capture, whatever is edited later.
5. **Preflight.** Input is estimated with the core token counter; the output allowance is the policy's
   `max_tokens`. Cost is priced at the peak rate with no cache hits. If the request is reproducible and a
   fresh cached answer exists, it is returned here without a provider call.
6. **Reservation.** Tokens and USD are reserved synchronously across the global, agent, model and session
   scopes. If any scope would pass its limit, the agent is paused and the call refused. Nothing has left the
   process yet.
7. **Proxy.** `ProviderProxy` admits one call at a time, starts the timeout (15 s unless the startup-only
   validation flag shortens it) and passes the redacted input to the adapter.
8. **Adapter.** The adapter builds the request for its fixed endpoint with the key only in a header, records
   the dispatch in the ledger immediately before the network call, refuses redirects and reads at most a
   bounded body. An HTTP error becomes a `ProviderFailure` code without reading the error body. A success is
   parsed strictly: text, usage (a shape it does not know fails closed, recording only field names) and the
   served model id.
9. **Reconciliation.** The served model, not the requested one, is the price key. If the capture holds no price
   for it, the call is `unverifiable`: the hold stays, the agent pauses and an event says so. Otherwise the
   reservation is replaced by the reported usage at the captured rate for the hour the answer arrived (peak if
   the call touched a peak window), the interval is journaled in the price file, and the verdict is `billed`.
10. **Failure.** A code that proves rejection before generation releases the reservation (`unbilled`). A
    timeout, a 5xx or lost contact keeps it unresolved (`unverifiable`); at `reservationTtlMs` it converts to
    usage at the greater of the hold and the dearest eligible price, until the operator applies confirmed usage.
11. **Record.** A bounded receipt is appended, events are published to the bus, the answer is recorded as the
    agent's output and, with the preview on, captured as an artifact. Reasoning text never enters any of them.
12. **Browser again.** The route returns the redacted answer, usage and latency; the graph stream carries the
    new output to every open tab.

## Where to read next

- [SECURITY.md](../SECURITY.md): threat model, the life of a key, reporting.
- [provider-validation.md](provider-validation.md): the operator protocol for the first real calls.
- [reference/](reference/): one short page per decision that must not be simplified, each linked from
  `AGENTS.md`.
