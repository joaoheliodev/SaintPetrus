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

- [ ] Every P0 and P1 item is done, or blocked only on an operator decision or on a real provider call.
- [ ] `npm ci && npm run dev` starts the panel in mock mode without any key, and the main flow works end to end.
- [ ] Full gate green with at least 338 tests and zero skips.
- [ ] Gitleaks clean over the branch history.
- [ ] Every known security gap is recorded.
- [ ] README, architecture, SECURITY, validation protocol and CHANGELOG are current.
- [ ] The handoff lets another agent or the operator resume without this conversation.

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
| V2 | Served model without captured tariff (all providers) | Current path reports a `budget.refused` event and a "reconciled" reroute message for a call that was billed and not reconciled | Reservation kept unverifiable, agent paused, explicit feed event naming requested/served model and reservation; never released; requested tariff never used; reroute event no longer claims reconciliation first | no | pending |
| V3 | Per-call accounting receipt (G2) | No per-call record of usage, identity, tariff and timing | Bounded in-memory journal of redacted receipts (numbers, ids, codes only), linked to the persisted reconciliation interval, exposed by a local read-only GET; eviction reported | no | pending |
| V4 | Upstream dispatch counter per provider (G3) | Nothing proves a refused call never left the server | Server-owned count incremented immediately before transport, per provider, exposed read-only; tests prove every preflight refusal leaves it unchanged and a dispatched call adds exactly one | no | pending |
| V5 | Validation timeout control (G4) | V2 of the protocol cannot force a timeout | Off by default; read only at startup; never taken from `/api/provider` bodies; applies inside the proxy after preflight and reservation, so budgets still bind; invalid values refuse startup; visible in provider status | no | pending |
| V6 | `npm run key -- set deepseek` (G7) | Terminal helper omits DeepSeek | DeepSeek accepted with the same rules as Gemini (hidden TTY input, no argv secret, opt-in remember); regression test without spawning processes | no | pending |
| V7 | Empty visible output never verifies a probe (G11) | `connection-state.md` requires usable output; empty text with a non-limit finish reason is marked verified | Empty-text probe keeps billed usage, does not verify, reports a distinct error; badge not "Connected" | no | pending |
| V8 | Gemini usage failures report field names only (G8, second half) | `AGENTS.md` requires names-only diagnostics for an unparsed usage shape; only DeepSeek has them | Gemini parse failure publishes the field names it saw and never a value; a missing usage object reports the response's names in both adapters | no | done (this commit) |
| V9 | Update `docs/provider-validation.md` | Protocol must describe the new receipts, counter, timeout, identity and terminal support | Gaps table updated (resolved vs still open); steps use the new evidence sources | no | pending |

### Phase 2 — security (P0)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Key lifecycle audit | Operator asked for where a key travels, how long it lives and how remembered keys are stored and erased | Documented path (field, POST, memory buffers, per-call copies, header), remembered ciphertext location/permissions/erasure verified; gaps fixed or recorded | no | pending |
| S2 | Leak audit | Logs, errors, feed, export and API responses must carry no secret or raw provider payload | Each sink checked and tested; findings fixed or recorded | no | pending |
| S3 | API route hardening audit | Loopback, Origin, content type, input and response bounds | Every route checked; gaps fixed with tests | no | pending |
| S4 | Security headers for the local app | No CSP, framing or referrer policy on the main app | Headers on every main-listener response, tested, and the app verified working in Chromium in dev and production | no | pending |
| S5 | `npm audit` | Operator requirement | Non-breaking fixes applied; remainder recorded | no | pending |
| S6 | `.gitignore` coverage | `.env*`, remembered credentials, logs and build artifacts | Patterns cover each class; check-staged and CI still pass | no | pending |

