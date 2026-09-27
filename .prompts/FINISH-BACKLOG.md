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
| R1 | Independent review of `0662647..HEAD` | Reviewer subagent that did not implement; confirmed findings fixed, discarded ones recorded with reason | in progress (two reviewers reported; findings R1-01 to R1-14 below) |
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
| R1-06 | minor | Forget key acts only on the selected provider, and the saved-copy note disappears after Disconnect or a restart | pending |
| R1-07 | minor | DeepSeek throws without field names when the served model is missing | fixed (this commit): it names the fields like Gemini and OpenAI |
| R1-08 | minor | OpenAI usage is not parsed strictly: bad usage loses the served model and the field names | fixed in part (this commit): `lib/providers/openai-usage.ts` parses usage strictly on both paths, fails closed with field names and reports the reasoning count. Not done: carrying the served model inside a usage failure so receipts and manual reconciliation can name it; that is true of every adapter and is recorded as follow-up F-01 |
| R1-09 | minor, plausible | A probe admitted while a new key is being configured can stamp its verdict on the new pair | fixed (this commit): every credential or selection change starts a new verification generation; the provider route records a verdict only for the generation it started under, as `connection-state.md` requires ("a stale result cannot restore it") |
| R1-10 | minor, pre-existing | Expiry of an unpriced served model converts the preflight estimate even when the provider reported more usage | pending |
| R1-11 | nit, latent | A throw after settlement re-runs failure bookkeeping (double release on the mock, stuck unverifiable count) | fixed (this commit): the `billed` verdict, outcome and price are recorded the moment counters settle, and the failure path rethrows at once for a settled call |
| R1-12 | nit, latent | `billingModel ?? adapter.model` would price a keyed adapter that omits the served model at the requested tariff | fixed (this commit): only the mock may fall back, in the proxy and in the service; a keyed answer without a served model is `upstream` and stays `unverifiable`. Thirteen test doubles in four files now name their served model as every real adapter does; no assertion changed |
| R1-13 | nit | Docs: CHANGELOG floor, "200 settled calls" (the 200 are all receipt kinds), first-real-call names claim, 409 `busy` shown as a budget refusal, the floor parser reads only TAP | pending |
| R1-14 | nit | `AGENTS.md` says `.prompts/` vanishes in a fresh clone, but this backlog is force-tracked (D-02) | pending |
| R1-15 | major, found while fixing R1-04 | `npm run test:browser` hung since f42e1e1: "Run preview mock" now asks first and the preview check never answered the dialog | fixed (this commit): the check accepts and asserts the question; passes again |
| R1-16 | open observation | In `npm run dev` only, about 1 run in 15 the Tab walk found the canvas cards and edge focused (`:focus-visible` true) without the override outline, while every other stop kept its ring; never in production (every run passed). The compiled CSS contains the rule; the cause is unproven (a stale dev stylesheet is the leading suspect). The check now reports whether the override was loaded when it fails | open |

Follow-ups recorded by the review, not done in this branch:

- **F-01** When a usage shape cannot be parsed, every adapter throws before returning, so the served model the
  response did name is lost: receipts show `servedModel: null` and manual reconciliation journals only the requested
  model. Carrying the served model inside the `ProviderFailure` would fix it for all providers at once.

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
- **Q-07** OpenAI now prices the served snapshot (D-05). Which dated IDs and prices should be registered
  before any OpenAI use, or should OpenAI be removed from the allowlist until then?

## Session log

- Phase 0 inventory complete; this backlog written before any implementation.
- Phase 1 complete: V0–V11 done (V11 added by the review of V2). Floor 338 → 360.
- Phase 2 complete: S1–S6 done (Forget key UI, CSP and headers, key lifecycle table). Floor 360 → 366.
- Phase 3 complete except F7 (blocked on Q-03/Q-04): mock by default in dev, edit, Run once, confirmations,
  empty and unavailable states, export link. Floor 366 → 372.
- Phase 4: Q1 route boundaries (01f4faa), Q3 contrast, keyboard moves, focus and keyboard connect. Floor → 384.
