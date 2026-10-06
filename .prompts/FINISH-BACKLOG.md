# SaintPetrus finish backlog

Persistent state for the autonomous finishing session on branch `night/provider-validation-ready`
(anchors `0662647` price admin, `1445177` validation protocol). The conversation is not the record:
this file and `git log` are. Written in English per `AGENTS.md`; the two section names the operator
asked for are kept in Portuguese.

## How to resume

1. `git fetch origin main && git status` must be clean and level with origin (the work moved to `main` in Round 4).
2. Read `AGENTS.md`, then this file, then `git log --oneline 1445177..HEAD`.
3. Continue from the first backlog item whose status is not `done` or `blocked`. Never redo a `done` item.
4. Gate for every commit: `npm run gate` (Round 4, R4-6), then the pre-commit hook runs Gitleaks on the staged diff
   (`npm run setup:hooks` once per clone; install the official Gitleaks release binary if missing, verified against
   its published checksum, or build it from `proxy.golang.org` with the hash checked against `sum.golang.org`).
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

- Answered (R3-1): count from the send time, `createdAt` + provider timeout + TTL. Was: a call lost to a crash gets its unverifiable deadline from the restart time (restart + `reservationTtlMs`),
  not from when it was sent. Expiry converts it at the conservative price either way, so this only decides how long
  the agent waits before the estimate appears. Keep it, or count from the original request time?
- Answered (R3-2): keep it; pauses are not released, and the screen points to Resume eligible agents. Was: "Start a new budget period" zeroes consumption in the global, agent and model scopes and keeps limits,
  pauses and the kill switch; it is refused while any reservation is open. Is that the period you want, or should it
  also clear pauses?

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
| R-01 | Graph round trip | Credential-shaped text refused at create/edit; provider output redacted before the cut; the store never writes a document the parser would refuse | done |
| R-02 | Persistent accounting | Append-only journal, 0700/0600, fsync per record; rebuild at start; lost in-flight → unverifiable; corrupt journal blocks real calls | done |
| R3-1 | Lost call's deadline from its send time | A reservation restored from a crash expires at `createdAt` + `DEFAULT_PROVIDER_TIMEOUT_MS` + `reservationTtlMs`; restarts never move it; a past deadline converts on the first read | done |
| R3-2 | New budget period unchanged | Zeroes consumption, keeps limits, pauses and Pause all, refused with an open reservation; the screen says paused agents stay paused and points to **Resume eligible agents** | done |

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
- R-01: `GraphService` refuses credential-shaped text (whatever the redactor would change) in name, objective,
  summary and artifacts at creation, in name and objective at edit, and in the Coordinator objective at reset, naming
  the field. `recordOutput` redacts and then cuts at 8000. `GraphStore` now redacts at write time (not when the change
  was scheduled) and runs `parseGraphDocument` on the exact text it would write: if the parser refuses, the last valid
  file stays and the operator is warned once per reason, without the offending text. The restore parser is unchanged.
  One case the door cannot see remains: a key configured after the text was written. The export and the stream redact
  it; the store refuses to save until the text is edited, and says so. Tests that relied on key-shaped text entering
  the graph now use a key registered afterwards. The refusal message avoids the word "Bearer" followed by text, which the
  response redactor would otherwise have cut. Real restart (SIGINT, same data directory): the refused add answered
  400 with the full message, the graph with its Run once output came back, nothing was set aside.
- R-02a: `lib/tokens/accounting-journal.ts` appends one JSON line per record (`state`, `receipt`, `period`) with an
  fsync, 0700/0600, in the user data directory (`accounting.jsonl`). `lib/tokens/accounting-state.ts` defines the durable
  state strictly (exact key sets; IDs, counts, amounts, price versions, verdicts and times only). A final line without
  its newline was being written when the process stopped; nothing acts before a record is synced, so it is cut, and only
  those bytes. Any other unreadable content moves the whole file aside as `accounting-rejected-<time>.jsonl`. The fsync
  itself has no killing test (a missing fsync is invisible without a power cut).
- R-02b: `TokenService` checkpoints its durable state (global, agent and model rows; reservations with captured price
  versions; pauses; kill switch; agent models; reservation sequence) after every change, skipping identical
  checkpoints, and journals every non-mock receipt. A keyed call's reservation is on disk before any provider I/O; if
  that write fails the hold is released, the call refused before I/O, and real calls blocked. The mock's usage and cost
  are kept apart (the mock has its own counters; its cost in a private map) and never reach the journal; its receipts
  are not journaled either, so receipt numbering after a restart continues from the last journaled receipt. The session
  row is never journaled. Only limits changed in Budgets are journaled (untouched ones keep following the policy file).
  Rebuild folds the records in order: `state` replaces, `period/operator` zeroes counters (limits, pauses and kill
  switch carry over), `period/journal_unreadable` empties and blocks until the next `operator` period. A reservation
  still `inflight` returns `unverifiable`, attached to the global, agent and model rows (not the new session), with the
  agent paused and a new deadline of restart time + `reservationTtlMs`; expiry then converts it conservatively, never
  releases it. A new budget period is refused while any reservation (inflight, unverifiable or estimated) is open.
- R-02c: the server reads the journal once at start (`openAccountingJournal`, after the graph) and pins the records as
  plain data; the routes' `tokenService()` rebuilds from them on creation, because the server's module copy must not
  construct `TokenService`. The rebuild therefore happens on the first route that needs accounting (Budgets polls it
  at once, and every call path goes through it); the server prints what it found. A journal that cannot even be opened
  (an I/O error, not bad content) does not stop the server: real calls are blocked with `journal_unopenable`, and a
  new budget period is refused because it could not be journaled, so the way out is fixing access and restarting.
  `POST /api/tokens` gains `new-period`, which answers 409 with its reason when refused (the other actions keep the
  generic 400); `GET /api/tokens` gains `accounting`. Budgets shows a warning with **Start a new budget period** when
  blocked, names calls recovered from a crash, and offers the action in Details when healthy; the summary no longer
  says "All budgets have room." while real calls are blocked. The sidebar and Global scope texts no longer say
  accounting is lost on restart. The protocol rule "do not restart with an open reservation" now reads: a restart no
  longer erases it, but avoid it because the session row, the feed and the dispatch ledger are part of the evidence.
- R-02 real restart (temporary `SAINTPETRUS_DATA_DIR`, SIGINT, same directory): a mock Run once, an agent token limit,
  a global USD limit and Pause all came back with the limits, the pause and the kill switch, with mock usage 0 and a
  new empty session row; directory 0700, file 0600. A journal given an extra state with an in-flight reservation and
  nothing closing it came back `unverifiable` with a new deadline, 90 tokens held in global and agent rows (not the
  session), the agent paused, and the server warned. A journal edited by hand was set aside as
  `accounting-rejected-<time>.jsonl`, real calls blocked, still blocked after a restart, unblocked by `new-period`
  (200), and recorded after the next restart. Browser check on a fresh instance passed.
- R3-1: the restored deadline is `createdAt + DEFAULT_PROVIDER_TIMEOUT_MS + reservationTtlMs`, computed in
  `TokenService.restore` from the journaled reservation alone. The normal timeout, not a validation timeout pinned
  for one run, because it is the latest the call could have lasted; the journal does not record which timeout was
  pinned. Conversion stays lazy (the first snapshot or receipts read), as for every other reservation. Tests: two
  restarts give the same deadline; a restart at the deadline converts at once, conservatively, never released, agent
  still paused. Mutations (restart time in place of `createdAt`, timeout dropped, TTL dropped) all killed.
- R3-2: behaviour unchanged. `askToStartBudgetPeriod` now resolves with whether the server started the period, and
  only then Budgets shows `periodNotice` (transient presentation state in the view): "A new budget period has
  started.", plus how many agents are still paused (or that Pause all is still on) and "Use Resume eligible agents".
  A cancelled or refused period shows nothing new. Recorded in AGENTS.md.

#### Questions for João

### Phase 10 — Round 4: a deleted delegation stopped the graph being saved (2026-09-29)

On `main`, after the merge of `night/provider-validation-ready` (`6c69307`). Found by the merge's browser check: the
server logged "Graph file refused: a subagent has no delegation connection." once and saved nothing more.

| ID | Item | Acceptance criterion | Status |
| --- | --- | --- | --- |
| R4-1 | A delegation is not deleted | The server refuses `disconnect` on a `delegation` edge with a message to remove the subagent; only `context` connections are deleted; the canvas explains it while a delegation is selected; recorded in `AGENTS.md` | done |
| R4-2 | Savable after every command | A test runs every `GraphService` command (create, subagent, connect, delete connection, remove, edit, move, limits, reset, output, pause, import) and parses the redacted snapshot with `parseGraphDocument` after each accepted one | done |
| R4-3 | Warning while the graph is not saved | While `GraphStore` refuses or fails to write, for any reason (R-01's key configured after the text included), a persistent warning shows the reason, never the refused text, until it saves again; a local read-only route exposes the state; documentation and tests in the same commit | done |
| R4-4 | Browser check | Deletes a context connection (refused, then confirmed) and checks that deleting the delegation is refused; no check removed | done |
| R4-5 | A configured key leaves the graph | Registering a key tells the graph through `lib/security/redact.ts` (listeners on `globalThis`, credentials not coupled to the store); the graph replaces every text the redactor would change with the redacted text, as its own event, and the store saves it at once; the command joins the invariant test; the live feed redacts again as it sends; tests with a key generated at runtime; recorded in `AGENTS.md` | done |
| R4-6 | The operator's answers to the R4-5 questions | (1) `npm run gate` runs CI's blocking steps in CI's order, CI calls it after `npm ci`, `AGENTS.md` requires it before every commit, an audit the registry does not answer is reported and never skipped; (2) the panel discards the Activity lines, the feed lines and the Run exchanges it received before `graph.redacted` and says why, tested through the function that decides it; (3) the preview stream redacts as it sends, and `AGENTS.md` says every stream does | done |

#### Decisions taken

- R4-1: `GraphService.disconnect` refuses a `delegation` edge before changing anything, with "A delegation connection
  cannot be deleted on its own. Remove the subagent instead."; the route answers 400 with it (the message survives
  the response redactor). Removing the subagent stays the only way a delegation goes. On the canvas, while a
  delegation is selected, a status line over the canvas names the subagent and points to **Details → Remove agent**
  (`delegationHint`). Delete on a delegation alone asks nothing and sends it, so the server's refusal is what the
  notice shows; in a mixed selection only the context connections are counted in the question and they are sent
  first, so an accepted deletion does not clear the refusal (`byDeletability`). The route test that expected a
  delegation deletion to succeed now expects the refusal and deletes a context connection instead, keeping every
  assertion it had and adding that removing the subagent takes the delegation with it.
