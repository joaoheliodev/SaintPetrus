# SaintPetrus finish backlog

Persistent state for the autonomous finishing session on branch `night/provider-validation-ready`
(anchors `0662647` price admin, `1445177` validation protocol). The conversation is not the record:
this file and `git log` are. Written in English per `AGENTS.md`; the two section names the operator
asked for are kept in Portuguese.

## How to resume

1. `git fetch origin night/provider-validation-ready && git status` must be clean and level with origin.
2. Read `AGENTS.md`, then this file, then `git log --oneline 1445177..HEAD`.
3. Continue from the first backlog item whose status is not `done` or `blocked`. Never redo a `done` item.
4. Gate for every commit: `npm run lint && npm run typecheck && npm test && npm run build`, then the
   pre-commit hook runs Gitleaks on the staged diff (`npm run setup:hooks` once per clone; install the
   official Gitleaks release binary if missing, verified against its published checksum).
5. After each item: mutation check (break the fixed line, confirm a new test fails, restore), update this
   file in the same commit, push.

This file lives under the ignored `.prompts/` directory and is tracked with `git add -f` so an
ephemeral session can resume from a fresh clone (see decision D-02).

## Definition of Done (operator section 12)

- [x] Every P0 and P1 item is done, or blocked only on an operator decision or on a real provider call (F7 on Q-03/Q-04).
- [x] `npm ci && npm run dev` starts the panel in mock mode without any key, and the main flow works end to end
  (browser check after a fresh `npm ci`).
- [x] Full gate green with at least 338 tests and zero skips (400 tests in 29 suites).
- [x] Gitleaks clean over the branch history (75 commits in the full history, 40 in `0662647..HEAD`, and the directory).
- [x] Every known security gap is recorded (`SECURITY.md` residual risks, Phase 2 findings, R1 findings, validation gaps).
- [x] README, architecture, SECURITY, validation protocol and CHANGELOG are current.
- [x] The handoff lets another agent or the operator resume without this conversation (this file, STATUS.md, NIGHT-LOG.md).

## Baseline (verified at session start, 2026-09-27)

Clean tree level with origin at `1445177`. `npm ci`: 0 vulnerabilities. Lint, both typechecks,
338 tests in 29 suites (0 failures, 0 skips) and `npm run build` passed. Gitleaks 8.28.0: history
(36 commits) and directory clean. Line coverage 93%. No open GitHub issues. No provider call made.

## Backlog

Status values: `pending`, `in progress`, `done (<hash>)`, `blocked (<reason>)`.
Priority: P0 security/accounting, P1 core function, P2 quality, P3 docs/DX.
"Operator" means the item needs an operator decision or a real call to be fully closed.

### Phase 1 — provider validation (P0)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| V0 | Review of Part 2 (`1445177`) | Protocol must match the code; gaps found in review get fixes in new commits | Every claim in `docs/provider-validation.md` checked against code; confirmed divergences fixed or listed; no rewrite of `1445177` | no | done (8315a5b; findings below) |
| V10 | A reset during a call cannot corrupt accounting | Found by V0: the pause hook throws for an agent a graph reset removed, which jams a billed call as unverifiable forever, releases a mock hold twice (negative `reserved`) and replaces a timeout with a generic 400 | Pause recorded by `TokenService` even when the graph hook fails; billed call stays billed, no double release, original failure preserved | no | done (8315a5b) |
| V1 | Gemini served model identity (G1) | Price key must be the response model; Gemini ignores `modelVersion` | Adapter returns normalized `modelVersion` (no `models/` prefix) as the served model; missing or malformed identity fails closed as unverifiable; pricing uses the served model; requested and served models recorded separately | no | done (869583f; `servedModel` on reservations now, `requestedModel`/`servedModel` on receipts in V3) |
| V2 | Served model without captured tariff (all providers) | Current path reports a `budget.refused` event and a "reconciled" reroute message for a call that was billed and not reconciled | Reservation kept unverifiable, agent paused, explicit feed event naming requested/served model and reservation; never released; requested tariff never used; reroute event no longer claims reconciliation first | no | done (e28cff0) |
| V3 | Per-call accounting receipt (G2) | No per-call record of usage, identity, tariff and timing | Bounded in-memory journal of redacted receipts (numbers, ids, codes only), linked to the persisted reconciliation interval, exposed by a local read-only GET; eviction reported | no | done (reasoning count d502544; journal 52de956; `GET /api/receipts`) |
| V4 | Upstream dispatch counter per provider (G3) | Nothing proves a refused call never left the server | Server-owned count incremented immediately before transport, per provider, exposed read-only; tests prove every preflight refusal leaves it unchanged and a dispatched call adds exactly one | no | done (3f6955d; `dispatches` on `GET /api/provider`) |
| V5 | Validation timeout control (G4) | V2 of the protocol cannot force a timeout | Off by default; read only at startup; never taken from `/api/provider` bodies; applies inside the proxy after preflight and reservation, so budgets still bind; invalid values refuse startup; visible in provider status | no | done (3e15849; `SAINTPETRUS_VALIDATION_TIMEOUT_MS`) |
| V6 | `npm run key -- set deepseek` (G7) | Terminal helper omits DeepSeek | DeepSeek accepted with the same rules as Gemini (hidden TTY input, no argv secret, opt-in remember); regression test without spawning processes | no | done (9262bc5; extra arguments now refused) |
| V7 | Empty visible output never verifies a probe (G11) | `connection-state.md` requires usable output; empty text with a non-limit finish reason is marked verified | Empty-text probe keeps billed usage, does not verify, reports a distinct error; badge not "Connected" | no | done (7c97951; state `incomplete`, 422 `empty_output`) |
| V11 | OpenAI served identity | Found while closing V2: `AGENTS.md` makes the response `model` the price key, but the OpenAI adapter ignored it (plain and streamed) | `billingModel` from `response.model`; missing identity fails closed with names; unpriced snapshot follows V2 | confirm (Q-07) | done (812a244) |
| V8 | Gemini usage failures report field names only (G8, second half) | `AGENTS.md` requires names-only diagnostics for an unparsed usage shape; only DeepSeek has them | Gemini parse failure publishes the field names it saw and never a value; a missing usage object reports the response's names in both adapters | no | done (35a8022) |
| V9 | Update `docs/provider-validation.md` | Protocol must describe the new receipts, counter, timeout, identity and terminal support | Gaps table updated (resolved vs still open); steps use the new evidence sources | no | done (aa7bf5c; V0 imprecisions corrected) |