### Phase 3 — core function (P1)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | Keyless mock by default in `npm run dev` | Definition of Done item 2 | `npm run dev` starts with the mock unless `SAINTPETRUS_MOCK` says otherwise; `npm start` unchanged (mock off) | confirm (D-03) | pending |
| F2 | Run one call for a selected agent from the inspector | `complete` action exists server-side with no UI; inspector output tab expects provider output | Inspector sends one budgeted call through the existing route for the selected agent; output recorded by the graph owner; works with the mock and no key | no | pending |
| F3 | Edit agent name and objective | Operator's main flow lists editing | Server-validated `update` command with the create limits; UI in the inspector | no | pending |
| F4 | Confirm destructive actions | Operator requirement | Reset graph, run mock (resets), pause all (cancels in-flight work), disconnect credential, delete connection, add price validity and apply confirmed usage all require explicit confirmation | no | pending |
| F5 | Loading, empty and error states | Operator requirement | Every panel shows all three where applicable | no | pending |
| F6 | Export context from the UI | Export route exists without a UI entry | Download link to the existing endpoint; no new client fetch | no | pending |
| F7 | Agent removal, graph import and persistence | Removal was deliberately blocked in `c01fb02`; import/persistence not planned in docs | Not implemented; questions Q-03 and Q-04 | yes | blocked (operator decision) |

### Phase 4 — quality (P2)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| Q1 | Coverage for critical modules | Token, credential, event and preview routes have uncovered branches | New tests with mocked transport only; coverage recorded | no | pending |
| Q2 | Browser end-to-end smoke check | Chromium is preinstalled in this environment | Dependency-free CDP script for the main flow in mock mode, outside the gate; run result recorded | no | pending |
| Q3 | Basic accessibility | Keyboard, labels, visible focus, contrast | Focus-visible styles, labelled controls, keyboard paths checked; contrast of tokens measured | no | pending |
| Q4 | Dead code | Only when unused is proven | Removals backed by search evidence, or none | no | pending |

### Phase 5 — documentation and DX (P3)

| ID | Title | Reason | Acceptance criterion | Operator | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | README rewrite | Discrepancies listed in `docs/provider-validation.md` | What, requirements, install, mock run, main flow, key entry, security model, limits, validation status | no | pending |
| D2 | `docs/architecture.md` | Operator requirement | Modules and the path of one call | no | pending |
| D3 | `SECURITY.md` threat model | Operator requirement | Threat model; reporting contact left as a marked placeholder | contact (Q-05) | pending |
| D4 | `CHANGELOG.md` | Operator requirement | What this session delivered | no | pending |
| D5 | CI workflow | Operator requirement | Lint, typechecks, tests, build and Gitleaks on push and PR (workflow already exists; verify and adjust) | no | pending |
| D6 | LICENSE | Operator requirement: do not choose one | Question Q-06 | yes | blocked (operator decision) |
| D7 | Permanent rules from this prompt into `AGENTS.md` | `AGENTS.md` requires prompt rules to be written down before acting on them | Test hygiene, dependency policy and published-secret stop rule added; floor kept current | no | pending |

### Phase 6 — review and close

| ID | Title | Acceptance criterion | Status |
| --- | --- | --- | --- |
| R1 | Independent review of `0662647..HEAD` | Reviewer subagent that did not implement; confirmed findings fixed, discarded ones recorded with reason | pending |
| R2 | Final gate and Gitleaks over the branch history | Recorded counts | pending |
| R3 | STATUS, NIGHT-LOG, handoff, Checklist do João | Updated in the final commit | pending |

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
  (only the forged-ID refusal is tested). Covered with V4.

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

## Decisões tomadas (decisions taken)

- **D-01 Commits.** `AGENTS.md` says the agent does not commit; the operator explicitly authorized
  commits and pushes to `night/provider-validation-ready` for this session. Per `AGENTS.md` this is an
  exception for this round, not a precedent, so it is not written into `AGENTS.md`.
- **D-02 Tracked backlog.** `.prompts/` is ignored and vanishes in a fresh clone, but this session can
  end at any time in an ephemeral container. The operator asked for the backlog to be committed, so this
  one file is added with `git add -f`; the ignore rule is unchanged.
- **D-03 Mock in `npm run dev` (pending implementation, F1).** The Definition of Done asks for
  `npm ci && npm run dev` to start in mock mode. The mock makes no network call and spends nothing. Only
  the development launcher changes its default; an explicit `SAINTPETRUS_MOCK=false` (shell or
  `.env.local`) still wins, and `npm start`, used for real validation, keeps the mock off. Reversible;
  confirmation requested in Q-01.
- **D-04 Language.** Code, UI, docs and commits stay in English as `AGENTS.md` requires; the final
  session report to the operator is in Portuguese.

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

## Session log

- Phase 0 inventory complete; this backlog written before any implementation.