- R4-4: the browser check tries the delegation first (the explanation shown, no question asked, the server's message
  on screen, the delegation still on the canvas and on the server), connects two agents from the keyboard, then
  deletes that context connection (refused, then confirmed) and checks that only it went. The two PASS lines for
  connecting and deleting swap order; none was removed.
- R4-2: `tests/graph-invariant.test.ts` holds two tests. One runs every command by name (create, create at a drop
  position, subagent, spawn, connect, move, edit, output, demo output, delete connection, remove, limits, pause one,
  compare-and-set, pause all, run status, import, reset), with the refusals that matter (a cycle, a delegation, an
  agent with subagents, limits the graph exceeds, an import while paused). The other is a seeded random walk of 3000
  steps over the same commands with valid and invalid arguments, and checks that each command was accepted at least
  once. After an accepted command the redacted snapshot must parse; after a refused one the graph must be unchanged
  and the error a `GraphError`. The test found three more ways to leave a graph the app could not save, fixed in
  `GraphService`: (1) automatic placement beside a parent at x or y near 100000 put the subagent outside the canvas,
  so placement is now clamped to ±100000 (two subagents placed at the very edge can overlap; they can be moved);
  (2) `recordOutput` cut the redacted text at 8000, and a cut inside `Bearer [REDACTED]` (as `Bearer [R`) was
  redacted longer again at write time, so the output is now trimmed back until the redactor leaves it unchanged
  (`savedOutput`, at most the length of that marker); (3) `appendMockOutput` appended without a limit, so demo output
  after a long answer passed 8000; it now goes through `savedOutput` as well. The mock's own text is unchanged by
  the redactor, so the demo and the preview are unaffected.
- R4-3: `GraphStore` keeps `GraphPersistence` (`lib/graph-persistence.ts`): `{ saving: true }`, or
  `{ saving: false, reason, since }` from the first refused or failed write until the next one that lands. The
  reason is the parser's own sentence only when the error is a `GraphError` (a Node `TypeError` quotes what it was
  given, so anything else becomes "Graph file refused."), or the fixed `GRAPH_UNWRITABLE` for a failed write, whose
  error still reaches the caller and the terminal as before. `since` is when saving stopped and stays while the
  reason changes. The route is `GET /api/graph/persistence`, registered in the custom server beside the stream
  because only the server's copy of the modules holds the store (so the registry's 405 makes it read-only); it
  checks `localRequest` and answers through `safeJson`. The panel reads it every second, like the token snapshot,
  through the GET that `lib/use-graph-transport.ts` already made for the fallback snapshot, so the direct-fetch
  ratchet is unchanged; it accepts only the exact shape and shows `GraphSaveWarning` under the top bar, with no
  dismiss button, until the state says it is saving again. The store only learns it cannot save when it tries to
  write, so a key configured after the text (R-01) brings the warning at the next change of the graph, not at the
  moment the key is configured (recorded in STATUS). The browser check asserts the route says `saving: true` after
  the connection steps and at the end. Checked by hand in Chromium on a throwaway instance: a file put where the data
  directory was made the next change fail, the route answered `saving: false` with the fixed reason, and the warning
  appeared right under the top bar (`role="alert"`, no button); with the directory back, the next change was saved
  and the warning went away. The delegation explanation was checked the same way, over the canvas.
- R4-5 (2026-09-30), the operator's answer to the R4-3 question. Their reproduction on `a77fdcc`, repeated here with
  a fictitious 32-character key generated at runtime and typed into an objective before it was registered, showed
  that the premise of R-01 and R4-3 did not hold for a key longer than "[REDACTED]": after `registerSecret`, with no
  change, `graph.json` kept the key in plain text; at the next change the store wrote the redacted copy with
  `saving: true`, because redaction shortened the text and the parser accepted it; and the graph in memory was never
  redacted, so once the key left the registry (Disconnect, Forget key) the next change wrote it back in plain text,
  still `saving: true`, with no warning. Only a key shorter than "[REDACTED]" in a field near its limit made the store
  refuse, which is the case R-01 tested.
- R4-5, what changed. `lib/security/redact.ts` keeps a second set on `globalThis`, `saintpetrusRedactionListeners`,
  read at every call rather than captured at load, so both copies of the modules always use the same one.
  `registerSecret` adds the key and then calls each listener, isolated, without passing the key; `onSecretRegistered`
  returns the unsubscribe. `GraphService.followSecrets()` subscribes `redactSecrets()`, and only `runtime()` calls it:
  the process graph follows the registry, while a graph built for a test, an import or a file does not.
  `redactSecrets()` runs every name (70), objective (2000), summary (2000), artifact (500) and output (8000) through
  `savedText` (the old `savedOutput` generalised: redact, cut to the limit, trim back to text the redactor leaves;
  names are trimmed too), and emits `graph.redacted` ("A configured key was removed from the graph.") only when
  something changed, so the store saves it with its usual 250 ms coalescing and a key the graph does not hold
  publishes nothing. Credentials still only register and unregister keys; they know nothing of the graph or the store.
  The live event feed sends `safeStringify(batch)`: the window's field names match none of the redactor's sensitive
  key names, so the shape the panel checks is unchanged. Activity names the new event "Configured key removed from
  the graph".
- R4-5, left as is. The artifact preview stream still sent its versions as stored, on the claim that only
  `appendMockOutput` calls `observeArtifact`. That claim was wrong (the operator caught it in R4-6): `TokenService`
  passes every Run once answer to `observeArtifact` when the preview is on, so the preview now redacts as it sends
  (R4-6, 3). Activity
  lines the open panel received before the key was configured keep the names they showed until the page reloads
  (STATUS says so). A key that is itself part of "[REDACTED]" would make redaction non-idempotent; real keys are long
  random strings, so it is not handled. The R-01 and R4-3 tests that register a key under a graph that does not
  follow the registry still hold: they test the store's refusal on its own.
- R4-5, tests. `tests/configured-key.test.ts`: with no other change, memory and the saved file lose the key and one
  `graph.redacted` event is published, and after the key is forgotten a later change still writes no key; a short key
  inside a name at its limit is cut back into the limit and the graph still saves; the process graph follows the
  registry while a standalone graph waits for `redactSecrets()`; the feed does not repeat the key or a fragment of it
  in an event published before it was configured. `tests/module-copies.test.ts`: a key configured through the routes'
  copy of the modules cleans the graph the server's copy built. `tests/graph-invariant.test.ts`: the command by name,
  with a key that lengthens a name at its limit, and in the random walk (type a key, configure it, forget it, redact),
  at most five keys configured at a time. Floor 495 → 500.
- R4-5, checked by hand on a throwaway instance started in REAL mode (the credentials route refuses keys in MOCK),
  with a fictitious key generated inside the check and never printed, and no action that calls a provider: typed
  into an objective, the key was in `graph.json`; configured through `POST /api/credentials` as the terminal client,
  with no other change, it was gone from the file (`[REDACTED]` in its place); after **Disconnect** and a change it
  stayed gone; `GET /api/graph/persistence` said `saving: true`. This is the real pair of module copies: the route
  bundle configured the key and the graph the custom server built was cleaned.
- R4-5, the browser check's own cleanup. The round's first `test:e2e` printed all 20 PASS lines and then exited 1 with
  `ENOTEMPTY: rmdir '…/saintpetrus-chromium-…/Default'`: Chromium wrote a temporary file
  (`Default/.org.chromium.Chromium.*`, the only thing left in the profile) while `close()` was removing it, and no
  Chromium process was left. Not a flake to rerun: `scripts/disposable-chromium.mjs` now removes the profile through
  `removeProfile`, with Node's own retry for that error (`maxRetries: 10`, `retryDelay: 100`), in `close()` and in the
  interrupt handler. `tests/disposable-chromium.test.ts` checks the options reach the removal and that a profile
  shaped like the one left behind is removed; the race itself cannot be forced deterministically. Floor 500 → 501.
- R4-5, CI red after the push (run 90, `7c1724c`): `npm audit --audit-level=high` failed before lint, on advisories
  published since the green run 89 with the same lockfile (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7 and
  GHSA-6j4f-fj2g-mc7p for `brace-expansion`, high; GHSA-hrr3-gc8f-f4qj for `fast-uri` and GHSA-j6r3-76f7-8jcv,
  GHSA-h3mg-xc3c-68pw for `ip-address`, moderate; all transitive, all development tooling). Not a change of this
  round, but it left `main` red, so it was fixed within the dependency rule: patch releases only (`brace-expansion`
  5.0.9 → 5.0.12 and 1.1.18 → 1.1.21, `fast-uri` 3.1.7 → 3.1.8, `ip-address` 10.7.0 → 10.7.2), `package.json`
  untouched. `npm audit fix` from this container's npm 10 also dropped every `libc` field the operator's newer npm
  writes, so the lockfile was regenerated with npm 11 (`npx npm@11 audit fix`, 15 lines changed, no `libc` lost) and
  installed with `npm ci` on npm 10, as CI does. `npm audit` found 3 before and 0 after; the gate and both browser
  checks passed on it. There is no line of ours to mutate: the audit is the check that fails without it. This round
  ran the gate but not `npm audit` before pushing; see the question below.
