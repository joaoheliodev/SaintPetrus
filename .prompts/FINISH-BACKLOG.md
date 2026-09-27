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
| Q1 | Coverage for critical modules | Token, credential, event and preview routes have uncovered branches | New tests with mocked transport only; coverage recorded | no | done (this commit; `tests/route-boundaries.test.ts`: token, price, provider, credential, graph and artifact-stream route boundaries; non-test line coverage 94.4% (baseline 93%), branches 91.9%, functions 87.7%, measured with `--experimental-test-coverage --test-coverage-exclude='tests/**'`) |
| Q2 | Browser end-to-end smoke check | Chromium is preinstalled in this environment | Dependency-free CDP script for the main flow in mock mode, outside the gate; run result recorded | no | in progress (`scripts/check-workspace-browser.mjs` added with S4; extended with Phase 3) |
| Q3 | Basic accessibility | Keyboard, labels, visible focus, contrast | Focus-visible styles, labelled controls, keyboard paths checked; contrast of tokens measured | no | in progress (contrast measured and field edges fixed in d6a0a59, D-08; arrow-key moves and multi-card drags saved in this commit) |
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
- **Q-07** OpenAI now prices the served snapshot (D-05). Which dated IDs and prices should be registered
  before any OpenAI use, or should OpenAI be removed from the allowlist until then?

## Session log

- Phase 0 inventory complete; this backlog written before any implementation.
- Phase 1 complete: V0–V11 done (V11 added by the review of V2). Floor 338 → 360.
