# SaintPetrus — current status

Branch: `main`, which merged `night/provider-validation-ready` on 2026-09-29 (Round 4 below). That branch continued `night/provider-validation` from the operator's price-admin commit `0662647` on `night/price-admin`, following `night/price-schema`. Remote repository: `joaoheliodev/SaintPetrus`. Permanent rules live in `AGENTS.md`; timestamped events live in the append-only `NIGHT-LOG.md`.

## Verification checkpoint (2026-09-27)

Run in a cloud session without any API key: lint, both typechecks, the full suite at the floor stated in
`AGENTS.md` (463 tests at the end of the UI round) with zero failures or skips, and `npm run build` passed before
every commit of the finishing session. After a fresh `npm ci`, `npm audit` reported 0 vulnerabilities and the
keyless `npm run dev` main flow passed the browser check. `npm run test:e2e` passed in development and in
production and `npm run test:browser` passed. Gitleaks found nothing in the staged diff of any commit, in the
working directory, in the branch range `0662647..HEAD` or in the full history. CI passed on every push of
the branch (40 runs). Two independent reviewer agents audited `0662647..HEAD`; their findings and dispositions are in
`.prompts/FINISH-BACKLOG.md`. No provider request was made, including `GET /models`.

## Delivered

- **Workspace, credentials and proxy (M0–M2, RF-01).** Loopback server, memory-only credentials with opt-in OS-keyring encryption, and a provider proxy that owns the timeout, the single active request and redaction.
- **Core integration.** The §5.4 detectors and the RF-07 handoff come from `lib/core`, which typechecks on its own.
- **Token and USD budgets (RF-06).** Global, agent, model and session scopes. Preflight reserves at peak with no cache hits before provider I/O, reconciliation prices the served model with the reported cache split, and unresolved reservations expire into conservative usage that accepts manual reconciliation.
- **Event feed and artifact preview.** Both off by default (`SAINTPETRUS_FEED`, `SAINTPETRUS_PREVIEW`). The preview runs generated code in a script-only sandbox under CSP; its Chromium isolation check passed on 2026-09-07 and is reproducible with `npm run test:browser`.
- **Providers.** OpenAI Responses, Gemini `generateContent`, DeepSeek with its own adapter and strict usage parser, and the mock. Status mapping lives in each adapter, thinking capabilities in one table, and chain of thought stays out of context, events, previews and artifacts.
- **Repository discipline (Orca O1–O5).** `AGENTS.md`, ratchet tests, exhaustive `unbilled | billed | unverifiable` verdicts, one server owner per state and anchored reference decisions.
- **Price schema.** Optional `expiresAt` with a preflight horizon covering the reservation TTL (P1); the enforced total `costAccountedUsd` named apart from its unmeasured part `costUnmeasuredUsd` (P2).
- **Provider-scoped expiry floor (P3).** Implemented: capture the validated provider and tariff candidates; narrow only when every usable candidate has price-side provider metadata, otherwise retain the global floor. Charge at least the original hold in all four scopes. Request allowlisting does not remove price-only reroute candidates.
- **Round C.** Orphan permanent rules moved into `AGENTS.md`, local refusal verdicts proven unreachable with a live reservation, and the deferred price dimensions and first real call protocol documented.
- **Finishing session (2026-09-27).** Served-model price keys for Gemini and OpenAI; an unpriced served model stays `unverifiable`; unreadable usage names its fields; per-call receipts (`GET /api/receipts`) and an upstream dispatch counter; a startup-only validation timeout; DeepSeek in the terminal key helper; an empty probe never verifies. Forget key in the panel; a content security policy on every response. The panel works keyless in `npm run dev`; agents can be edited, run once and connected from the keyboard; destructive actions ask first; keyboard moves are saved; focus and field contrast meet WCAG AA. README, `docs/architecture.md`, the `SECURITY.md` threat model and `CHANGELOG.md` rewritten or added; CI holds the test floor. The review then fixed a regression of this branch in which the running app lost every provider failure's code (the custom server and the routes hold separate copies of the modules; failures now carry a `Symbol.for` brand), graph refusals that lost their message for the same reason, a browser check that could have made a real call, settled calls that could be failed again, lax OpenAI usage parsing and a verification race. The backlog, decisions and questions for the operator live in `.prompts/FINISH-BACKLOG.md`.

