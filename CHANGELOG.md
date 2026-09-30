# Changelog

Notable changes, newest first. Dates are UTC. No release has been tagged; entries are grouped by the branch
that carried them.

## Unreleased: Round 5 on `main` (2026-09-30)

The operator could not un-pause the agents. Every way into a pause was tried against every way out on fresh instances
before anything changed. No request with a real key was made.

- `next` 16.3.8, a patch release, closes GHSA-vcvr-r3jv-pc5j (critical: remote code execution in `next/og`
  ImageResponse, 16.2.0 to 16.3.5), published during the round, which turned `npm audit --audit-level=high` red.

## Unreleased: Round 4 on `main` (2026-09-29)

Deleting a delegation left a graph the server could no longer save, and nothing on screen said so. No request with a
real key was made. The test floor rose from 487 to 514.

- A delegation connection is deleted only with its subagent: `POST /api/graph` answers 400 to `disconnect` on a
  `delegation` edge with "A delegation connection cannot be deleted on its own. Remove the subagent instead.", and
  context connections are deleted as before. The canvas explains this while a delegation is selected and asks
  nothing before sending one (R4-1). The browser check deletes a context connection and checks that the delegation
  is refused (R4-4).
- A test runs every graph command, by name and in a seeded random walk, and parses the redacted snapshot after each
  accepted one (R4-2). It found three more ways to leave a graph that could not be saved, now fixed: a subagent
  placed beside a parent at the edge of the canvas fell outside it; an output cut at 8000 inside
  "Bearer [REDACTED]" was redacted longer again when saved; and the demo's output could grow past 8000.
- While the graph cannot be saved, for any reason, a warning under the top bar says why and stays until a change is
  saved again. The new `GET /api/graph/persistence`, local and read-only, answers `{ saving: true }` or
  `{ saving: false, reason, since }`; the reason is the parser's sentence or a fixed one, never the refused text
  (R4-3). The browser check confirms the store keeps saving through the whole flow.
- A key typed into the graph before it was configured no longer stays in plain text on disk (R4-5). Configuring a key
  now tells the process graph, which replaces every name, objective, summary, artifact and output the redactor
  would change with the redacted text, within its limit, as a `graph.redacted` event, and the store saves it at
  once; a later **Disconnect** or **Forget key** cannot write the key back. The live event feed redacts again as it
  sends, like the graph stream. Before, the in-memory graph was never redacted: the store wrote a redacted copy only
  at the next change, without the refusal R-01 had assumed, and wrote the key again once it was forgotten.
- The browser checks no longer fail after passing when Chromium writes a temporary file into its disposable profile
  while it shuts down: the profile removal retries on `ENOTEMPTY`.
- Patch releases of three transitive development dependencies close advisories published on 2026-09-30 that turned
  `npm audit --audit-level=high` red: `brace-expansion` 5.0.12 and 1.1.21, `fast-uri` 3.1.8, `ip-address` 10.7.2.
- One gate, `npm run gate`, runs CI's blocking steps in CI's order: the tracked-path check, `npm audit
  --audit-level=high`, lint, typecheck, the tests held to the floor, and the build. CI runs `npm ci` and then the
  gate; `AGENTS.md` requires it before every commit (R4-6).
- The artifact preview redacts again as it sends, like the graph stream and the feed, so a version stored before a
  key was configured does not repeat it; Run once answers reach the preview when it is on (R4-6). A ratchet holds
  every stream the server sends to the same rule.
- When a configured key leaves the graph, the open panel discards what it received before: the Activity lines, the
  live feed lines and the Run exchanges. The Activity log starts again with "Earlier activity cleared because a key was
  configured", and the feed says "No events since a key was configured." until a newer event arrives (R4-6). The
  panel never knows the key and does not redact on its own.

## Unreleased: Round 3 on `night/provider-validation-ready` (2026-09-28)

Operator decisions and server fixes. No request with a real key was made. The test floor rose from 463 to 484.

- The mock's answer and the `agent.output` event claim nothing they did not do (Q-U3).
- Graph events name the agent, the connection's source and target, and carry the server's clock `at`; the client
  refuses unknown keys, a missing `at` or a malformed party (Q-U2).
- Run once sends the agent's objective as its instruction; Details says so (Q-U1).
- Credential-shaped text is refused at creation and edit, provider output is redacted before its cut, and the graph
  store never writes a document it would refuse on restore (R-01).
- Accounting survives a restart: an append-only, synced `accounting.jsonl` in the user data directory rebuilds the
  global, agent and model budgets, reservations, pauses and the last 200 receipts. A call lost to a crash returns
  `unverifiable` with its agent paused; an unreadable journal is set aside and blocks real calls until the new
  `new-period` action on `POST /api/tokens` (**Start a new budget period** in Budgets), which answers 409 with its
  reason when refused. `GET /api/tokens` gains `accounting` (`journal`, `reason`, `rejectedAs`,
  `recoveredReservations`) (R-02).

## Unreleased: `night/provider-validation-ready` (2026-09-27)

Everything that could be finished without a call to a real provider. No request with a real key was made.
The test floor rose from 338 to 463.

### Interface

The panel was reorganised so that someone who has never seen it can find their way without the documentation.
Presentation only: no route, API contract, graph file format, accounting, provider payload, configuration value,
run mode, security header or content security policy changed.

- A fixed sidebar with the **MOCK**/**REAL** badge, the views (Workspace, Activity, Budgets, Prices, Connection) and
  the agents with their status; a top bar with the connection chip, a budget meter, **Commands** (Ctrl+K) and
  **Pause all agents**. Budgets, Prices and Connection are views instead of dialogs.
- One vocabulary everywhere (now a section of `AGENTS.md`): cards drop the file's "Unconfigured" label and show the
  role and level in words and each status with its own icon, colour and text.
- The agent panel opens on **Run**: message, Send, and right below the answer with its tokens, latency and the
  cost the server accounted. **Details** shows the instruction Run once really sends and marks the objective as not
  sent.
- The demo, import, export and reset moved to a **More** menu; **Load demo** warns that it replaces the canvas.
  "Mock limits" became **Graph limits** and **Demo cost**.
- **Budgets** opens with a summary and one sentence on what is blocked and how to unblock it; the full table is under
  Details. **Activity** reads as one line per action with its detail indented, and hides card moves until asked.
- A **First steps** bar, in-app confirmations that open on Cancel, and the Next.js development badge turned off.
- A reviewer who had not built it tried the six goals from screenshots alone; the confirmed findings were fixed: Send
  no longer says "Running…" while its question is open, the budget meter says "used", an empty Activity log no longer
  claims the graph is empty, dollars read the same everywhere, and Connection explains MOCK and its buttons.

| Before | Now |
| --- | --- |
| Run mock / Run preview mock | Load demo… / Load preview demo… (More menu) |
| Mock limits | Graph limits and Demo cost |
| Project objective | Coordinator objective (in Reset graph…) |
| Export context | Export graph |
| Tokens (dialog) | Budgets and Prices (views) |
| Connect AI (dialog) | Connection (view; the top-bar chip opens it) |
| Server events · revision N | Activity (drawer and view) |
| Output tab, Executive summary | Run tab with the last exchange; Details → Instruction sent with Run once |
| L0, "Unconfigured" on cards | Coordinator · level 0, Agent · level 0, Subagent · level 1 |
| Browser `confirm()` pop-ups | In-app confirmations |

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