### Phase 2 — security (P0)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Key lifecycle audit | Operator asked for where a key travels, how long it lives and how remembered keys are stored and erased | Documented path (field, POST, memory buffers, per-call copies, header), remembered ciphertext location/permissions/erasure verified; gaps fixed or recorded | no | done (ef0ad5d; lifecycle table in `SECURITY.md`; UI Forget key added) |
| S2 | Leak audit | Logs, errors, feed, export and API responses must carry no secret or raw provider payload | Each sink checked and tested; findings fixed or recorded | no | done (ce115f7; no new leak, see findings) |
| S3 | API route hardening audit | Loopback, Origin, content type, input and response bounds | Every route checked; gaps fixed with tests | no | done (ce115f7; no new gap, see findings; coverage in Q1) |
| S4 | Security headers for the local app | No CSP, framing or referrer policy on the main app | Headers on every main-listener response, tested, and the app verified working in Chromium in dev and production | no | done (ce115f7; `npm run test:e2e` passed in dev and production) |
| S5 | `npm audit` | Operator requirement | Non-breaking fixes applied; remainder recorded | no | done (ef0ad5d; 0 vulnerabilities, nothing to fix; patch/minor updates available but not applied, see findings) |
| S6 | `.gitignore` coverage | `.env*`, remembered credentials, logs and build artifacts | Patterns cover each class; check-staged and CI still pass | no | done (ef0ad5d) |

### Phase 3 — core function (P1)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | Keyless mock by default in `npm run dev` | Definition of Done item 2 | `npm run dev` starts with the mock unless `SAINTPETRUS_MOCK` says otherwise; `npm start` unchanged (mock off) | confirm (D-03) | done (37605ba; verified by hand in dev with and without the override) |
| F2 | Run one call for a selected agent from the inspector | `complete` action exists server-side with no UI; inspector output tab expects provider output | Inspector sends one budgeted call through the existing route for the selected agent; output recorded by the graph owner; works with the mock and no key | no | done (1a51407; mock usage no longer rewrites `config/prices.json`) |
| F3 | Edit agent name and objective | Operator's main flow lists editing | Server-validated `update` command with the create limits; UI in the inspector | no | done (a456256; browser check edits an agent) |
| F4 | Confirm destructive actions | Operator requirement | Reset graph, run mock (resets), pause all (cancels in-flight work), disconnect credential, delete connection, add price validity and apply confirmed usage all require explicit confirmation | no | done (f42e1e1; plus Forget key from S1) |
| F5 | Loading, empty and error states | Operator requirement | Every panel shows all three where applicable | no | done (f42e1e1; feed, preview, reservations empty states; connection badge unavailable state) |
| F6 | Export context from the UI | Export route exists without a UI entry | Download link to the existing endpoint; no new client fetch | no | done (f42e1e1) |
| F7 | Agent removal, graph import and persistence | Removal was deliberately blocked in `c01fb02`; import/persistence not planned in docs | Not implemented; questions Q-03 and Q-04 | yes | blocked (operator decision) |

### Phase 4 — quality (P2)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| Q1 | Coverage for critical modules | Token, credential, event and preview routes have uncovered branches | New tests with mocked transport only; coverage recorded | no | done (01f4faa; `tests/route-boundaries.test.ts`: token, price, provider, credential, graph and artifact-stream route boundaries; non-test line coverage 94.4% (baseline 93%), branches 91.9%, functions 87.7%, measured with `--experimental-test-coverage --test-coverage-exclude='tests/**'`) |
| Q2 | Browser end-to-end smoke check | Chromium is preinstalled in this environment | Dependency-free CDP script for the main flow in mock mode, outside the gate; run result recorded | no | done (53966fe documents `npm run test:e2e`; last runs green in dev and production after c8be837: main flow, keyboard move, drag, keyboard connect, 35/29 visible Tab stops, control names in four states, confirmations, no CSP violations or console errors) |
| Q3 | Basic accessibility | Keyboard, labels, visible focus, contrast | Focus-visible styles, labelled controls, keyboard paths checked; contrast of tokens measured | no | done (c8be837; contrast and field edges d6a0a59, D-08; arrow-key and group moves saved 3aa99bc; focus on cards and connections made visible and a keyboard path to connect agents added here, D-09; the browser check names every control in four states and walks 35 Tab stops in dev, 29 in production, all visibly focused. Not done: no screen-reader session, React Flow live-region announcements unverified) |
| Q4 | Dead code | Only when unused is proven | Removals backed by search evidence, or none | no | done (53966fe; none removed. Evidence: every source file is imported, every dependency is referenced, and exports used only by tests are either test seams used inside their own module or the published `lib/core` API, whose removal would also delete tests) |