## Operator decisions Q-01 to Q-10 (2026-09-27)

- **Q-01** The mock is the default in every mode; `SAINTPETRUS_MODE=real` opts into real providers at startup and is
  pinned for the process. The header always shows MOCK or REAL. The retired `SAINTPETRUS_MOCK*` variables stop startup.
- **Q-02** Nothing implemented, as answered.
- **Q-03** An agent can be removed after a confirmation, never while it holds an in-flight, unverifiable or
  unreconciled reservation; its accounting rows stay, marked as a removed agent.
- **Q-04** The graph is saved in the user data directory and restored at startup; import is untrusted input (strict
  format, 4 MiB, unknown fields and credential-shaped text refused, no model in the format). The export stays
  redacted; accounting stayed process-local until R-02.
- **Q-05, Q-06** No answer, so the security contact stays a marked placeholder and there is no LICENSE.
- **Q-07** OpenAI is out of the allowlist and not offered until validated; no snapshot or price was added.
- **Q-08** Remembered keys moved to the user data directory (0700/0600); a legacy `data/vault` is copied, verified
  byte for byte and only then deleted, at startup.
- **Q-09** Run once stays and asks first with the server's quote of the most it reserves, from the same checks.
- **Q-10** An unpriced served model's expiry converts at the greater of estimate and reported usage per dimension,
  at least at the requested model's peak, cache-miss rate; the agent waits for manual reconciliation.

## UI round (2026-09-27)

Presentation only (no route, contract, file format, accounting, payload, configuration, mode, header or CSP
change): a sidebar of views, a top bar with the connection chip, budget meter, Ctrl+K palette and Pause all; one
interface vocabulary (`AGENTS.md`); an agent panel whose Run tab shows message, answer, tokens, latency and the
server-accounted cost together; Budgets with a summary and the way out of a block; a readable Activity log; a First
steps bar; in-app confirmations opening on Cancel; the demo and every graph replacement behind the More menu. Open
questions are in `.prompts/FINISH-BACKLOG.md` (Phase 8, "Questions for João").

## Round 3 (2026-09-28)

- **Q-U3** The mock answers "MOCK answer: no model was called and nothing was billed."; `agent.output` says "Answer
  recorded.". Verification semantics are unchanged.
- **Q-U2** Graph events name the agent (also on `agent.removed`), the connection's source and target, and carry the
  server's `at`; `isGraphEvent` is strict. Activity shows the name and the server time.
- **Q-U1** Run once sends the agent's objective, unchanged, as the system instruction; quote and call share
  `TokenService.plan`. The connection test keeps `Reply OK.` with the first agent's summary.
- **R-01** Credential-shaped text is refused at creation and edit; provider output is redacted before the 8000
  cut; the graph store never writes a file its own parser would refuse, keeping the last valid one and warning.
- **R-02** Accounting is journaled (`accounting.jsonl`) and rebuilt at start: global, agent and model consumption
  and cost, limits changed in Budgets, reservations with deadlines, `unverifiable` states, pauses and the last 200
  receipts. The session budget and the mock's usage stay per process. A call in flight at a crash returns
  `unverifiable` with its agent paused. An unreadable journal is set aside and blocks real calls until **Start a new
  budget period**.

## Round 4 on `main` (2026-09-29)

`night/provider-validation-ready` was merged into `main` with its history (merge commit `6c69307`); work continues
on `main`.