- R4-6, 1 (2026-09-30). `scripts/gate.mjs`, run as `npm run gate`, executes in CI's order `node
  scripts/check-staged.mjs --tracked`, `npm audit --audit-level=high`, `npm run lint`, `npm run typecheck`, `npm test`
  and `npm run build`, and stops at the first failure, naming it. The audit's failure line says to fix an advisory
  with a patch or minor release, to stop and report when there is no fix or the registry did not answer, and that the
  step is never skipped; the build's failure line repeats the Codex exception. npm runs through `npm_execpath`, so no
  shell is needed on any platform. The test step keeps printing its output, captures it into a temporary file outside
  the checkout and runs `scripts/check-test-floor.mjs` on it; it fails on the floor or on `npm test`'s own exit code,
  as CI's bash with pipefail did. CI now runs `npm ci` and then `npm run gate`; the Gitleaks job is unchanged, and
  check-staged moved after `npm ci`, which changes nothing it checks (tracked paths only). The D5 test that pinned
  CI's `tee` pipeline now pins that CI runs only `npm ci` and `npm run gate`; `tests/gate.test.ts` pins the steps and
  their order, the stop at the first failure, the floor checked by the real script and the exit code. `AGENTS.md`:
  the gate paragraph, the audit rule, the advisory rule and the lockfile note under Dependencies, and the Codex
  exception reworded for a gate whose last step is the build. README and the resume steps above point to it.
- R4-6, 3 (2026-09-30). The preview stream sends `safeStringify(store.snapshot())`: `ArtifactStore` redacts as it
  stores, but a version stored before a key was configured kept the key until it left the 20-version window. The
  version's field names match none of the redactor's sensitive key names, so the shape the panel checks is
  unchanged. `tests/configured-key.test.ts` stores a version with a key generated at runtime, configures it and reads
  the stream, as the feed test does; a ratchet in `tests/repository-ratchets.test.ts` lists the server's three
  streams (graph, feed, preview) and requires every `data:` frame to go through `safeStringify`, so a new stream joins
  the list. `AGENTS.md` records the rule, every stream redacts as it sends, and the ratchet file's description.
- R4-6, 2 (2026-09-30). `lib/cleared-history.ts` decides what the panel keeps: `historyAfter` turns a
  `graph.redacted` event into a log holding only that event, no Run exchanges and one more clearing; a reset still
  restarts only the log, and any other event keeps everything. The Run exchanges moved from the workspace's React
  state into the projection store, still in memory only, so the same function drops them; `historyWithExchange` drops
  an answer to a message sent before the latest clearing (the workspace binds each call to its render's count). The
  revision guard still keeps the graph from a stale event, but a stale `graph.redacted` (a command's response
  arrived first) clears the history all the same. The feed keeps the server's window as delivered and hides, by id,
  every line it had received when the projection counted a clearing (`followClearings`, `FeedLines`); a window whose
  cursor falls behind that mark comes from a restarted server and hides nothing. The Activity title of
  `graph.redacted` is now "Earlier activity cleared because a key was configured"; the feed says "No events since a
  key was configured." while nothing newer has arrived. `docs/reference/state-ownership.md` names both as
  presentation state. Not reachable from a browser check: MOCK mode refuses to store a key, and REAL mode is not
  started for a check.
- R4-6, residue (2026-09-30). The operator accepted what a tab keeps when nothing tells it of a key: the operator's own
  text, shown only in that tab, never on disk, in the export or a stream, gone on reload. No new event and no clearing
  on reconnection. `SECURITY.md` lists it under residual risk, with the case of a graph stream that was down while the
  key was configured and the advice to reload every open tab of the panel after configuring a key; its key lifecycle
  and `STATUS.md` point to it. `AGENTS.md` (Safety locks) records the rule: a residue that stays only in the memory of
  an open panel tab, and never reaches disk, the export or a stream, is documented as an accepted risk in `SECURITY.md`
  and opens no new round. The two wiring lines whose mutations survived stay as they are, also by the operator's
  decision. Documentation only: there is no line to mutate.

#### Questions for João

- Answered (R4-5): configuring a key takes it out of the graph at once, through a notification from the redactor, so
  credentials stay uncoupled from the store. Was (R4-3): should configuring a key make the store try to write at
  once, so a key that matches text already in the graph brings up the warning immediately instead of at the next
  change? Not done then: it would tie the credential path to the graph store.
- Answered (R4-6, 1): one gate, `npm run gate`, with exactly CI's blocking steps in CI's order, which CI runs after
  `npm ci`. Was (R4-5): should the local gate also run `check-staged --tracked` and `npm audit --audit-level=high`, as
  CI does? A push of R4-5 passed the old gate and still turned CI red on an advisory published the same day.
- Answered (R4-6, 2): the panel discards what it received before `graph.redacted` (Activity, feed, Run exchanges) and
  says why. Was (R4-5): Activity lines received before a key was configured kept their names until a reload.
- Answered (R4-6, 3): the preview stream redacts as it sends too. Was (R4-5): should it, although only demo text
  reached it? That premise was wrong: `TokenService` calls `observeArtifact` with Run once answers when the preview is
  on (`lib/tokens/service.ts`), so a version stored before a key was configured could go out unredacted.
- Answered (R4-6, 2): neither; the residue is an accepted risk, documented in `SECURITY.md`, and `AGENTS.md` says such
  a residue opens no new round. Was: the panel learns of a key only from `graph.redacted`, which the graph publishes
  only when it held the key; a key typed only into a Run once message, or a panel whose graph stream was down when
  the key was configured, keeps what it showed until the page reloads. Should configuring any key publish its own
  event for the panel, or a reconnection clear the history too?
- Answered (R4-6, 2): accepted as is. Was: two wiring lines have no test that dies with them (`EventFeed` following
  clearings, the workspace binding an answer to its render's count), because only a browser runs them and no browser
  check can configure a key. Should the browser check get a way to register a fictitious key in MOCK mode?

### Phase 11 — Round 5: agents cannot be un-paused (2026-09-30)

On `main` from `23f3052`. The operator reported that the panel offers no way to un-pause the agents, without knowing
which path fails, which button or message shows, or whether it happens in MOCK, in REAL or in both. A state with no
way out: after any pause the operator needs a visible, explained and tested way back to a usable graph, or a sentence
that says why not yet and what to do. No request with a real key is made in this round.

| ID | Item | Acceptance criterion | Status |
| --- | --- | --- | --- |
| R5-1 | Reproduce before changing anything | Every entry (E1 Pause all at rest, E2 Pause all during the demo, E3 a full scope for agent, model, global and session, E4 a restart with pauses and the kill switch journaled, E5 an unverifiable reservation by service test) against every exit (X1 Resume eligible agents, X2 Resume demo, X3 raise the limit then X1, X4 a new budget period then X1, X5 restart, X6 Reset graph), from a fresh MOCK instance, with the screen and both GETs as evidence; the table below; no fix without a failing cell | done |
| R5-A | A new critical advisory | `npm audit --audit-level=high` turned red during the round (GHSA-vcvr-r3jv-pc5j, remote code execution in `next/og` ImageResponse, `next` 16.2.0 to 16.3.5): take the patch release and a green gate, in its own commit | done |
| R5-2 | Pause all leaves no dead end (C1) | After Pause all agents and Resume eligible agents, with nothing else holding them, every agent is Ready, the run is not `paused` unless the demo was paused with Pause demo, Import, Reset, Load demo and Graph limits are enabled and the server accepts remove and import, in MOCK and in REAL; a demo that Pause all paused goes on; a demo paused on purpose says on screen how to finish it; with Pause all on, the graph route keeps refusing start, resume, add, reset and preview-mock, and import joins them | done |
| R5-3 | One owner for pauses (C4) | The graph never shows a pause the token service does not hold, nor hides one it holds, after any command: an agent that leaves the graph leaves no pause behind unless it still holds a reservation, and an agent that comes back (reset, import, restore) or that the demo drives shows the token service's pause | done |
| R5-4 | Every pause says why (C2) | The token snapshot carries, for each paused agent, what holds it (Pause all, unverifiable usage and until when, an estimate awaiting reconciliation, every full scope with its dimension and whether the mock's usage fills it); resume answers whom it released, and a refusal answers 409 with the server's sentence; Budgets says it by the button, from a pure function in `lib/budget-summary.ts`; contract documented and tested | done |
| R5-5 | A visible way back (C3) | Resume eligible agents next to Pause all agents in the top bar while something is paused, and in Ctrl+K, with the same command and text; the panel of a Paused agent says why and opens Budgets; the kill switch refusal names the way | done |
| R5-6 | A new budget period says what it clears (H5) | The dialog and Details say that the mock's usage and the session budget stay until a restart; the semantics wait for the operator | done |
| R5-7 | Pause and resume invariants | A seeded walk over pause all, resume, raise a limit, new period, reset, import, remove, add and a call refused by a full scope, with the invariants written and justified | done |
| R5-8 | Browser checks | The workspace check goes back from Pause all through the new Resume, and through a full scope that Resume cannot release until the limit rises; no PASS removed; REAL without a key shows Pause all and Resume and no Resume demo | done |
| R5-9 | Documentation | STATUS, CHANGELOG, README and a one-line guarantee in `AGENTS.md` | done |
| R5-10 | Unverifiable usage names no cause it cannot know (C2) | Found re-running E5 at the end: the refused resume, the pause and Budgets said "a call lost contact with its provider" for every unverifiable reservation; lost contact, unreadable usage and an unpriced served model now read alike, without a false cause | done |
| R5-11 | A new budget period clears the mock's tokens everywhere (answer to R5-Q1) | The period zeroes the global, agent and model rows and the mock's tokens in every row; the session row loses only its mock part and keeps what real calls spent; a scope the mock filled is released by the period and the next Resume; limits, pauses, Pause all and the journal format unchanged | done |
| R5-12 | An ordinary expired estimate does not hold its agent (answer to R5-Q2) | No code change: `holds()` holds an agent only for an estimate with reported usage (an unpriced served model); a test pins that a present agent's ordinary estimate holds nothing, the agent resumes and calls again, and the estimate stays counted in all four rows | done |
| R5-13 | A preflight refusal no longer pauses (answer to R5-Q3) | "Preflight reservation exceeds token or monetary budget." is refused as before, with nothing sent, and pauses no one; a full scope, unverifiable usage, an estimate awaiting reconciliation and Pause all still pause; route, service and walk tests; docs say only a full scope pauses | done |

#### R5-1 reproduction (2026-09-30, before any change, at `23f3052`)

A throwaway probe outside the checkout started a fresh `npm run dev` in MOCK with its own temporary
`SAINTPETRUS_DATA_DIR` for every cell, seeded Writer with a subagent Helper through `POST /api/graph`, applied the
entry and the exit through the panel in a disposable Chromium (buttons, menu and confirmations as a person uses them),
and read both GETs and the screen after each. Probes at the end asked the server itself: a Run once quote for every
agent, an export imported back, and removing a leaf agent. E3 lowered one scope's limit to 300 tokens, sent Run once
until the server refused (always "Preflight reservation exceeds token or monetary budget." at 225/300), then set the
limit to what was used (100%). E4 is E1 or E3-agent followed by a restart on the same data directory. No provider was
called; REAL ran once without a key and without the provider route.

"normal": every agent Ready, the run not `paused`, Import, Reset, Load demo and Graph limits enabled, import and
remove accepted, Run once quotes accepted, Budgets says "Nothing is paused.". "partial": some of that. "no": every
agent still Paused.

| Entry | X1 Resume eligible agents | X2 Resume demo | X3 raise, then X1 | X4 new period, then X1 | X5 restart | X6 Reset graph |
| --- | --- | --- | --- | --- | --- | --- |
| E1 Pause all at rest | partial: agents Ready and "Nothing is paused.", but the run stays `paused`, so Import, Reset, Load demo and Graph limits stay disabled and the server refuses import and remove ("Reset the mock run before …"); "Resume demo" stays on the toolbar | no: "Resume demo" is on the toolbar right after Pause all, with no demo, and answers only "Global kill switch is active." | partial, as X1 (nothing to raise) | partial, as X1 | no: still paused, but Budgets says why; the run comes back `idle`, so X1 after it is normal | no: Reset graph disabled; the route answers 409 "Global kill switch is active." |
| E2 Pause all during the demo | partial, as E1 (here the demo really is paused) | no, as E1 | partial, as X1 | partial, as X1 | no, as E1 | no, as E1 |
| E3 agent scope full | partial: Resume answers 200 and nothing changes, with no word near the button; Budgets names the scope | partial: no Resume demo (run idle) | normal | partial: the new period keeps the mock's usage, so the scope stays full, although the dialog says consumption "starts again from zero" | partial: the restart clears the mock's usage, but the agent stays Paused and Budgets says "All budgets have room." | partial: the paused agent is gone, its id stays in `paused`, Resume stays enabled, and Budgets asks to raise the limit of a raw id the server refuses to raise |
| E3 model scope full | partial, as agent; other agents' calls are refused too | partial, as agent | normal | partial, as agent | partial, as agent | partial, as agent |
| E3 global scope full | partial, as agent | partial, as agent | normal | partial, as agent | partial, as agent | partial, as agent |
| E3 session scope full | partial, as agent | partial, as agent | normal | partial: a new period leaves the session row alone | partial, as agent | partial, as agent |
| E4 restart after Pause all | normal (the run came back `idle`) | no: no Resume demo | normal | normal | no: every agent still Paused, Budgets says why | no: Reset enabled (run idle) but refused with "Global kill switch is active." and no way named |
| E4 restart after a full agent scope | normal | partial: Paused with "All budgets have room." | normal | normal | partial: Paused with "All budgets have room." | partial: stale id, Resume enabled with nothing to resume |

E5, by service test (fictitious model and tariff, an adapter that times out, injected clock, no network): while the
reservation is `unverifiable`, `POST /api/tokens` resume answers 400 "Token control rejected. Check scope, limits and
unverifiable usage." (with Pause all on, too; it stays on), and the graph route refuses reset with "Global kill switch
is active."; after expiry resume works and releases the agent, but a run paused by Pause all stays `paused`. With an
unpriced served model (A-10), resume after expiry answers 200 and leaves the agent paused without a word; Budgets
speaks only of "1 expired reservation … counted as an estimate".

Extra sequences: (S1b) a leaf agent paused by its full scope and removed stays in `TokenService.paused` for good:
resume answers 200 and keeps it, raising its limit is refused ("Unknown budget scope" behind the generic 400), and it
survives a restart through the journal; Budgets says "All budgets have room." with Resume enabled. (S2) the Coordinator
paused by a refused call, then Reset graph: the new Coordinator is Ready on the canvas while Run once answers "Agent
paused.". (S3) Pause all during the demo, Resume eligible agents, then Resume demo: the demo finishes and the graph is
usable, but nothing on screen names the second step. (S4) a call refused by preflight at 75% pauses its agent while
Budgets says "All budgets have room."; Resume releases it and the next call pauses it again. (S5) REAL without a key:
Pause all, then Resume eligible agents: agents Ready, the run stays `paused`, no Resume demo exists, Import, Reset and
Graph limits stay disabled and the server refuses import and remove: only a restart gets out.

Hypotheses: H1 confirmed (E1, E2 × X1, X3, X4; S5 in REAL has no way back but a restart). H2 confirmed (E1, E2 × X2;
the way back is only in Budgets). H3 confirmed (E3 × X1; `budgetStatus` names one row by construction). H4 confirmed
(E5). H5 confirmed (E3 × X4). H6: (a) as stated, a graph Paused that the token service does not hold, was not
produced by any sequence tried and is refuted; the reverse divergence is real (S2, and an import accepted while Pause
all was on after a restart, E1 × X5); (b) confirmed (S1b, E3 and E4 × X6). H7 confirmed by reading. Also found: S4, and
a pause the journal restored with nothing to explain it (E3, E4 × X5). The most likely account of what the operator
saw: H1 with H2. Pause all agents leaves the run `paused`, so the canvas offers "Resume demo", which answers only
"Global kill switch is active."; the real way out, Resume eligible agents, sits in Budgets; and even after it the run
stays paused, so Import, Reset, Load demo and Graph limits stay off and the server refuses remove and import. In REAL
there is no Resume demo, so only a restart gets out.

#### After the fixes (2026-09-30, at `79ab1d7`)

The same probe and the same 48 cells on fresh MOCK instances, now also reading the notice under the top bar and the
reasons beside Resume eligible agents. "normal" as before; "held" means something still holds an agent and the screen
says what and the way out; a dead end (paused or blocked with nothing on screen to say why) was never found. 15
normal, 33 held, 0 dead ends. Every hold below is by design; three of them are the operator's questions.

| Entry | X1 Resume eligible agents | X2 Resume demo | X3 raise, then X1 | X4 new period, then X1 | X5 restart | X6 Reset graph |
| --- | --- | --- | --- | --- | --- | --- |
| E1 Pause all at rest | normal | held: no Resume demo exists; the notice and Budgets name Resume eligible agents | normal | normal | held: Pause all is journaled; the notice names the way | held: Reset is refused with "Pause all agents is on, so every agent is paused. Use Resume eligible agents first." |
| E2 Pause all during the demo | the demo goes on, agents Ready; Import and Reset wait for it with the demo sentence | held: Resume demo is refused with the same Pause all sentence | as X1 | as X1 | held, as E1 | held, as E1 |
| E3 agent scope full | held: "No agent was resumed." and Writer's sentence names the full scope, filled by the mock's estimated tokens, and the way | held: no Resume demo; the notice names the scope | normal | held: the period keeps the mock's usage, as its question now says (R5-Q1) | held: the mock's usage is gone and the notice says "nothing holds it now: use Resume eligible agents" | normal |
| E3 model scope full | held, as agent | held, as agent | normal | held, as agent | held, as agent | nobody paused; Budgets says the scope is full and to raise its limit; a quote is refused as exhausted |
| E3 global scope full | held, as agent | held, as agent | normal | held, as agent | held, as agent | as model |
| E3 session scope full | held, as agent | held, as agent | normal | held: the period leaves the session row, as it says (R5-Q1) | held, as agent | as model |
| E4 restart after Pause all | normal | held, as E1 | normal | normal | held, as E1 | held, as E1 |
| E4 restart after a full agent scope | normal | held: "nothing holds it now: use Resume eligible agents" | normal | normal | held, as X2 | normal |

E5, by service test on the final code: while usage is unverifiable, resume answers 409 "Usage unverifiable: a call's
cost could not be confirmed, so no agent can be resumed until <time>, when its reservation becomes an estimate.
Check the provider billing meanwhile." (Pause all stays on after the refusal, and Reset is refused with the Pause all
sentence); after expiry, lost contact releases the agent, and an unpriced served model keeps it with "its expired
estimate reservation-1 waits for the provider-confirmed usage. Apply the confirmed usage to reservation-1 in
Details, then use Resume eligible agents." S4 stays as R5-Q3 describes. One nit left: in the X6 cells of E3 model,
global and session nobody is paused, yet Budgets ends "then use Resume eligible agents", whose button then says
"Nothing is paused.".

#### Decisions taken

- R5-A (2026-09-30). The gate of R5-2 stopped at `npm audit --audit-level=high` on an advisory published after CI's
  last green run on `23f3052`: GHSA-vcvr-r3jv-pc5j, critical, remote code execution in `next/og` ImageResponse,
  `next` 16.2.0 to 16.3.5. `next` was pinned at 16.3.4; the fix is a patch release, 16.3.8 (the latest). Only `next`
  moved: `package.json` pins 16.3.8, the lockfile was regenerated with npm 11 (`npx npm@11 install --package-lock-only`,
  80 lines, only `next`, `@next/env` and the eight `@next/swc-*` packages; the 38 `libc` fields kept) and installed
  with `npm ci` on npm 10, as CI does. `eslint-config-next` stays at 16.3.4: the advisory does not concern it. MIT,
  no telemetry change, actively maintained. `npm audit`: 1 critical before, 0 after; the gate and the browser check
  passed on it (`next dev` did not rewrite the `AGENTS.md` block). There is no line of ours to mutate. The gate ran on
  the working tree, which also held the uncommitted R5-2 change: the tree committed after R5-2 is the one gated.
- R5-2 (2026-09-30). `GraphService.pauseAll` pauses the run only while it is `running`, so Pause all at rest leaves the
  run `idle`, `completed` or `blocked` and Resume eligible agents gives the whole graph back. `MockProvider.pause`
  records who paused the demo (`Pause demo` or `Pause all agents`); the token service's new optional `resumeAll` hook,
  called when a resume turns Pause all off, runs `mock.resumeAfterPauseAll()`, which lets only a demo Pause all paused
  go on. The graph route and the import route answer 409 `pauseAllRefusal` ("Pause all agents is on, so every agent
  is paused. Use Resume eligible agents first.") for reset, start, resume, add, preview-mock and now import, which the
  old `paused` run status used to refuse by accident. The demo refusals of remove, import and Graph limits name the
  demo and both ways out. The canvas keeps Reset graph enabled while the demo is paused (the server always accepted
  it) and says "The demo is paused. Resume demo finishes it, or Reset graph ends it; either gives the graph back for
  editing." Three tests pinned the old contract and changed with it: A-03 and A-04 matched "mock run" in the demo
  refusal, and R4-2 relied on Pause all pausing a blocked graph to refuse an import; its random walk also imports a
  standalone peer now, because imports land twice as often (102 against 58 in 3000 steps) and the walk had covered
  "delete connection" once only; with the peer it is accepted three times. Tests: `tests/pause-resume.test.ts`
  (MOCK and REAL, the demo either way, every refusal with its sentence) and the browser check (return path and the
  paused demo).
- R5-3 (2026-09-30). `TokenService.prunePauses` drops the pause of an agent that is not in the graph and holds no
  reservation; `snapshot`, `resume` and `restore` run it first, so no reader ever sees a pause of a removed agent and
  a journal written before this round loses its stale ids as it is read back, before an import could bring them
  back. A removed agent that holds a reservation keeps its pause (an import can bring it back while its usage is
  unsettled; the import route only refuses while a present agent holds one). `GraphService.followPauses` takes the
  token service's `holdsPause`, wired once by `lib/tokens/runtime.ts` for the process graph: `reset` keeps the
  Coordinator's held pause, `replace` (import and restore) marks every held agent paused although the file says
  ready, and `setAgentStatus` and the demo's exhausted budget never replace a held pause; only the token service's
  release (`compareAndSetAgentStatus` after `resume`) does. Graphs built for tests and files follow no one.
  `docs/reference/state-ownership.md` says the token service owns every pause.
- R5-4 (2026-09-30). `TokenService.holds(id)` lists what holds an agent, in the server's terms: `pause_all`,
  `unverifiable` (with `until`, the latest deadline of an unverifiable reservation), `reconciliation` (an unpriced
  served model's estimate), `budget` for every full scope the agent's calls are checked against (the same scopes
  `resume` checked before: global, session, its agent row and the models it called), with `dimensions` and `mock`
  (the row would have room without the mock's process-local usage), and `reservation` for a removed agent that keeps
  its pause. `resume` releases an agent only when nothing but Pause all holds it, the rule it had, now on one code
  path with the snapshot's `pauses`; a refusal names until when ("Usage unverifiable: … until <ISO time>, when its
  reservation becomes an estimate. Check the provider billing meanwhile."; the accounting-restore test's
  `/Usage unverifiable/` still holds). The route adds `resumed` and answers a refused resume with 409 and that
  sentence, as a new period already did. `lib/budget-summary.ts` words it: `pauseSentence` (one agent, every hold and
  what releases it), `pauseSummary` (Pause all as one headline, then only what else holds someone), `resumeOutcome`
  and `resumeReplyCurrent` (a resume's answer is dropped once the pauses change). `useTokenSnapshot.resume` goes
  through `command`, which can hand its reply to a caller; no new `fetch` (the ratchet allows none). `budgetStatus`
  names every full scope and skips a removed agent's row; Details disables its limits, which the server refuses. Five
  test fixtures that build a `TokenSource` by hand gained `resume` and `resumeReply`.
- R5-5 (2026-09-30). `ResumeEligibleButton` stands beside `PauseAllButton` in the top bar while `resumable(snapshot)`
  (Pause all on, or any pause) and runs the same `tokens.resume`; Commands gains "Resume eligible agents" (group
  Budgets), disabled when nothing is paused. `PauseNotice` shares the row under the top bar with the save warning
  (`.topbar-notices`) on every view but Budgets, which says the same beside its own button: the last answer while it
  still holds, `pauseSummary`, and "Open Budgets". `AgentInspector` takes `pause` (the agent's `pauseSentence`) and
  `openBudgets`, and shows both while the agent is Paused. The kill switch refusal already named the way (R5-2). The
  R4-3 test that pinned the save warning right after the top bar now allows the shared row. The browser check goes
  back from Pause all through the top bar, and again through Ctrl+K.
- R5-6 (2026-09-30). Wording only; the service is unchanged. `startBudgetPeriod` zeroes real consumption in the
  global, agent and model rows, sets their `used` back to the mock's process-local tokens and skips the session row,
  as it did; the question before it and the Details line said "Consumption … starts again from zero", which is why
  E3 × X4 left a scope the mock filled full after a period that claimed to empty it. Both now say `periodClears`
  from `lib/budget-summary.ts`: "Real consumption in the global, agent and model budgets starts again from zero. The
  mock's estimated tokens from this server run and the session budget stay until the server restarts." The test
  ties the words to the behaviour: a period after one mock call and one keyed call (mocked transport) leaves real
  consumption at zero, the mock's tokens in every non-session row and the session row untouched, and the question
  and Details carry the same sentence, so a later change of semantics fails it until the words follow. Whether the
  semantics should change is below.
- R5-7 (2026-09-30). `tests/pause-invariant.test.ts`: the routes (`/api/tokens`, `/api/graph`, `/api/graph/import`,
  `/api/provider`) and the process token service as `lib/tokens/runtime.ts` wires it, in memory (no journal pinned),
  with the configured policy and limits the walk sets itself. Seeded commands: Pause all, resume (twice as often, so
  calls meet budgets and not only Pause all), raise a limit (mostly a row without room for a call's worst case, by
  150 or 5000 tokens), fill a scope (the limit set to what is used, or 1 when nothing is; now and then a removed or
  missing row), new period, Run once calls, the connection test, quotes, add, remove, Graph limits, reset, export and
  import of an earlier export. After every step: (1) the graph shows Paused exactly for the agents the token service
  holds, and `paused` and `pauses` agree (one owner, R5-3); (2) a removed agent keeps a pause only with a reservation
  of its own (R5-3); (3) with Pause all on, every agent names it as a hold (R5-2, R5-4); (4) whenever anything is
  paused, `resumable` and `pauseSummary` offer the way back (R5-5), every present agent's sentence ends on Resume
  eligible agents and a full scope's names Details (R5-4); (5) the run is never `paused`, since no demo runs (R5-2);
  (6) every refusal carries a sentence or a code, a refused graph or budget command changes neither the graph nor the
  pauses, and with Pause all on add, reset and import answer `pauseAllRefusal` (C2, C3); (7) a quote never pauses,
  a call pauses at most its own agent and the connection test only the Coordinator; (8) a resume releases exactly
  the agents nothing but Pause all holds, answers them in `resumed`, turns Pause all off and keeps every other hold.
  The MOCK walk (2000 steps) must accept every command and reach a resume that releases someone, one that releases no
  one, one that leaves a full scope holding an agent, Pause all turned off with other holds left, a pause nothing
  holds (S4), and calls refused as exhausted, at preflight and as paused; REAL (500 steps, from where MOCK left the
  server, holds included) must see every call answer `unconfigured` or `invalid_request` and nothing else. No demo
  runs: its timers would make the walk irreproducible, and `tests/pause-resume.test.ts` covers it; for the same
  reason the walk does not try the demo's own status changes (the R5-3 guard in `setAgentStatus` is covered there).
  The file runs in about 9 s.
- R5-8 (2026-09-30). From the panel only the connection test pauses an agent on a budget refusal: Run once asks for a
  quote first, which refuses without pausing, and the mock's usage never fills a scope its reservation fitted. So the
  browser check sets the global limit in Details to what is used, runs Test connection, and follows the Coordinator
  through the notice, its panel, a Resume that answers "No agent was resumed.", Open Budgets, the raised limit and the
  Resume that releases it. The Connection view answered that refusal with the generic 409 sentence; it now shares
  `refusalMessage` with Run once (moved from the inspector to `components/provider-status.tsx`): a 409 with the
  server's fixed sentence shows "Stopped by the server: …", a code keeps its own sentence. The Pause all step also
  checks that no Resume demo is offered. 24 PASS lines, none removed, on a fresh MOCK instance. REAL without a key was
  checked by a probe outside the checkout, screen and GETs only, because the operator ruled out Run once in REAL and the
  workspace check sends one: Pause all, then the top-bar Resume; before it, REAL badge, Pause all agents beside Resume
  eligible agents, the notice and the inspector with the Pause all sentence, three Paused cards, no Resume demo; after
  it, three Ready cards, no notice, no Resume, Import, Export and Reset enabled, Apply graph limits enabled, import 200
  and remove 200, no console problem. No provider route was called.
- Housekeeping (2026-09-30). A safety check refused a cleanup that removed a data directory named by a command
  substitution. Directories are now printed first and removed by their literal paths; the probe no longer deletes its
  own. Three data directories left by an earlier run (05:14 to 05:16, mock graph and accounting files only) were
  looked at and removed.
- R5-9 (2026-09-30). `AGENTS.md` gains one paragraph, marked Round 5: every pause says why and has a way out on
  screen, with `tests/pause-invariant.test.ts` holding it and a new way to pause or resume joining that test in the
  change that adds it. STATUS lists the three open questions under what is pending. The route guides in
  `node_modules/next/dist/docs/` (`01-app/01-getting-started/15-route-handlers.md`,
  `01-app/03-api-reference/03-file-conventions/route.md` and the route segment config) were read only now, after
  the route edits of R5-2 and R5-4, which the round's rules asked to read before. Nothing conflicts: those edits
  changed handler bodies only (a refusal's sentence and status, `resumed` in the answer), no segment config moved
  since `23f3052`, POST handlers are never cached, `runtime = 'nodejs'` is the default and `dynamic` stays valid
  because `cacheComponents` is off.
- R5-10 (2026-09-30). Re-running E5 on the final code for the report: an unpriced served model (A-10) paused its
  agent with "a call lost contact with its provider", the resume refusal said the same, and so did Budgets' summary,
  which predates this round. Unverifiable usage has three causes the snapshot does not tell apart (lost contact,
  usage that could not be read, a served model without a price); the Run once result (`served_model_unpriced`,
  the timeout sentence) and the Activity feed (`provider.unpriced`) already name the exact one. So the three
  sentences now name none: "a call's cost could not be confirmed", and Budgets lists the three causes. No API change.
  The R5-4 test pinned the old sentence twice and follows it.
- R5-11 (2026-09-30, operator decision R5-Q1). `startBudgetPeriod` zeroes the global, agent and model rows (`used`,
  `estimated`, `conservativeCachedInput`, `actual`, `mock`, both costs) and drops their `mockCost`; the session row
  loses only its mock part (`used` minus `mock.total`, `costAccountedUsd` minus `mockCost` with `money()`, `mock` and
  `mockCost`) and keeps everything else. The session row is never journaled, so the journal format is unchanged and
  its replica after a restart shows the durable rows at zero. The operator's answer differs from the written
  recommendation in one point: the session row is not kept whole, only its real part is. `periodClears` says both
  halves in the question and in Details; the pause sentence of a scope the mock filled offers the period beside a
  higher limit and a restart, and a session row full of real spend still offers only those two. README, STATUS
  (R5-6 rewritten, R5-11 added) and the Budgets help follow. Tests: `tests/budget-period.test.ts` rewritten (every
  row, the session subtraction with a fictitious mock price, a twin server run with only the real call, the journal
  replica, the wording) and a route test (new period 200, then resume releases the agent); the browser check adds
  one PASS (the period then Resume make the agent Ready): 25 lines, none removed. Floor 539 → 540.
- R5-12 (2026-09-30, operator decision R5-Q2). The code already matched the decision: `holds()` names a
  `reconciliation` hold only for `status === 'estimated' && reported`, which only an unpriced served model's
  reservation carries. No test pinned the ordinary case for a present agent (R5-4 covered the unpriced one, R5-3 a
  removed agent), so `tests/pause-reasons.test.ts` gains one on the same scaffold: a timeout, the deadline passed,
  no hold, `resume()` releases the agent, the estimate counted in `used` and `estimated` of the global, agent, model
  and session rows, and the next call accepted. `AGENTS.md` records the decision after the unpriced served model
  paragraph, and `docs/reference/reservation-expiry.md` says it with its anchors kept. Floor 540 → 541.
- R5-13 (2026-09-30, operator decision R5-Q3). `plan()` refuses "Preflight reservation exceeds token or monetary
  budget." with `pause` false; the sentence and `budget.refused` are unchanged, and "Token or monetary budget
  exhausted." (a scope already full) and "Agent paused." still pause. Only the Activity log reads `budget.refused`,
  and only to label it, so no other path turns a preflight refusal into a status. Tests that used the refusal only
  to get a paused agent now use a zero limit, which is a full scope (`pauseByBudget` in R5-3, O4); RF-06 (four
  scopes, 100%), P2 and the direct API test now assert no pause, the four-scope test also shows a full scope still
  pausing, and the direct API test checks the refused connection test over the route (409, the sentence, the
  Coordinator Ready in the graph and the snapshot). New `tests/preflight-refusal.test.ts`: no pause and a smaller
  call accepted right after; a full scope still pausing and a quote pausing no one; over the routes, quote and
  complete answering 409 with the sentence, the agent Ready and neither the notice nor Resume on screen. The walk
  asserts after each call that a preflight refusal paused no one, and still reaches both the refusal and "a pause
  nothing holds" (now through a raised limit after a full scope). README and `docs/architecture.md` say only a
  full scope pauses. Floor 541 → 544.

#### Questions for João

- **R5-Q1 (H5)** A new budget period keeps the mock's estimated tokens of this server run and the session budget;
  both clear only on a restart. Should a new period also zero either? What it changes in real spend: zeroing the
  mock's usage gives back the token headroom the fictitious calls took in the global, agent and model rows, so real
  calls could then use it, but only up to the limits you set, which do not move; zeroing the session row allows a
  second full session budget of real spend before the next restart, which is exactly what that row exists to
  prevent. Recommended: zero the mock's usage (it is not spend, and the mock's dollars are $0), keep the session row.
  Until you answer, nothing changes and the screen says what stays.
  **Answered 2026-09-30: "concordo".** Decision as implemented in R5-11 (`6853a72`): Start a new budget period zeroes
  the mock's estimated tokens in every budget row, the session row's mock part included; what real calls spent since
  the server started stays in the session row; limits, pauses, Pause all and the journal format do not change. This
  differs from the recommendation above in one point: the session row is not kept whole, it loses its mock part and
  keeps only its real spend. The operator's wording of the decision stands, and D-10 records it.
- **R5-Q2** An ordinary reservation that expires into an estimate does not hold its agent: the agent can be resumed
  and call again while the estimate waits for the provider-confirmed usage. Only an unpriced served model's estimate
  (A-10) holds it. Should every expired estimate hold its agent until Apply confirmed usage? It changes reservation
  semantics (and blocks that agent until you reconcile), so it waits for you. Recommended: no; the estimate already
  counts at its conservative price in every scope, and Budgets names it.
  **Answered 2026-09-30: "concordo".** Decision: an ordinary expired estimate does not hold its agent; it stays
  counted, conservatively, in all four budgets, and only an unpriced served model's estimate holds its agent until it
  is reconciled by hand. The code already did this; R5-12 (`0d1e62c`) pins it with a test. D-11 records it.
- **R5-Q3** A call the budget refuses before sending pauses its agent (`execute`: a full scope, or a worst case that
  does not fit, for example at 225 of 300 tokens). Run once asks for a quote first, which refuses without pausing, so
  from the panel this pause comes from Test connection (its first agent) or a direct `complete` request (R5-1, S4).
  When no scope is full, Budgets then says the agent is paused "and nothing holds it now", Resume releases it, and the
  next such call pauses it again until a limit rises. Should a refusal that finds room in every scope, but not for
  this call's worst case, stop pausing the agent (the call is refused either way and nothing is sent)? Or keep
  pausing, with the scope and the worst case named? Either changes when an agent is paused, so it waits for you.
  Recommended: pause only when a scope is full, which Resume already refuses to release.
  **Answered 2026-09-30: "concordo".** Decision as implemented in R5-13 (`c442701`): the preflight refusal, where the
  call's worst case does not fit the room left, does not pause the agent; the call is refused and nothing is sent.
  An agent is paused only by a full budget (used plus reserved at or over a token or dollar limit), unverifiable
  usage, an estimate awaiting reconciliation or Pause all. D-12 records it.

### Phase 12 — Round 6: license and security contact (2026-10-06)

On `main` from `534c56c`. The operator answered the two questions left in the repository: Q-06 (license) and Q-05
(security contact). The round touches documentation and metadata only, after one dependency commit the starting gate
required (R6-A).

| ID | Item | Acceptance criterion | Status |
| --- | --- | --- | --- |
| R6-A | The starting gate was red | `npm audit --audit-level=high` failed on the clean tree with five advisories published since 2026-09-30; the four with a patch release are taken with npm 11, and `braces`, which has none, is excepted by operator decision until 2026-10-20; gate green, browser check unchanged, one commit | done |
| R6-1 | MIT license (Q-06) | `LICENSE` with the MIT text and "Copyright (c) 2026 João Hélio dos Reis Souza"; `license: MIT` in both package.json files and the lockfile root; README License section and Portuguese line; shadcn/ui's notice kept for `components/ui/`; licenses of the installed tree reported; `tests/repository-metadata.test.ts` | done |
| R6-2 | Report privately, publish no contact (Q-05) | "Reporting a vulnerability" sends reports through GitHub private vulnerability reporting, with a fallback (a public "Security contact request" issue with no details) and what to send, what counts and what to expect; the placeholder is gone; no e-mail, phone or numeric deadline anywhere | done |

#### Decisions taken

- R6-A (2026-10-06). The gate on the clean tree stopped at `npm audit`: proxy-addr (critical, GHSA-jqcg-44mw-7w3h),
  sharp (GHSA-wq5f-xc86-pv6w), source-map-js (GHSA-68fv-2mgg-jv7q), `@modelcontextprotocol/sdk` (GHSA-6qxp-vccf-f47h)
  and braces (GHSA-vfj7-8cjw-p6xm), all high but the first. `shadcn` is a runtime dependency only for the CSS
  `app/globals.css` imports, and it brings in the MCP SDK (with express and proxy-addr), fast-glob, micromatch and
  braces; `next` brings in sharp and postcss with source-map-js. The registry had patch releases for four:
  proxy-addr 2.0.8, sharp 0.35.5 (libvips 1.3.4), source-map-js 1.2.2 and the MCP SDK 1.32.1 through shadcn 4.21.0 →
  4.21.3 (a patch inside `^4.21.0`, published 2026-10-06, which adds `@shadcn/registry` and drops its cosmiconfig
  chain). braces 3.0.3 is the latest release and is affected, and micromatch 4.0.8 and fast-glob 3.3.3, also the
  latest, depend on it; the only offered "fix" downgrades shadcn to 1.0.0. The round forbade dependency changes
  without asking, so the agent stopped and asked; the operator chose both recommendations: the four patch releases
  in their own commit, and a temporary exception for braces. Neither passes the gate alone, so they land together.
  `npx npm@11 audit fix` changed only `package-lock.json` (50 entries: 31 version changes, 6 added, 6 removed and the
  dev flag of 7 that the old shadcn no longer reaches; the 38 `libc` fields kept), then `npm ci` installed it as CI
  does. `scripts/audit-policy.mjs` judges `npm audit --json`: it excepts exactly GHSA-vfj7-8cjw-p6xm in braces until
  2026-10-20 inclusive or until a non-major fix exists, and fails on any other high or critical advisory and on a
  missing report; the gate's audit step runs it, so CI follows. `AGENTS.md` records the decision (Operator
  decisions, the gate paragraph and Dependencies), README says it, and `tests/audit-policy.test.ts` pins the rule
  and the one exception; the R4-6 gate test follows the step's new command. Gate green (549), `test:e2e` 25 PASS
  on a fresh MOCK instance. Floor 544 → 549.
- R6-1 (2026-10-06, operator decision Q-06). `LICENSE` holds the operator's text byte for byte (UTF-8, LF, one final
  newline); its body equals the MIT text that react, zustand and next install. `"license": "MIT"` was added to
  `package.json` and `lib/core/package.json` and nothing else; `npx npm@11 install --package-lock-only
  --ignore-scripts` changed one lockfile line, the root's `license` (npm 10 would have dropped the `libc` fields), and
  `npm ci` installed it. README gains a License section before Repository rename and "Licença: MIT (veja LICENSE)."
  at the end of the Portuguese one. The inventory (read only, no network) found no third-party header in any tracked
  file, but `components/ui/` holds five files (419 lines) the shadcn CLI generated from shadcn/ui, MIT, "Copyright
  (c) 2023 shadcn", without a header: third-party code in the repository, a stop condition, so the agent asked. The
  operator chose to attribute them: `components/ui/LICENSE` is a verbatim copy of `node_modules/shadcn/LICENSE.md`,
  the README says so, and `AGENTS.md` keeps a later CLI component under that notice. Installed production tree, 374
  packages: MIT 314, ISC 32, BSD-3-Clause 8, Apache-2.0 8, BSD-2-Clause 5, BlueOak-1.0.0 2, 0BSD 1, (MIT OR CC0-1.0)
  1 (type-fest), and three known exceptions: `@img/sharp-libvips-linux-x64` (LGPL-3.0-or-later),
  `@img/sharp-wasm32` (Apache-2.0 AND LGPL-3.0-or-later AND MIT), both installed by npm for next's optional sharp and
  not copied into the repository, and `caniuse-lite` (CC-BY-4.0, data). Python-2.0 (argparse) left the production
  tree with R6-A. The whole installed tree (627 packages, dev included) has no GPL, AGPL, SSPL, UNLICENSED or missing
  license. Floor 549 → 552.
- R6-2 (2026-10-06, operator decision Q-05). The operator left the wording to the assistant, security first. Only the
  body of "Reporting a vulnerability" changed, to the round's text: report through GitHub private vulnerability
  reporting (the Security tab, which GitHub may label "Security and quality", then "Report a vulnerability"); if
  that is not visible, a public issue titled "Security contact request" with no details, waiting for a private
  channel; never keys, cookies, unredacted transcripts, screenshots or exploit details in a public place; what to
  send, what counts (the Threat model's promises; its out-of-scope and residual-risk items are known) and what to
  expect (one maintainer, best effort, no response time, no bounty, fixes on main only, credit if wanted). The
  marker "[SECURITY CONTACT: placeholder…]" is gone; the `.env.example` sentence under Credentials is another subject
  and stays. GitHub's documentation (docs.github.com) was blocked by this environment's network policy, so the two
  tab names stay as the round wrote them. Whether private vulnerability reporting is on for the repository is not
  verified from here: switching it on is the owner's click, and the fallback covers the meantime. `AGENTS.md`
  records the decision; `tests/repository-metadata.test.ts` holds the section to it. Floor 552 → 553.

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
| R4-1 | `disconnect` without the delegation refusal | killed by "edge deletion dispatch removes only the requested context connection, refuses a delegation…"; restored, sha256 identical |
| R4-1 | the delegation explanation never shown | killed by "R4-1 a selected delegation says it goes with its subagent…" |
| R4-1 | every edge treated as a context connection | killed by the same test |
| R4-2 | placement not clamped to the canvas | killed by both R4-2 tests ("subagent of an agent on the edge of the canvas", random walk step 702); restored, sha256 identical |
| R4-2 | no trim after the output cut | killed by both R4-2 tests ("output with a bearer token at 7983", random walk step 62) |
| R4-2 | demo output appended without `savedOutput` | killed by both R4-2 tests ("demo output after it", random walk step 115) |
| R4-2 | `disconnect` without the delegation refusal | killed by both R4-2 tests as well ("delete a delegation", random walk step 246) |
| R4-3 | the store never records a refusal | killed by the two store tests; restored, sha256 identical (store, route, guard, workspace, transport) |
| R4-3 | `since` restarts at every refusal | killed by the same two tests |
| R4-3 | a failed write left out of the state | killed by "a write that fails is reported with a fixed sentence…" |
| R4-3 | a saved write does not clear the state | killed by "the store says it is not saving, and why…" |
| R4-3 | `instanceof Error` instead of `GraphError.is` for the reason | first survived (the parser throws only `GraphError`); a test with something that is not a graph now kills it, showing Node's "…Received undefined" would have reached the panel |
| R4-3 | the route without `localRequest` | killed by "GET /api/graph/persistence serves the store state, to local requests only…" |
| R4-3 | the client guard accepts extra keys | killed by "the panel takes only the route shape…" |
| R4-3 | the warning without the store's reason | killed by the same test |
| R4-3 | the warning not rendered under the top bar | killed by the same test (wiring assertion) |
| R4-3 | the transport never reads the route | killed by the same test (wiring assertion) |
| R4-5 | `registerSecret` tells no listener | killed by the three graph tests in `configured-key` and the module-copies test; restored, sha256 identical (redact, graph service, runtime, feed) |
| R4-5 | `redactSecrets` changes nothing | killed by the same four and both R4-2 tests |
| R4-5 | listeners in a set of the module instead of `globalThis` | killed only by "a key configured through the routes' copy of the modules…", the one test that can tell |
| R4-5 | the name not cut back into its limit | killed by "a configured key that makes a field longer…" and both R4-2 tests |
| R4-5 | the redaction not published as an event | killed by the two store tests in `configured-key` |
| R4-5 | `runtime()` without `followSecrets()` | killed by "the process graph follows the key registry…" and the module-copies test |
| R4-5 | the feed sends without redacting again | killed by "the feed redacts again when it sends…" |
| R4-5 | the profile removal without its retry | killed by "the browser checks remove their profile with retries…"; restored, sha256 identical |
| R4-6,1 | the audit step removed from the gate | killed by "the gate is CI's blocking steps…" and "the gate stops at the first step that fails…"; restored, sha256 identical (gate, CI workflow) |
| R4-6,1 | the gate goes on after a failed step | killed by "the gate stops at the first step…" and "the test step fails on its own exit code and on the floor…" |
| R4-6,1 | the floor check dropped from the test step | killed by "the test step fails on its own exit code and on the floor…" |
| R4-6,1 | a step's exit code ignored | killed by the same two |
| R4-6,1 | the lint step runs typecheck | killed by "the gate is CI's blocking steps…" |
| R4-6,1 | CI runs `npm test` instead of the gate | killed by "the gate is CI's blocking steps…" and "D5 CI holds every run to the floor…, through the gate" |
| R4-6,1 | a command that cannot start passes | killed by "a gate command reports its exit code…" |
| R4-6,3 | the preview sends `JSON.stringify` again | killed by "the preview redacts again when it sends…" and "every stream the server sends redacts each frame…"; restored, sha256 identical |
| R4-6,3 | the graph stream sends `JSON.stringify` | killed by "every stream the server sends redacts each frame…"; restored, sha256 identical |
| R4-6,2 | `graph.redacted` not recognized | killed by "a configured key discards every Activity line…", "the panel discards what it holds…" and "the live feed follows the projection…"; every file restored, sha256 identical |
| R4-6,2 | the Run exchanges kept on a clearing | killed by "a configured key discards…" and "the panel discards what it holds…" |
| R4-6,2 | the clearing not counted | killed by the same three as the first |
| R4-6,2 | an answer sent before the clearing kept | killed by "an answer to a message sent before the clearing is dropped…" |
| R4-6,2 | the feed hides nothing | killed by "the feed hides the lines it had received…" and "the live feed follows the projection…" |
| R4-6,2 | a restarted server's window keeps the lines hidden | killed by "the feed hides the lines it had received…" |
| R4-6,2 | a stale `graph.redacted` ignored | killed by "the panel discards what it holds…, even behind the revision guard" |
| R4-6,2 | the old Activity title | killed by "a configured key discards…" |
| R4-6,2 | the feed ignores clearings (`followClearings`) | killed by "the live feed follows the projection…" |
| R4-6,2 | a clearing hides nothing new (`hiddenThrough` kept) | killed by "the live feed follows the projection…" |
| R4-6,2 | a new window forgets the mark | killed by "the live feed follows the projection…" (the sed that restored it also touched the initial state; restored by hand, sha256 identical) |
| R4-6,2 | the list shows hidden lines | survived until the list became `FeedLines`; then killed by "the feed list leaves the hidden lines out…" |
| R4-6,2 | `EventFeed` never calls `followClearings` | **survived**: the effect runs only in a browser, and no browser check can configure a key; accepted as is by the operator (R4-6) |
| R4-6,2 | the workspace records an answer at the clearing count of its arrival | **survived**: same reason; `historyWithExchange` itself is killed above; accepted as is by the operator (R4-6) |
| R5-2 | `pauseAll` pauses any run, as before | killed by both "after Pause all agents and Resume eligible agents the graph can be edited…" (MOCK and REAL); every file restored, sha256 identical |
| R5-2 | `resumeAll` never called | killed by "a demo that Pause all agents paused goes on…" |
| R5-2 | every demo pause counts as Pause all | killed by the same, at "paused on purpose, it stays paused" |
| R5-2 | the Pause all hook pauses the demo as Pause demo | killed by the same |
| R5-2 | import accepted while Pause all is on | killed by "with Pause all agents on, the graph refuses… and names the way out" |
| R5-2 | the refusal says "Global kill switch is active." again | killed by the same |
| R5-2 | Reset graph disabled while the demo is paused | killed by the browser check ("Reset graph ends a paused demo") |
| R5-2 | the paused demo explains nothing | killed by the browser check ("Timed out: the paused demo explained") |
| R5-3 | no pause is ever pruned | killed by "an agent removed or reset away takes its pause with it…", "…holding a reservation keeps its pause…" and "a journal restores no pause…"; every file restored, sha256 identical |
| R5-3 | a reservation holder loses its pause too | killed by "an agent that leaves the graph holding a reservation keeps its pause…" |
| R5-3 | `restore` keeps stale pauses | killed by "a journal restores no pause for an agent the restored graph no longer has" (restored by hand after a wrong reverse `sed`; sha256 identical) |
| R5-3 | reset forgets the Coordinator's pause | killed by "the Coordinator keeps the pause the token service holds through Reset graph and the demo" |
| R5-3 | the demo overwrites a held pause | killed by the same |
| R5-3 | an import forgets held pauses | killed by "an import shows the pause the token service holds…" |
| R5-3 | the demo's exhausted budget overwrites a held pause | killed by "a held pause survives the demo running out of its budget" |
| R5-3 | the process graph is never told (`followPauses` not wired) | killed by the reset and the import tests |
| R5-4 | no budget reason is reported | killed by "the snapshot says what holds each paused agent…", "resume answers whom it released…", "Budgets says…" and RF-06 "resume cannot erase exhaustion"; every file restored, sha256 identical |
| R5-4 | the dollar dimension is never named | killed by "the snapshot says what holds each paused agent…" |
| R5-4 | the mock is never named | killed by the same, "resume answers…" and "Budgets says…" |
| R5-4 | `until` dropped | killed by "unverifiable usage says until when…" and "resume answers…, and a refusal is the server sentence" |
| R5-4 | resume releases what a reconciliation holds | killed by "unverifiable usage says until when…" and A-10 "the agent stays paused until the estimate is reconciled by hand" |
| R5-4 | a removed agent names no reservation | killed by "unverifiable usage says until when…" |
| R5-4 | resume answers no `resumed` | killed by "resume answers whom it released…" |
| R5-4 | a refused resume is the generic 400 again | killed by the same |
| R5-4 | the sentence forgets the mock | killed by "the panel words every hold…" and "Budgets says…" |
| R5-4 | the status names the first full scope only | killed by "the status names every full scope…" |
| R5-4 | a removed agent's row blocks again | killed by the same |
| R5-4 | an outdated resume answer is shown | killed by "the panel words every hold…" and "Budgets says…" |
| R5-4 | Budgets hides the holds | killed by "Budgets says…" |
| R5-4 | a removed agent row offers limits again | killed by "a removed agent row offers no limit to change…" |
| R5-5 | the top-bar Resume never shows | killed by "Resume eligible agents stands beside Pause all agents only while something is paused"; every file restored, sha256 identical |
| R5-5 | the notice never shows | killed by "the notice under the top bar says what the last resume did…" |
| R5-5 | the notice forgets the last answer | killed by the same |
| R5-5 | a Paused agent's panel says nothing | killed by "the panel of a Paused agent says why and opens Budgets…" |
| R5-5 | Commands has no Resume eligible agents | killed by the browser check ("Timed out: the palette offers Resume eligible agents") |
| R5-6 | the question back to "Consumption … starts again from zero" | killed by "a new budget period clears real consumption only…" (the question does not start with `periodClears`); every file restored, sha256 identical |
| R5-6 | the Details line back to the old words | killed by the same ("Details says the same") |
| R5-6 | `periodClears` back to the old claim | killed by the same (the sentence no longer says real consumption) |
| R5-6 | a new period also zeroes the mock's usage | killed by the same ("global all: the mock's estimated tokens stay"): the words and the behaviour move together |
| R5-6 | a new period also zeroes the session row | killed by the same ("the session budget stays as it was") |
| R5-7 | Pause all pauses an idle run (R5-2 reverted) | killed by the walk ("mock step 2 (pause all): the run is paused without a demo"); every file restored, sha256 identical |
| R5-7 | the snapshot no longer prunes stale pauses (R5-3) | killed ("mock step 152 (remove): a removed agent keeps a pause with nothing to settle") |
| R5-7 | reset forgets the Coordinator's held pause (R5-3) | killed ("mock step 325 (reset): Coordinator is ready, and the token service holds pause for it"). The first try swapped the line for a bare newline, which could not be swapped back; the file was restored by hand to its sha256 and the mutation rerun with unique anchors |
| R5-7 | an import shows held agents Ready (R5-3) | killed ("mock step 167 (import): Coordinator is ready…"); same incident and restore as above |
| R5-7 | resume releases every agent whatever holds it (R5-4) | killed ("mock step 174 (resume): resumed") |
| R5-7 | Pause all holds no pause in the token service | killed ("mock step 2 (pause all): Coordinator is paused, and the token service holds no pause for it") |
| R5-7 | import accepted while Pause all is on (R5-2) | killed ("mock step 776 (import): Pause all is on and Agent 31 does not say so") |
| R5-7 | `resumable` ignores Pause all and a single pause (R5-5) | killed ("mock step 2 (pause all): something is paused and no Resume eligible agents is offered") |
| R5-8 | the Connection view words a refused test generically again | killed by the browser check ("Timed out: the refused test gives the server reason", after 21 PASS lines); every file restored, sha256 identical |
| R5-8 | Resume demo offered while Pause all is on (the old dead end, in the panel) | killed by the browser check ("no Resume demo without a demo", after 19 PASS lines) |
| R5-8 | `refusalMessage` drops the server's sentence | killed by "a refused connection test gives the server's reason, as Run once does…" |
| R5-10 | the refused resume says lost contact again | killed by "unverifiable usage names no cause it cannot know…" and the R5-4 pin; every file restored, sha256 identical |
| R5-10 | the pause sentence says lost contact again | killed by the same and the R5-4 wording test |
| R5-10 | Budgets says lost contact again | killed by the same |
| R5-11 | the durable rows keep the mock's tokens again (`used: row.mock.total`) | killed by "a new budget period clears the mock's estimated tokens in every row…" ("global all starts again from zero") and by "a scope the mock filled is free after a new budget period…"; every file restored, sha256 identical |
| R5-11 | the session row loses its real part too | killed by the first ("the session row loses exactly the mock part"). Its swap back matched twice, because the mutated line equalled the other branch; the line was restored by hand to the same sha256 |
| R5-11 | `used` goes to zero but `mock` and `mockCost` stay | killed by the first ("global all starts again from zero", on `mock.total`) |
| R5-12 | `holds()` without `&& item.reported` (every expired estimate holds its agent) | killed by "an ordinary expired estimate does not hold its agent…", the only test of 541 that failed: A-10 and every unpriced served model test stayed green, so the mutation separates the two cases; restored, sha256 identical |
| R5-13 | the preflight refusal pauses again (`fail(…, true)`) | killed by "a preflight refusal pauses no one, and a smaller call…", "over the routes, a Run once refused at preflight…", the walk's new check ("a preflight refusal paused …"), RF-06 (four scopes, 100%, direct API) and P2: 7 of 544; restored, sha256 identical |
| R5-13 | a scope exactly full no longer pauses (`Token or monetary budget exhausted.` with `false`) | killed by "a scope exactly full still refuses and pauses…", RF-06 four scopes, O4, R5-3, R5-4 and R5-11: 10 of 544 |
| R6-A | the exception no longer checks the advisory id | killed by "every other high or critical advisory still fails the audit, braces' own included…" (a second braces advisory); restored, sha256 identical |
| R6-A | the exception ignores its date | killed by "braces' advisory without a fixed release passes the audit through 2026-10-20… and fails the day after" |
| R6-A | the exception survives a fix | killed by "a fix for braces ends its exception at once…" |
| R6-A | a moderate advisory blocks | killed by "every other high or critical advisory still fails the audit… and moderate or low ones do not" |
| R6-A | the gate runs the raw `npm audit` again | killed by the two R4-6 gate tests (the step's command and the stop at the audit) |
| R6-1 | `"license": "ISC"` in package.json | killed by "the repository is MIT licensed…"; restored, sha256 identical |
| R6-1 | LICENSE without its "AS IS" paragraph | killed by the same and by "the components the shadcn CLI generated keep shadcn/ui's MIT notice" (the same MIT terms) |
| R6-1 | an e-mail in the README | killed by "the files a visitor reads first publish no e-mail address" |
| R6-1 | `components/ui/LICENSE` without shadcn's copyright line | killed by "the components the shadcn CLI generated keep shadcn/ui's MIT notice" |
| R6-2 | the placeholder marker back in the section | killed by "vulnerabilities are reported privately through GitHub…"; restored, sha256 identical |
| R6-2 | the fallback paragraph removed | killed by the same. Its swap back replaced the empty string, which matches everywhere, so it never ran; the paragraph was restored by hand to the same sha256 and the next mutation rerun on the restored file |
| R6-2 | an e-mail in SECURITY.md | killed by "the files a visitor reads first publish no e-mail address" (rerun alone after the restore) |

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
- **D-10 A new budget period clears the mock's tokens (operator, R5-Q1, 2026-09-30).** The period zeroes the mock's
  estimated tokens in every budget row, the session row's mock part included; the session row keeps what real calls
  spent since the server started, so a period never grants a second session of real spend. Limits, pauses, Pause
  all and the journal format are unchanged. It differs from the written recommendation, which kept the session row
  whole. Implemented in R5-11.
- **D-11 An ordinary expired estimate does not hold its agent (operator, R5-Q2, 2026-09-30).** It stays counted,
  conservatively, in all four budgets; only an unpriced served model's estimate holds its agent until reconciled by
  hand. Already the behaviour; pinned by a test in R5-12.
- **D-12 A preflight refusal does not pause (operator, R5-Q3, 2026-09-30).** A call whose worst case does not fit the
  room left is refused and nothing is sent, but its agent is not paused; only a full budget, unverifiable usage, an
  estimate awaiting reconciliation or Pause all pause an agent. Implemented in R5-13.

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
- Phase 10 (Round 4, 2026-09-29, on `main`): R4-1 and R4-4 in `897265a`, R4-2 in `eb507c3`, R4-3 in `894d41d`.
  Floor 487 → 495, every fix mutation-tested. On fresh instances `test:e2e` passed in development (20 checks) and
  `test:browser` in production; Gitleaks clean on every staged diff, the working directory and the full history.
- Phase 10, R4-5 (2026-09-30, on `main`): a configured key leaves the graph at once, and the live feed redacts again
  as it sends; the browser checks' profile removal retries a late Chromium write. Floor 495 → 501, every change
  mutation-tested (eight mutations, all killed).
- Phase 10, R4-6 (2026-09-30, on `main`): `npm run gate` runs CI's blocking steps in CI's order and CI runs it; the
  artifact preview redacts as it sends and a ratchet holds every stream to it; the panel discards what it received
  before `graph.redacted`. Floor 501 → 514. Twenty-three mutations: twenty-one killed, two wiring lines survived (see
  the mutation log). On fresh instances `test:e2e` passed in development, with the feed off and on (20 checks each),
  and `test:browser` passed on the production build with the preview on. Gitleaks: no findings in the tree, the
  history or any staged diff.
- Phase 10, R4-6 residue (2026-09-30, on `main`): the operator accepted the panel's in-tab residue; `SECURITY.md`
  lists it with the advice to reload open tabs after configuring a key, and `AGENTS.md` records the rule that such a
  residue is an accepted risk that opens no new round. Documentation only, floor unchanged at 514.
- Phase 11, Round 5 (2026-09-30, on `main`): agents could not be un-paused. Reproduced entry by exit on fresh
  instances before any change (R5-1), then R5-A `aa64b2f` (next 16.3.8 for a critical advisory), R5-2 `d09ccba`,
  R5-3 `4d3f6fe`, R5-4 `b629d9f`, R5-5 `2496768`, R5-6 `804f58f`, R5-7 `70dc0e0`, R5-8 `eba4b40`, R5-9 `4482d28`,
  and R5-10 in the commit that carries this entry. Floor 514 → 539. Fifty-four mutations, all killed. `test:e2e`
  passed on fresh MOCK instances (24 checks); REAL without a key was checked on screen only. Gitleaks clean on every
  staged diff. No request reached a provider. Three questions wait for the operator (R5-Q1 to R5-Q3).
- Phase 11, Round 5 continuation (2026-09-30, on `main`): the operator answered R5-Q1 to R5-Q3 with "concordo".
  R5-11 `6853a72` (a new budget period clears the mock's tokens in every row, the session row keeping its real
  spend), R5-12 `0d1e62c` (an ordinary expired estimate does not hold its agent, pinned by a test), R5-13 `c442701`
  (a preflight refusal no longer pauses), and R5-14 in the commit that carries this entry. Each decision entered
  `AGENTS.md` in its own commit. Floor 539 → 544. Six mutations, all killed. `test:e2e` passed on fresh MOCK
  instances with 25 PASS lines, one more than before and none removed. Gitleaks clean on every staged diff. No
  request reached a provider. No question is open.