### Phase 5 — documentation and DX (P3)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | README rewrite | Discrepancies listed in `docs/provider-validation.md` | What, requirements, install, mock run, main flow, key entry, security model, limits, validation status | no | done (53966fe; README rewritten from the code; the discrepancy list in `docs/provider-validation.md` is replaced by a note) |
| D2 | `docs/architecture.md` | Operator requirement | Modules and the path of one call | no | done (656819f) |
| D3 | `SECURITY.md` threat model | Operator requirement | Threat model; reporting contact left as a marked placeholder | contact (Q-05) | done (bbf8f03; the contact stays a marked placeholder until Q-05 is answered) |
| D4 | `CHANGELOG.md` | Operator requirement | What this session delivered | no | done (3bf5bf2; kept current until the final commit) |
| D5 | CI workflow | Operator requirement | Lint, typechecks, tests, build and Gitleaks on push and PR (workflow already exists; verify and adjust) | no | done (ca808da; verified: Gitleaks over full history, tracked-path check, `npm ci`, audit, lint, both typechecks, tests and build on every push and PR. Added: the test run is held to the AGENTS.md floor with zero failures, cancellations, skips and todos) |
| D6 | LICENSE | Operator requirement: do not choose one | Question Q-06 | yes | blocked (operator decision) |
| D7 | Permanent rules from this prompt into `AGENTS.md` | `AGENTS.md` requires prompt rules to be written down before acting on them | Test hygiene, dependency policy and published-secret stop rule added; floor kept current | no | done (5ff5bd3; also: contract changes carry docs and tests, no invented configuration values, keys nowhere and no `.env`, the list of guarantees not to weaken. Session-only rules such as this session's commit authorization were deliberately not made permanent) |

### Phase 6 — review and close

| ID | Title | Acceptance criterion | Status |
| --- | --- | --- | --- |
| R1 | Independent review of `0662647..HEAD` | Reviewer subagent that did not implement; confirmed findings fixed, discarded ones recorded with reason | done (two reviewers; 16 findings: 12 fixed, 1 documented with follow-up, 1 blocked on Q-10, 1 left to the operator, 1 open observation; see below) |
| R2 | Final gate and Gitleaks over the branch history | Recorded counts | done: `npm ci` and `npm audit` (0 vulnerabilities), lint, both typechecks, 400 tests in 29 suites (0 failures, 0 skips), build; `npm run test:e2e` in dev and production and `npm run test:browser` passed; Gitleaks clean on the full history (75 commits), `0662647..HEAD` (40 commits) and the directory |
| R3 | STATUS, NIGHT-LOG, handoff, Checklist do João | Updated in the final commit | done (this commit) |

### Phase 7 — operator answers to Q-01 to Q-10 (section 13, 2026-09-27)

| ID | Priority | Decision | Acceptance criterion | Status |
| --- | --- | --- | --- | --- |
| A-08 | P0 | Q-08 yes | Remembered keys move to the OS user data directory (dir 0700, files 0600); a legacy vault in the checkout is copied, verified and only then deleted; tests and docs | done (this commit; `lib/server/user-data.ts`, `lib/security/vault-migration.ts`, run by the server before it listens; mutations: overwrite allowed, original kept, file mode dropped and a relative override accepted are each killed) |
| A-10 | P0 | Q-10 yes | Expiry of an unpriced served model converts at max(estimate, reported) per dimension, at least at the requested model's peak/cache-miss rate; stays an estimate; never reduced automatically; agent stays paused until manual reconciliation; tests | done (this commit; reservation keeps the reported usage; expiry converts per dimension; resume skips the agent until manual reconciliation; five mutations killed, one only after an added reconciliation assertion) |
| A-01 | P0 | Q-01 yes | Mock is the default in every mode; real providers only with an explicit startup opt-in; the UI always shows MOCK or REAL | done (this commit; `SAINTPETRUS_MODE=real`, pinned at startup; retired `SAINTPETRUS_MOCK*` stop startup; keyed providers refused with `disabled` in MOCK mode, also for storing keys; header badge; four mutations killed) |
| A-07 | P0 | Q-07 | OpenAI removed from the allowlist and documented as unsupported until validated; no snapshot or price registered | done (this commit; `gpt-5-nano` removed from `config/token-policy.json`, `config/prices.json` untouched; the panel option is always disabled; tests pin both; mutation of the option killed) |
| A-03 | P1 | Q-03 yes | Removal with confirmation; refused while the agent has an active, unverifiable or unreconciled reservation; its `agent/A` accounting stays, marked removed | done |
| A-04 | P1 | Q-04 yes | Graph persisted in the user data directory; import as untrusted input (strict schema, size limit, unknown fields and credentials refused, models through the allowlist); export stays redacted; accounting documented as process-local | done |
| A-09 | P1 | Q-09 | Run once kept only through the same preflight and budgets, with a confirmation that shows the maximum reserved cost; removed if it duplicates another action | done: kept, since no other action sends an agent's own message and records its output (the probe sends a fixed message and records nothing). `quote` shares `TokenService.plan` with `execute` |
| A-02 | — | Q-02 | The operator validates locally; nothing to implement | done (no change) |
| A-05 | P3 | Q-05 empty | The security contact placeholder stays | done (no change) |
| A-06 | P3 | Q-06 empty | No LICENSE is created | done (no change) |

### Phase 8 — UI round (2026-09-27)

Presentation only: no route, API contract, graph file format, token/price/reservation logic, provider payload,
configuration value, run mode, security header or CSP changes. Reference for structure and density: the Orca
panel, nothing copied or loaded from it.

| ID | Item | Acceptance criterion | Status |
| --- | --- | --- | --- |
| U1 | Vocabulary and status | No text contradicts another about mode, connection or status | done |
| U2 | Demo kept apart | No single unconfirmed click replaces the graph | done |
| U3 | Agent panel with Run and Details | Run an agent and read the answer without scrolling or changing tab | done |
| U4 | Screen structure and navigation | Every current function reachable by mouse and keyboard; no route changes | done |
| U5 | Budgets | Summary, per-scope blocks, details table with every field and action | done |
| U6 | Activity | Drawer and full view, readable monospace lines, `agent.moved` hidden by default | done |
| U7 | First steps | Checklist derived from server state, dismissible in memory | done |
| U8 | In-app confirmations (P3) | Dialog instead of `window.confirm`, same texts, refuse-then-confirm in the browser check | done |
| U9 | Command palette (P3, optional) | Ctrl+K filterable list of existing actions | done |
| U10 | Finish | Dev indicator, README, CHANGELOG, STATUS, floor | done |
| UR | Usability review | A reviewer who did not build it tries the six goals from screenshots only | done: confirmed findings fixed, the rest recorded below |

#### Decisions taken

- U1: the connection chip names the model alone for the mock (`● Connected · mock-v1`) and `provider · model`
  otherwise; the mode badge is the only place that says MOCK or REAL. Cards read the connection from a React
  context rather than node data, so a connection change never recreates node objects.
- U1: the provider-status and token readers are lifted into hooks inside the same files, because the fetch
  ratchet pins direct `fetch` calls to those files.
- U1: the palette's AA contrast for the status colours is a test that reads `app/globals.css`.
- U2: Import, Export, Reset and Load demo live in a **More** menu (`@base-ui/react` Menu, wrapped in
  `components/ui/menu.tsx`); the main toolbar keeps Add agent, Add subagent, Fit all and, only while the demo runs,
  Pause/Resume demo. The empty canvas offers Load demo as a link. The Coordinator objective moved into the Reset
  graph dialog, which also names that the demo uses it. Graph limits show in both modes; Demo cost only in MOCK.
  Both still send the one existing `budget` command with all three values.
- U3: the header shows name, status, `model · MODE` (what Run once uses, from the one provider-status reader), role
  and level. Run is the default tab; the last exchange (message, answer, tokens, latency, cost) sits under Send.
  The cost is the `costUsd` of the agent's newest `call` receipt from `GET /api/receipts`, read once after the call
  through the existing accounting reader in `token-panel.tsx` (the fetch ratchet keeps its count at 2); it is never
  computed in the browser. Exchanges live in workspace memory per agent. Both tabs stay mounted so a draft survives
  a tab switch. The message field is not focused automatically: selecting a card with the keyboard must keep focus
  on the canvas so the arrow keys still move it.
- U4a: a fixed sidebar (brand, mode badge, Workspace/Activity/Budgets/Prices/Connection, the agent list with status icon
  and a Coordinator mark, Graph limits and Demo cost as collapsible sections) and one view at a time in the main column.
  Budgets, Prices and Connection became views; the chip in the top bar opens Connection. The canvas view stays laid
  out under the others (`visibility: hidden` plus `inert`): with `display: none` React Flow computed NaN geometry
  for its background and minimap. The optional feed and preview notices moved to Connection → Optional features;
  the preview is a tab of the drawer under the canvas. Leaving the Connection view unmounts the key field with its
  value, which replaces the dialog's "cleared on close".
- U4b: the top bar holds the connection chip, the budget meter and Pause all agents. The meter is the fullest of the
  global and session rows, used plus reserved over the limit in tokens or dollars (`lib/budget-summary.ts`), and it
  takes warning and stop from the server's own row state; it reads the one token snapshot and opens Budgets. The
  Ctrl+K hint arrives with the palette (U9).
- U5: Budgets opens with a summary (global tokens and dollars with bars, call count, held or expired reservations,
  one status sentence naming the problem and the way out, Resume eligible agents) and one block per scope with its
  meaning; unused rows wait behind Show all scopes, which is what hides the Gemini model row in MOCK. The former
  table, reservations with Apply confirmed usage and the allowlist live under Details with every field. The call
  count is read from `GET /api/receipts` through the accounting reader, again only when the global counters move.
  Agent rows show the agent's name from the graph; a removed agent keeps its id.
- U6: `lib/activity-log.ts` names each event, gives its relative time and marks `agent.moved` and `mock.delta` (one per
  demo character) as noise, hidden until "Show card moves and demo output" is ticked. The drawer under the canvas
  collapses; the Activity view shows the same log plus the live feed when the server has it on, in the same line
  format. The revision is kept, small. Graph events carry no agent id and no time, so their lines name the action
  only and the time is when this panel received them (kept in the projection as presentation state); naming the
  agent would mean inferring it from snapshot diffs, which `docs/reference/state-ownership.md` forbids. The live
  feed lines do carry the agent's name. The Run once exchange is not merged into the log (it is in the Run tab).
- U7: `lib/first-steps.ts` derives Add an agent (2+ agents), Connect two agents (1+ connection) and Run an agent (any
  non-blank output) from the server graph. A slim bar above the canvas (an overlay covered cards) shows while the graph is unfinished,
  says how to do the next step, replaces the old two-ways hint and keeps the empty-canvas Load demo link. Dismiss lasts
  until reload (memory only).
- U8: all twelve `window.confirm` calls go through `useConfirm()` (`components/confirm-dialog.tsx`, base-ui AlertDialog):
  same question text, first sentence as the title, a named action button, focus on Cancel. Without the provider the
  answer is no. The browser check answers the in-app dialog with its own buttons (a page script queues answers and
  records each question and where focus started), still refuses before confirming, asserts every dialog opened on
  Cancel and treats a native dialog as a failure. The remove question now says "stays in Budgets" (it said Tokens).
- U9: Ctrl+K (Cmd+K) opens a palette over the existing Dialog, listing views, canvas and graph actions, Pause all
  agents and every agent by name. Every word typed must appear (`lib/command-search.ts`); the order never changes and
  disabled actions are left out. Each entry calls the same handler as its button, confirmations included; Pause all
  moved into `askToPauseAll` so the button and the palette share it. The top bar shows "Commands Ctrl K".
- U10: `devIndicators: false` in `next.config.ts`, as the installed Next.js 16 guide documents; compile and runtime
  errors still surface. README (Main flow rewritten for the new screen), CHANGELOG (Interface section with the
  names table), STATUS, architecture and the floor updated. The preview browser check (`npm run test:browser`) had
  been broken since U1/U2 renamed "Run preview mock" and moved it into More, and it answered native dialogs; it was
  not run between those items. It now opens the Preview tab, goes through the More menu, answers the in-app
  confirmation and fails on a native dialog. It passes.
- Usability review (a subagent that saw only 13 screenshots and the six goals). Fixed:
  1. Send said "Running…" while the quote confirmation was still open; it now reads Checking the cost… → Waiting for
     your answer… → Running… (only after yes).
  2. An empty Activity log said "Nothing yet. Add an agent…" next to existing agents (the log covers this page only);
     it now says so.
  3. "Budget 6%" did not say used or left: "Budget 6% used".
  4. Dollars read $0.00 in one place and $0.000000 in another: one formatter. The sidebar's Demo cost is now marked
     fictitious and says what the demo and MOCK are.
  5. The Connection view's MOCK text contradicted its enabled buttons: it now says the mock is checked without network;
     "Test again" became "Test connection (1 call)"; "memory only by default" is spelled out.
  6. The chip's "Configured, not verified" is explained in its tooltip (configured is still not verified).
  7. Resume eligible agents was offered with nothing paused: disabled with "Nothing is paused."
  8. The model line in the agent panel now links to Connection; the Run tab says it is Run once and labels the last
     exchange as kept on this page only; handles and the Coordinator crown explain themselves on hover; Prices marks a
     priced model outside the allowlist (the operator's gpt-5-nano) as not selectable.
  Not changed: the mock's fixed answer "MOCK: connection verified…" and the event text "Provider output recorded."
  are server strings (Q-U3); selecting an agent from the sidebar pans the canvas to it, which can cut neighbouring
  cards at the edge (existing behaviour, kept); card text is small only when the canvas is zoomed out to fit.

#### Questions for João

- **Q-U1** Run once sends the agent's "Instruction" (`context.summary`), a fixed text such as "Manually configured
  agent. No provider connected." It says "No provider connected" even when one is. Changing it changes what is
  sent to the provider, so it is out of this round: the Details tab now shows it verbatim under "Instruction sent
  with Run once". Should it be reworded, or made editable?
- **Q-U2** Graph events do not say which agent they concern, so Activity lines read "Agent created" without a name
  unless the live feed is on. Adding `agentId` to the graph event would be a small server change (outside this
  round): worth doing?
- **Q-U3** The mock answers every Run once with "MOCK: connection verified. No external API was called.", and the graph
  event says "Provider output recorded." even for the mock. Next to a chip that says "not verified", a first-time
  reviewer read that as a contradiction. Both are server strings: reword them (for example "MOCK answer: no provider
  was called.")?

### Phase 9 — Round 3: operator decisions and server fixes (2026-09-28)

| ID | Item | Acceptance criterion | Status |
| --- | --- | --- | --- |
| Q-U3 | Mock and answer-event texts | Mock answers "MOCK answer: no model was called and nothing was billed."; `agent.output` says "Answer recorded."; verification unchanged | done |
| Q-U2 | Graph events say who and when | `agentId` + name (also on `agent.removed`), source/destination ids and names on connections, server `at`; strict client validation; Activity shows name and server time | done |
| Q-U1 | Run once sends the Objective | System instruction is the agent's Objective; quote and call share `TokenService.plan`; the connection test is unchanged | done |
| R-01 | Graph round trip | Credential-shaped text refused at create/edit; provider output redacted before the cut; the store never writes a document the parser would refuse | pending |
| R-02 | Persistent accounting | Append-only journal, 0700/0600, fsync per record; rebuild at start; lost in-flight → unverifiable; corrupt journal blocks real calls | pending |

#### Decisions taken

- Q-U3: the demo's own scripted text ("MOCK: This fixed demonstration…") is unchanged; only the Run once / connection
  test answer and the `agent.output` event message changed. The connection test still passes because the answer is
  not empty.
- Q-U2: parties are `{ id, name }` objects (`agent`, `source`, `target`) rather than flat `agentId`/`agentName` fields,
  built from the live agent at emit time. A subagent's `agent.created` carries its parent as `source`. `at` is
  optional in the type because the client's own command placeholders have no server time, but `isGraphEvent`
  requires it on every stream event. When the stream's event for a revision arrives after the command response,
  it replaces the placeholder's log line (so your own changes are named too); the graph is still taken only by the
  revision guard, and older events are still ignored. Activity time is now the server's clock, not the receive time.
- Q-U1: the route picks one `instruction` for both `quote` and `complete` (the agent's objective, unchanged) and the
  summary only for `test`, so the quote prices exactly what the call sends. Details labels the objective "Sent as the
  instruction with every Run once"; the summary is no longer shown in the agent panel (it is still in the graph file
  and still used by the connection test). `max_tokens` and budgets untouched. A longer objective now costs more
  input tokens per Run once; the confirmation shows it.

#### Questions for João

## V0 review of Part 2 (`1445177`)

Checked every section of `docs/provider-validation.md` and the `STATUS.md` change against the code.
Preparation steps, the code path table, the cost worksheet (`B_i`, `W_i`, `E_i`, `D_i`, `ceil12`), the
identity and usage contracts, the L0/V1/L1/V2/V3 expectations and the secret checks match the code.
The commit is documentation only and carries no secret or leaky instruction.

- **Confirmed code gaps the doc already names:** G1 → V1, G2 → V3, G3 → V4, G4 → V5, G5 wording → V2,
  G7 → V6, G8 → V8, G11 → V7. G6, G9 and G10 stay documented gaps.
- **Imprecisions, corrected in V9:** (1) the admission formula omits the strict pre-check: a row already
  at its limit refuses even a zero-cost reservation; (2) provider/model validation in
  `lib/providers/runtime.ts` covers the UI path, while a terminal or environment selection is checked
  against the allowlist by `TokenService` at execution, still before I/O; (3) the Gemini zero defaults
  for missing candidate, thought and cache counts are safe only because the total invariant catches a
  missing output count and a missing cache split prices at the dearer miss band; say so.
- **New defect, not in the doc:** a graph reset during an in-flight call made the pause hook throw
  inside `TokenService.execute`. Reproduced: a billed call ended with `unverifiable: 1` and no
  reservation (resume refused until restart), a mock call released its hold twice (`reserved: -127`),
  and a timeout surfaced as "Agent not found." Fixed in V10.
- **Protocol claim without a test:** selecting an explicit agent with `agentId` on `/api/provider`
  (only the forged-ID refusal is tested). Covered with F2, which adds the UI for it.

## Mutation log

| Item | Mutation | Result |
| --- | --- | --- |
| V10 | `TokenService.pause` calls the graph hook without the guard | killed by "A graph that drops an agent mid-call cannot jam a billed call or release its hold twice"; restored, sha256 identical |
| V1 | Gemini returns no `billingModel` | killed by the fixture reconciliation test and the new served-identity test |
| V1 | identity failure without field names | killed by "Gemini prices the model named by modelVersion…" |
| V1 | `String(modelVersion)` instead of normalization | killed by the same test (prefix and missing cases) |
| V8 | Gemini usage failure without names | killed by "A Gemini usage shape it cannot read reports the field names…" |
| V8 | Gemini missing usage object without names | killed by the same test |
| V8 | DeepSeek missing usage object without names | killed by "A DeepSeek response without a usage object reports its own field names…" |
| V2 | unpriced served verdict falls back to the mock release | killed by "A served model without a captured tariff stays unverifiable for every provider…" |
| V2 | reroute event claims reconciliation again | killed by both served-model tests |
| V2 | requested tariff used when the served one is missing | killed by three tests (DeepSeek, route, every provider) |
| V2 | route drops the structured 409 | killed by "The provider route reports an unpriced served model…" |
| V4 | proxy stops recording dispatches | killed by both ledger tests |
| V4 | DeepSeek records before its local thinking refusal | killed by both ledger tests |
| V4 | correlation ID dropped | killed by the preflight/positive-control test |
| V3 | Gemini always reports `reasoning` | killed by three Gemini usage tests |
| V3 | DeepSeek drops `reasoning` | killed by four DeepSeek tests |
| V3 | call receipt not appended | killed by three receipt tests |
| V3 | expiry receipt not appended | killed by the unbilled/unverifiable/expiry/manual test |
| V3 | manual receipt loses its journal interval | killed by the same test |
| V3 | reported usage dropped | killed by two receipt tests |
| V3 | journal no longer bounded | killed by the bounded-journal test |
| V5 | default timeout accepted as a validation value | killed by the parsing test |
| V5 | proxy ignores the startup value | killed by the process proxy test |
| V5 | status hides the active value | killed by the same test |
| V5 | route accepts a timeout field | killed by the request-body test |
| V5 | `scripts/server.ts` startup exits | not unit-testable without spawning Node (breaks the Codex sandbox); verified by hand: invalid timeout and invalid preview port exit 1, `50` starts and reports `validationTimeoutMs: 50` |
| V6 | DeepSeek removed from the terminal provider list | killed by the terminal helper test |
| V6 | extra arguments accepted again | killed by the same test |
| V7 | empty-output check removed | killed by the empty-output probe test |
| V7 | `empty_output` not mapped to `incomplete` | killed by the same test |
| V7 | whitespace-only text treated as visible | killed by the same test |
| V11 | OpenAI drops `billingModel` | killed by the OpenAI snapshot test |
| V11 | stream drops `billingModel` | killed by the same test |
| V11 | missing identity without names | killed by the same test |
| S1 | forget no longer cancels the call in flight | killed by "S1 the browser can forget a remembered key…" |
| S1 | status stops reporting a remembered key | killed by the same test |
| S4 | server stops sending the headers | killed by "S4 the custom server sends the headers…" |
| S4 | `frame-ancestors` dropped | killed by "S4 production headers…" |
| S4 | eval allowed in production | killed by the same test |
| F1 | default applied even over an explicit value | killed by "F1 the mock default comes only from the dev launcher…" |
| F1 | default given to `npm start` too | killed by the same test |
| F3 | service-side edit validation removed | first survived (the dispatcher validates too); a direct service test was added and kills it |
| F3 | `update` command not dispatched | killed by "F3 an agent name and objective can be edited…" |
| F2 | route stops recording the answer | killed by "F2 running one agent records the answer…" |
| F2 | a probe records output too | killed by the same test |
| F2 | recorded output unbounded | killed by "F2 a provider answer replaces only its agent output…" |
| F2 | mock call journaled into the price file | killed by "F2 synthetic mock usage never rewrites the operator price file…" |
| F2 | mock manual reconciliation journaled | killed by the every-provider served-model test |
| F4 | Reset graph without its confirmation | killed by the browser check ("Timed out: reset question"); UI confirmations are verified by `npm run test:e2e`, outside the gate |
| F5 | feed empty state hidden | killed by "F5 the feed and the preview say plainly…" |
| Q1 | tokens GET without the local-request check | killed by "Q1 token controls refuse foreign requests…" |
| Q1 | tokens GET broken owner answers 500 instead of 503 | killed by the same test |
| Q1 | tokens POST accepts unknown keys | killed by the same test |
| Q1 | prices GET broken catalog answers 500 | killed by the same test |
| Q1 | graph `move` dispatcher type check removed | survived, equivalent: `GraphService.move` rejects the same input with `Number.isFinite`, which does not coerce strings; the service range check was mutated instead |
| Q1 | `GraphService.move` range widened to 1e12 | killed by "Q1 graph commands validate moves…" |
| Q1 | provider GET without the local-request check | killed by "Q1 the provider route refuses foreign requests…" |
| Q1 | credentials POST without a client header | killed by "Q1 credential configuration refuses…" |
| Q1 | artifact stream without the local-request check | killed by "Q1 the artifact stream is local only…" |
| Q3 | `--input` back to the decorative border colour | killed by "Q3 field edges and the focus ring keep 3:1…" |
| Q3 | price field edge drawn with `--border` | killed by the same test |
| Q3 | muted text darkened to 3.6:1 | killed by "Q3 text tokens meet WCAG AA contrast…" |
| Q3 | unsettled drag frames saved | killed by "Q3 only settled positions are saved…" |
| Q3 | moves of one card sent concurrently | killed by "Q3 a burst of steps sends one request per node…" |
| Q3 | newest queued position dropped | killed by the same test |
| Q3 | refused move left as unconfirmed | killed by "Q3 a refused move stops sending…" |
| Q3 | canvas ignores settled moves (the old drag-stop-only wiring) | killed by the browser check ("Timed out: keyboard move saved by the server"), outside the gate |
| Q3 | inspector offers the selected agent as its own target | killed by "Q3 the inspector offers a keyboard path to connect…" |
| Q3 | Connect enabled before a target is chosen | killed by the same test |
| Q3 | inspector select edge drawn with `--border` | killed by "Q3 field edges and the focus ring keep 3:1…" |
| Q3 | card and connection focus override removed | killed by "Q3 cards and connections show keyboard focus…"; before the fix the browser check listed the three cards and the edge as invisible focus stops |
| D5 | floor check off by one | killed by "D5 a shrinking, skipping, failing or unreadable run is refused" |
| D5 | one skipped test tolerated | killed by the same test |
| D5 | CI step without `shell: bash` (no pipefail) | killed by "D5 CI holds every run to the floor…" |
| R1-01 | proxy back to `instanceof` | killed by "R1 a provider failure built by another copy…" and the ratchet |
| R1-01 | verdict back to `instanceof` | killed by the same two tests |
| R1-01 | brand never set | killed by "R1 a provider failure built by another copy…" |
| R1-01 | server builds the proxy again | killed by "R1 the server pins the validation timeout as plain data…" |
| R1-01 | routes ignore the pinned value | killed by the same test |
| R1-02 | graph route back to `instanceof` | killed by "R1 a refusal from the graph the server built…" and the ratchet |
| R1-02 | graph brand never set | killed by "R1 a refusal from the graph the server built…" |
| R1-15 | preview check without its dialog answer | killed: the check fails (exit 1, "Browser connection closed.") instead of hanging, and leaves no profile or Chromium process (also proves R1-04) |
| R1-11 | no early rethrow for a settled call | first survived (the test hook failed on every call, so the failure path died before overwriting the verdict); with a one-shot failure it is killed by "R1 a settled call stays settled…" |
| R1-11 | verdict recorded after the side effects | killed by the same test |
| R1-12 | service falls back to the requested model | killed by "R1 only the mock is priced as asked…" |
| R1-12 | proxy falls back to the requested model | killed by the same test |
| R1-07 | DeepSeek served model without names | killed by "R1 a DeepSeek answer without a served model names its fields…" |
| R1-08 | OpenAI totals not checked | killed by both OpenAI usage tests |
| R1-08 | OpenAI stream back to lax usage | killed by "R1 the OpenAI adapter refuses an unreadable usage on both paths…" |
| R1-08 | reasoning above output accepted | killed by "R1 OpenAI usage is parsed strictly…" |
| R1-13 | `busy` message removed | killed by "R1 the panel says which actions call a provider…" |
| R1-13 | floor parser back to TAP only | killed by "R1 the floor check reads the spec reporter as well as TAP…" |
| R1-09 | generation guard removed | killed by both generation tests |
| R1-09 | route records without its generation | killed by "R1 a probe that finishes after a credential change…" |
| R1-09 | clearing starts no new generation | killed by both generation tests |

## R1 independent review (two reviewer subagents over `0662647..HEAD`)

Two read-only reviewers, one on money and providers and one on security, UI and documentation, worked in
parallel without editing the tree. Each finding is listed with its disposition.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R1-01 | blocking (both reviewers) | `scripts/server.ts` built the provider proxy at startup from its own tsx copy of `lib/`; Next's route bundle reused that instance through `globalThis`, so every `instanceof ProviderFailure` failed across the copies: 401/404/429/busy/timeout all became `unverifiable` + 400 `invalid_request`, no credential was marked rejected and field names were lost. Regression from 3e15849 | fixed (52f2be6): the server pins only the timeout value; `ProviderFailure` carries a `Symbol.for` brand checked by `ProviderFailure.is`; a test imports a second copy of `lib/`; a ratchet forbids `instanceof ProviderFailure`; verified against the real production bundle |
| R1-02 | major, pre-existing | Same cause for `GraphError`: in the running server every graph refusal answered "Invalid request." (reproduced with curl: self-connection, missing agent) | fixed (this commit): `GraphError` carries the same kind of brand; the route test drives a graph built by another copy of `lib/`; the ratchet covers it; curl against a rebuilt production server returns the real messages |
| R1-03 | major | `npm run test:e2e` clicks Send even when a keyed provider is connected, and resets and pauses whatever instance it is pointed at | fixed (this commit): before any action the check reads `/api/provider`, `/api/graph` and `/api/tokens` in the page and refuses a connected keyed provider or an instance that is not fresh; verified against local stand-ins for both cases |
| R1-04 | minor | Browser check profiles live in `.audit/` and are not removed when Chromium dies or the run is interrupted (pending CDP calls never settle) | fixed (this commit): both checks share `scripts/disposable-chromium.mjs`, which puts the profile under the OS temporary directory, rejects pending calls when Chromium exits or the socket closes, and cleans up on SIGINT/SIGTERM |
| R1-05 | minor | Stale toolbar text "No API calls to LLMs." | fixed (this commit): the setup text says only Run once and connection tests call a provider |
| R1-06 | minor | Forget key acts only on the selected provider, and the saved-copy note disappears after Disconnect or a restart | documented (this commit): SECURITY.md, README and CHANGELOG now say the panel acts on the selected provider and `npm run key -- forget <provider>` covers any provider, also after a restart. Extending the panel is follow-up F-02 |
| R1-07 | minor | DeepSeek throws without field names when the served model is missing | fixed (this commit): it names the fields like Gemini and OpenAI |
| R1-08 | minor | OpenAI usage is not parsed strictly: bad usage loses the served model and the field names | fixed in part (this commit): `lib/providers/openai-usage.ts` parses usage strictly on both paths, fails closed with field names and reports the reasoning count. Not done: carrying the served model inside a usage failure so receipts and manual reconciliation can name it; that is true of every adapter and is recorded as follow-up F-01 |
| R1-09 | minor, plausible | A probe admitted while a new key is being configured can stamp its verdict on the new pair | fixed (this commit): every credential or selection change starts a new verification generation; the provider route records a verdict only for the generation it started under, as `connection-state.md` requires ("a stale result cannot restore it") |
| R1-10 | minor, pre-existing | Expiry of an unpriced served model converts the preflight estimate even when the provider reported more usage | done after the operator's answer (A-10) |
| R1-11 | nit, latent | A throw after settlement re-runs failure bookkeeping (double release on the mock, stuck unverifiable count) | fixed (this commit): the `billed` verdict, outcome and price are recorded the moment counters settle, and the failure path rethrows at once for a settled call |
| R1-12 | nit, latent | `billingModel ?? adapter.model` would price a keyed adapter that omits the served model at the requested tariff | fixed (this commit): only the mock may fall back, in the proxy and in the service; a keyed answer without a served model is `upstream` and stays `unverifiable`. Thirteen test doubles in four files now name their served model as every real adapter does; no assertion changed |
| R1-13 | nit | Docs: CHANGELOG floor, "200 settled calls" (the 200 are all receipt kinds), first-real-call names claim, 409 `busy` shown as a budget refusal, the floor parser reads only TAP | fixed: README receipts wording and `busy` message in 9dde12b, floor parser in c250efe; the first-real-call claim became true with 5e63ee1; the CHANGELOG floor is updated in the closing commit |
| R1-14 | nit | `AGENTS.md` says `.prompts/` vanishes in a fresh clone, but this backlog is force-tracked (D-02) | left for the operator: the sentence stays true for everything else in `.prompts/`; whether this file stays tracked on `main` is in the Checklist do João |
| R1-15 | major, found while fixing R1-04 | `npm run test:browser` hung since f42e1e1: "Run preview mock" now asks first and the preview check never answered the dialog | fixed (this commit): the check accepts and asserts the question; passes again |
| R1-16 | open observation | In `npm run dev` only, about 1 run in 15 the Tab walk found the canvas cards and edge focused (`:focus-visible` true) without the override outline, while every other stop kept its ring; never in production (every run passed). The compiled CSS contains the rule; the cause is unproven (a stale dev stylesheet is the leading suspect). The check now reports whether the override was loaded when it fails | open |

Follow-ups recorded by the review, not done in this branch:

- **F-01** When a usage shape cannot be parsed, every adapter throws before returning, so the served model the
  response did name is lost: receipts show `servedModel: null` and manual reconciliation journals only the requested
  model. Carrying the served model inside the `ProviderFailure` would fix it for all providers at once.
- **F-02** The panel's Forget key reaches only the selected provider, and the saved-copy note shows only while the key
  is in memory. Reporting saved copies per provider (names only) would let the panel forget any of them.

## Phase 2 security findings

- **S1 key lifecycle.** Traced end to end (table in `SECURITY.md`). Fixed: the UI had no way to delete a
  remembered key's ciphertext (Disconnect clears memory only), so Connect AI now has a confirmed **Forget key**,
  shows when an encrypted copy exists, and forget cancels a call in flight like Disconnect. Recorded, not
  changed: no idle expiry of the in-memory key; JavaScript strings (request body, header) cannot be zeroed; the
  vault lives in the ignored `data/vault` inside the checkout, outside Git but inside the folder (Q-08).
- **S5 dependencies.** `npm audit` (all and production): 0 vulnerabilities. Available but not applied, with no
  security driver: next/eslint-config-next 16.3.4 → 16.3.6, tsx 4.23.15, lucide-react 1.48, react/react-dom
  19.3, @xyflow/react 12.12, tailwind 4.3. Pinned versions were deliberate; upgrading is an operator choice.
- **S2 leaks.** Every error returned by a route is a fixed string or a code (TokenFailure, GraphError and
  PriceCatalogError messages carry no input), every response passes the redacting serializer, adapters never
  read error bodies, events redact before storage, receipts and the dispatch ledger hold numbers and IDs only,
  and app code has no console output. No new leak; known limits stay recorded (short key fragments, strings
  that JavaScript cannot zero).
- **S3 routes.** Every route checks loopback Host and Origin; every mutation requires the exact Origin and JSON;
  bodies are capped at 16 KiB, text inputs at 2000 characters, provider responses at 256 KiB, event, receipt,
  dispatch and artifact histories are bounded. GET routes have no side effect beyond converting already
  expired reservations. No new gap; uncovered branches go to Q1.
- **S4 headers.** CSP and companion headers on every main-listener response, verified in Chromium in dev and
  production with zero violations. `'unsafe-inline'` scripts remain because Next hydrates inline.
- **S6 ignore rules.** `.env*` (not only `.env` and `.env.*`), `*.log`, `*.p12`, `*.pfx`, `/out/`, `/build/`
  added; `.env.example` stays tracked.

## Decisões tomadas (decisions taken)

- **D-01 Commits.** `AGENTS.md` says the agent does not commit; the operator explicitly authorized
  commits and pushes to `night/provider-validation-ready` for this session. Per `AGENTS.md` this is an
  exception for this round, not a precedent, so it is not written into `AGENTS.md`.
- **D-02 Tracked backlog.** `.prompts/` is ignored and vanishes in a fresh clone, but this session can
  end at any time in an ephemeral container. The operator asked for the backlog to be committed, so this
  one file is added with `git add -f`; the ignore rule is unchanged.
- **D-03 Mock in `npm run dev` (implemented in F1).** The Definition of Done asks for
  `npm ci && npm run dev` to start in mock mode. The mock makes no network call and spends nothing. Only
  the development launcher changes its default; an explicit `SAINTPETRUS_MOCK=false` (shell or
  `.env.local`) still wins, and `npm start`, used for real validation, keeps the mock off. Reversible;
  confirmation requested in Q-01.
- **D-05 OpenAI price key.** `AGENTS.md` says the price key is the response `model`. The OpenAI adapter now
  follows it like Gemini and DeepSeek. Real OpenAI responses usually name a dated snapshot of the alias, so
  until the operator registers that snapshot's price, an OpenAI call stays unverifiable and pauses its agent.
  Conservative and reversible; see Q-07.
- **D-06 Run once.** The inspector can send one call for the selected agent through the existing `complete`
  action (no new route or client fetch), and the server records the answer as that agent's output. With the dev
  mock it is free; with a real provider it is an ordinary budgeted call the user clicks for. Reversible; Q-09.
- **D-07 Mock journal.** A browser run found that a mock call wrote a reconciliation entry into the tracked
  `config/prices.json`. Synthetic mock usage is no longer journaled; real reconciliation still is.
- **D-04 Language.** Code, UI, docs and commits stay in English as `AGENTS.md` requires; the final
  session report to the operator is in Portuguese.
- **D-08 Field edge contrast.** Measured text contrast passes WCAG AA everywhere (lowest 5.06:1), but field
  edges drew with the decorative `--border` at 2.43:1 on cards, under the 3:1 that identifies a field. The
  `--input` token now holds `#637682` (3.20:1 on card, 3.78:1 on background) and only field rules use it;
  dividers keep `--border`. Visual and reversible.
- **D-09 Keyboard paths.** Connecting two agents needed a pointer drag, so the inspector gained a labelled
  "Connect to" list and a Connect button that call the canvas's own `connect` (same client feedback, same
  server validation). It is an accessible path to an existing function, not a new feature. Focused cards and
  connections, which React Flow's stylesheet leaves without an outline, now show the ring. Reversible.

## Perguntas para o João (questions for the operator)

- **Q-01** Keep the mock on by default in `npm run dev` (D-03), or return to opt-in only?
- **Q-02** Real validation decisions from `docs/provider-validation.md`: provider, requested and possible
  served model IDs, tariffs, output caps, four-scope token and USD limits, total approved spend, dispatch
  observation method, disposable key, and whether unobserved cache, reasoning and 429 cases may stay
  unverified.
- **Q-03** Agent removal was deliberately blocked in `c01fb02` ("node deletion stays blocked"). Should
  it exist, and what happens to an agent's budget rows and unresolved reservations when it is removed?
- **Q-04** Graph import and persistence across restarts are not planned in the docs (state is
  process-local by design). Wanted?
- **Q-05** Security contact for `SECURITY.md` (placeholder left).
- **Q-06** LICENSE: none exists; which one, if any?
- **Q-08** Remembered keys are encrypted under the ignored `data/vault` inside the checkout. Move the vault to a
  per-user data directory outside the project folder (existing remembered keys would need re-entry)?
- **Q-09** Keep the inspector's Run once action (D-06), or restrict real-provider calls to the connection probe?
- **Q-10** When a provider answers with a served model that has no price, the reservation later expires into the
  preflight estimate even if the provider reported more usage (a review test: 4,000 input tokens against an estimate
  of 19). Should expiry convert at the greater of the estimate and the reported usage, per dimension, at the dearest
  captured tariff? Recommended: yes, since it only makes the guard stricter; it changes spend accounting, so it waits
  for you. Meanwhile the agent stays paused and Apply confirmed usage replaces the estimate with invoice figures.
- **Q-07** OpenAI now prices the served snapshot (D-05). Which dated IDs and prices should be registered
  before any OpenAI use, or should OpenAI be removed from the allowlist until then?

## Checklist do João

Everything below is yours; nothing in it needs this conversation.

1. **Verify the branch.** `git fetch origin night/provider-validation-ready && git checkout night/provider-validation-ready`,
   then `npm ci`, `npm run setup:hooks` and `npm run lint && npm run typecheck && npm test && npm run build`. Expect at
   least 400 tests and zero skips (the floor in `AGENTS.md`), and a green CI run on the branch head.
2. **Try the keyless panel.** `npm run dev`, open http://127.0.0.1:3000 and walk the main flow: add an agent, edit it,
   connect two agents (drag, or Connect to in the inspector), move a card with the arrow keys, Run once (mock), open
   Tokens and Connect AI, export the context, delete a connection, reset. Optional, with Chromium and a fresh instance:
   `PORT=3310 npm run dev` then `TEST_APP_PORT=3310 npm run test:e2e`; and the preview check from the README.
3. **Answer the questions** in "Perguntas para o João", above all Q-02 (the real validation plan), Q-05 (security
   contact), Q-06 (licence), Q-07 (OpenAI snapshot prices) and Q-10 (expiry with reported usage).
4. **Review the decisions** D-01 to D-09 in "Decisões tomadas" and revert any you disagree with; each is reversible.
5. **Fill the placeholders.** The security contact in `SECURITY.md`, a `LICENSE` file if you want one, and consider
   enabling GitHub private vulnerability reporting for the repository.
6. **Decide on this file.** `.prompts/FINISH-BACKLOG.md` is force-tracked on this branch (D-02); `AGENTS.md` says
   `.prompts/` does not survive a fresh clone, which stays true for everything else there. Keep it on `main` or untrack
   it before merging.
7. **Before any real call**, follow `docs/provider-validation.md` and `docs/reference/first-real-call.md`: allowlist the
   exact model in `config/token-policy.json`, enter its browser-verified price in Tokens → Prices (for OpenAI, the dated
   snapshot too), use a disposable key, and check the first call against the invoice before a second one.
8. **Merge.** No pull request was opened; open one from `night/provider-validation-ready` to `main` when you are ready.
9. **Optional maintenance.** CI warns that `actions/checkout@v4` and `actions/setup-node@v4` run on a deprecated Node
   20 runtime; moving to v5 is a major update, so it is yours to approve. Patch and minor updates are available for
   next, eslint-config-next, tsx, lucide-react, react, @xyflow/react and tailwind; none was applied (0 vulnerabilities).
10. **Follow-ups** F-01 and F-02 and observation R1-16 are listed with the review findings above.

## Session log

- Phase 0 inventory complete; this backlog written before any implementation.
- Phase 1 complete: V0–V11 done (V11 added by the review of V2). Floor 338 → 360.
- Phase 2 complete: S1–S6 done (Forget key UI, CSP and headers, key lifecycle table). Floor 360 → 366.
- Phase 3 complete except F7 (blocked on Q-03/Q-04): mock by default in dev, edit, Run once, confirmations,
  empty and unavailable states, export link. Floor 366 → 372.
- Phase 4 complete: Q1–Q4. Floor 372 → 384.
- Phase 5 complete except D6 (blocked on Q-06): README, architecture, threat model, changelog, CI floor check, rules in
  `AGENTS.md`. Floor → 387.
- Phase 6: two independent reviewers; 16 findings dispositioned (12 fixed, including a regression of this branch in
  which provider failures lost their codes in the running app). Final gate green at 400 tests; Gitleaks clean.