- **R4-1** A delegation connection is deleted only with its subagent. The server refuses `disconnect` on a
  delegation with a message to remove the subagent; only context connections can be deleted. The canvas explains
  this while a delegation is selected. Until now the deletion was accepted and left a subagent without its
  delegation, a graph the store refuses to save, so every later change was lost at the next restart.
- **R4-2** No accepted graph command leaves a graph the app cannot save: a test runs every `GraphService` command,
  by name and in a seeded random walk, and parses the redacted snapshot after each accepted one. It also found, and
  the round fixed, a subagent placed outside the canvas beside a parent at its edge, an output cut inside
  "Bearer [REDACTED]" that saved longer than its limit, and demo output past 8000 characters.
- **R4-3** While the graph cannot be saved, a persistent warning under the top bar gives the store's reason until a
  change is saved again; `GET /api/graph/persistence` serves that state read-only. A failed write is one such
  reason.
- **R4-4** The browser check deletes a context connection (refused, then confirmed) and checks that deleting the
  delegation is refused, and that the store keeps saving to the end.
- **R4-5** A key typed into the graph before it was configured stayed in plain text on disk: in memory the graph was
  never redacted, the store wrote a redacted copy only at the next change (it did not refuse, as R-01 assumed), and
  once the key was disconnected or forgotten the next change wrote it back in plain text. Now configuring a key tells
  the process graph, which replaces every text the redactor would change with the redacted text, within its limit,
  as its own event, and the store saves that at once. The live event feed redacts again as it sends.
- **R4-6** `npm run gate` is the one gate: CI's blocking steps in CI's order (tracked-path check, `npm audit
  --audit-level=high`, lint, typecheck, tests held to the floor, build). CI runs `npm ci` and then the gate. The
  artifact preview redacts again as it sends, like the graph stream and the feed: Run once answers reach it too.
  When `graph.redacted` arrives, the panel discards the Activity lines, live feed lines and Run exchanges it received
  before it, and the Activity log starts again with "Earlier activity cleared because a key was configured".

## Round 5 on `main` (2026-09-30)

The operator could not un-pause the agents. Reproduced first, entry by exit, on fresh instances (the table is in the
round's handoff); each fix below answers a cell that did not come back.

- **R5-2** Pause all agents left the graph's run `paused` even with no demo running, so after Resume eligible agents
  every agent was Ready but Import, Reset, Load demo and Graph limits stayed disabled and the server refused remove
  and import; in REAL, where there is no Resume demo, only a restart got out. Now Pause all pauses the run only while a
  demo runs, Resume eligible agents lets that demo go on, and a demo paused with Pause demo says on screen how to
  finish it (Reset graph now ends a paused demo too). With Pause all on, import is refused like reset and add, and
  every such refusal says to use Resume eligible agents.
- **R5-3** The token service is the one owner of pauses and the graph shows exactly the ones it holds. Before, an
  agent removed or reset away while paused kept its id in the token service's pauses for good, across resumes and
  restarts, so Resume eligible agents stayed enabled with nothing to resume; and a Reset graph gave a paused
  Coordinator a Ready card while Run once still answered "Agent paused.". Now such a pause goes with its agent
  (unless the agent still holds a reservation, so that it comes back paused), a reset, an import or a restore shows
  the pauses still held, and the demo never overwrites one.
- **R5-4** Every pause says why. A resume that released nobody answered 200 with nothing on screen, a resume refused
  by unverifiable usage answered the generic "Token control rejected…", and the summary named only the first full
  scope. Now the token snapshot carries, for every paused agent, what holds it (Pause all agents, unverifiable usage
  and until when, an estimate awaiting reconciliation, every full scope with its dimension and whether the mock's
  usage fills it, or a removed agent's reservation); a resume answers whom it released, a refusal answers 409 with the
  server's sentence, and Budgets words both beside the button. The summary names every full scope, leaves out a
  removed agent's row (it blocks nothing), and Details offers no limit for one (the server refuses it).
- **R5-5** The way back is where the pause is made. After Pause all agents the canvas used to offer only "Resume
  demo", and Resume eligible agents sat in Budgets alone. Now, while anything is paused, Resume eligible agents stands
  beside Pause all agents in the top bar and in Commands (Ctrl+K), with the same command and answer as in Budgets; a
  notice under the top bar says what holds each agent and opens Budgets; the panel of a Paused agent says why and
  opens Budgets.
- **R5-6** A new budget period says what it clears. Its question and Details said that consumption "starts again
  from zero" while the mock's estimated tokens stayed, so a scope the mock filled stayed full after it. Since R5-11
  the period clears the mock's estimated tokens in every row, the session row's mock part included, and the session
  row keeps only what real calls spent since the server started; the question and Details say exactly that.
- **R5-7** `tests/pause-invariant.test.ts` walks Pause all, resume, raised and filled limits, a new period, calls,
  connection tests, quotes, add, remove, Graph limits, reset, export and import through the routes and the process
  token service, 2000 seeded steps in MOCK and 500 more in REAL without a key, and checks after every step that the
  graph and the token service agree on every pause, that a way back and a reason are always there, that a resume
  releases exactly who nothing but Pause all holds, and that every refusal says why and changes nothing. It kills the
  regressions of R5-2 to R5-5 it was tried against. No demo runs in it: its timers would make the walk
  irreproducible, and `tests/pause-resume.test.ts` covers the demo.
- **R5-8** The browser check fills the global budget in Details, runs the connection test (Run once asks for a quote
  first and pauses no one), and follows the Coordinator: the test says "Stopped by the server: Token or monetary budget
  exhausted.", the notice and the Paused agent's panel name the full scope, Resume eligible agents answers "No agent
  was resumed.", the panel opens Budgets, and after the limit rises Resume releases it. After Pause all no Resume demo
  is offered. In REAL without a key, screen and GETs only (no provider route, no Run once): after Pause all the top bar
  shows Resume eligible agents, the notice and the inspector say why and no Resume demo exists; after it every agent is
  Ready, Import, Reset and Graph limits are enabled and the server accepts import and remove.
- **R5-10** Re-running E5 on the final code showed that unverifiable usage was always explained as "a call lost contact
  with its provider", also for an answer whose usage could not be read and for an unpriced served model (A-10). The
  refused resume, the pause and Budgets now say that a call's cost could not be confirmed; the exact cause stays in
  the Run once result and the Activity feed.
- **R5-11** Operator decision R5-Q1: Start a new budget period also clears the mock's estimated tokens, in every
  budget row. In the session row only the mock's part goes; what real calls spent since the server started stays, so
  a period never grants a second session of real spend. A scope the mock filled is free again after the period, and
  Resume eligible agents releases its agent; the pause sentence now offers the period next to a higher limit and a
  restart.
- **R5-12** Operator decision R5-Q2: an ordinary expired estimate does not hold its agent. The agent can be resumed
  and call again while the estimate stays counted, conservatively, in all four budgets and Budgets names it; only an
  unpriced served model's estimate holds its agent until it is reconciled by hand. The service already did this; a
  test now pins it, and `docs/reference/reservation-expiry.md` says it.
- **R5-13** Operator decision R5-Q3: a preflight refusal, where every scope has room but not for this call's worst
  case, no longer pauses the agent. The call is refused as before and nothing is sent. An agent is paused only by a
  full budget, unverifiable usage, an estimate awaiting reconciliation or Pause all, so the loop R5-1 found (S4:
  Resume, the next call refused, paused again) is gone.

## Not verified or pending

- No provider has answered a real request. Gemini step 1B and DeepSeek D7 wait for explicit operator approval and follow `docs/reference/first-real-call.md`. `GET /models` is not approved.
- Step 1B also owes a forced real provider error with fragment checks, 429 and timeout if feasible, context export and enabled-feed credential scans, and sanitized real fixtures with a regression fix for each observed divergence.
- DeepSeek has no model ID and no price in configuration, so selecting it is refused with `model_not_allowlisted` until the operator enters both from the browser.
- The configured OpenAI and Gemini rates were verified on 2026-09-07. Account and model availability are unverified.
- OpenAI is not supported until the operator validates it: it is out of the allowlist and the panel does not offer it (Q-07). Once added back, it is priced by the dated snapshot its response names.
- The response cache is off (`cacheTtlMs` 0) until a real key is validated, so the per-model determinism declarations are dormant.
- Long-context tiers and cache-write pricing are not modeled; see `docs/reference/deferred-price-dimensions.md`.
- The Responses streaming path and real error, quota and timeout handling are tested only with synthetic transport.
- The full RF-02 panel is pending. RF-03 and RF-04 are out of scope.
- Agent removal (Q-03), graph persistence and import (Q-04) are implemented; accounting is journaled since R-02.
- There is no LICENSE file and the security contact in `SECURITY.md` is a marked placeholder: Q-05 and Q-06 came back empty.
- Accessibility was checked in Chromium (contrast, control names, visible focus, keyboard paths), not with a screen reader.
- When usage cannot be parsed, the served model the response named is not carried into receipts or manual reconciliation (F-01). The panel's Forget key reaches only the selected provider; the terminal helper reaches any (F-02).
- In `npm run dev` only, about one browser-check run in fifteen found the canvas cards focused without their outline; production never did. The cause is unproven (R1-16).
- Three Round 5 questions change spend or pause semantics and wait for the operator (backlog Phase 11): whether a new budget period also clears the mock's usage or the session row (R5-Q1), whether an expired estimate should hold its agent until reconciled (R5-Q2), and whether a refusal that finds room in every scope, but not for the call's worst case, should still pause the agent (R5-Q3, the loop S4 found).

## Open debts and limits

- A configured key leaves the graph, its saved file and every stream (R4-5, R4-6), and the open panel discards the Activity lines, feed lines and Run exchanges it received before `graph.redacted` (R4-6). The panel learns of a key only through that event: a key the graph does not hold publishes none, and a panel whose stream was down when the key was configured misses it; both keep what they showed until the page reloads. That is an accepted risk in `SECURITY.md` (R4-6); after configuring a key, reload every open tab of the panel. Copies the file system keeps of replaced blocks are outside what the app controls.
- The graph and the global, agent and model accounting survive a restart. The session budget, the mock's usage, events, artifacts and the dispatch ledger are process-local. The journal is a checkpoint log, not an invoice: the input counter is still approximate.
- An unresolved reservation converts after `reservationTtlMs` (300000 ms in the shipped policy) at the greater of the hold and the dearest eligible captured model at peak with no cache hits, using P3's provider rule, and stays marked as an expired estimate until manual reconciliation.
- The input counter is approximate. The monetary ceiling is a guard, not a proof of the invoice.
- Configured credential fragments of 12 or more characters are redacted; shorter substrings cannot be told apart from ordinary text.
- Native Windows and macOS keyrings are unverified. The Linux keyring roundtrip passed with synthetic material.
- Generated preview code can exhaust CPU or memory; a sandbox is not a resource quota.
- The Gitleaks suppression in `tests/core/token-estimate.test.ts` stays for a public counter name and is pinned by a ratchet.
- `lib/utils.ts` remains the one naming exception, waiting on a decision.

## Execution notes

- In the Codex sandbox `npm run build` fails with `Could not parse output from TypeScript's --showConfig` because nested Node processes are refused (`spawnSync /usr/bin/node EPERM`). The operator runs the build there.
- Under the installed Node 26, the first build after any edit prints `DEP0205` from `@tailwindcss/node` calling `module.register()`. It is a dependency warning, and the build passes.
