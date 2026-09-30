<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SaintPetrus — permanent rules

These rules are the project's own, not a single session's. They used to live only in chat prompts, which are unversioned: a prompt cited a file that no longer existed and another cited a commit SHA that only existed on one machine, and both rounds stalled. Anything permanent belongs here. If you are told a rule in a prompt and it is not written below, add it here before you act on it.

Language: all code, comments, commits and documentation are written in English.

`CLAUDE.md` contains only `@AGENTS.md`, so every agent reads this one file. Do not run `/init` or anything else that rewrites it.

## Verifying changes

Start from a clean tree: if `git status` is dirty before you begin, stop and report. Work one task at a time with a green gate between tasks, and record each closed task at once in the round's handoff under `.prompts/`. That directory is ignored by Git and vanishes in a fresh clone, so a permanent rule never lives only there.

One gate, run in full before every commit:

```
npm run gate
```

`scripts/gate.mjs` runs CI's blocking steps in CI's order and stops at the first that fails: `node scripts/check-staged.mjs --tracked`, `npm audit --audit-level=high`, lint, typecheck, the tests held to the floor by `scripts/check-test-floor.mjs` on their own output, and the build. CI installs with `npm ci` and runs the same script, so the steps live in one place; its Gitleaks job stays apart, and so does Gitleaks on the staged diff before every commit (Safety locks). A commit once passed an older subset of these steps and turned CI red on an advisory published that day (Round 4, R4-6). The gate needs installed dependencies: after a change to them, run `npm ci` first, as CI does.

`npm audit` asks the registry. If the registry does not answer, the gate fails: report it and never skip the step. How a new advisory is fixed is under Dependencies.

If a build fails with an error the code does not explain, run `rm -rf node_modules .next && npm ci` before investigating further. An inconsistent dependency installation once consumed four diagnostic rounds.

The Codex sandbox is the exception. There `npm run build` fails with `Could not parse output from TypeScript's --showConfig` because the sandbox refuses nested Node processes (`spawnSync /usr/bin/node EPERM`). That is the environment, not a defect in the repository: the build is the gate's last step, so report the gate as passed up to the build and leave the build to the operator. Do not reinstall, add a shim or change configuration to get past it. It has already cost two investigations from scratch.

`npm run typecheck` runs twice on purpose, once for the app and once for `tsconfig.core.json`, because `lib/core` is published as a dependency-free pure package and must typecheck on its own.

The test count is a floor, not a target. It stands at 518 today. A run below the floor means the working tree is incomplete: stop and report instead of building on top of it. Raise the number here in the change that adds tests; a stale floor silently authorizes losing the difference.

Every fix ships with a test that dies with it. After the gate is green, deliberately break the line you just fixed and confirm one of your tests fails. A test that survives the mutation covers nothing, so report the mutation result alongside the diff. A change that only touches documentation has no mutation: say so instead of inventing one.

Never delete, skip or narrow a test to get green: no `skip`, `only` or `todo`. CI refuses a run below the floor or with any failed, cancelled, skipped or todo test (`scripts/check-test-floor.mjs`). Do not loosen lint or TypeScript configuration. A new `@ts-ignore`, `eslint-disable` or `any` needs a comment on the same or the previous line saying why it is unavoidable.

A change to an API contract updates its documentation and its tests in the same change.

Ratchet pins and allowlists in `tests/repository-ratchets.test.ts` only go down. They hold direct `fetch` inside `lib/providers/` apart from a shrinking legacy allowlist, zero browser storage references, no provider error-body reads, every stream frame through `safeStringify`, no model-literal branches in adapters, React Flow nodes owned by `useNodesState`, shrinking counts of type assertions and Gitleaks suppressions, and the anchors of the reference documents below. A failing ratchet is fixed by migrating the occurrence, never by raising a pin or extending an allowlist; when a count falls, lower its pin in the same change. A new pin is computed from the current tree, never estimated. Do not add a `max-lines` limit on its own: this code concentrates density in long lines, so a line count would pass unreadable files. A useful limit needs line length too, which is a large refactor: propose it and wait.

Never create a recovery copy or backup inside the project, and ask before creating one anywhere else. A recovery copy under `.audit/` was once linted as source.

## Money locks

No call with a real key, to any provider, without explicit operator approval. This covers requests that generate no tokens: `GET /models` is unpriced but still authenticated, and still needs approval.

Any decision that changes how much is spent stops and asks. Do not pick an option and report it afterwards.

Preflight never underestimates. It prices at the peak rate and assumes zero cache hits, because a refusal is a preflight decision and overestimating only returns credit later. Reconciliation uses the real cache split and the rate for the hour the response arrived; a call that crosses a peak boundary reconciles at peak.

The price key is the `model` field of the **response**, never the string that was requested. Providers reroute: from 2026-09-14 every `deepseek-v4-pro` request is served and billed as Flash. A model missing from the price table fails closed before any provider I/O. Record the divergence when response and request disagree. Budget rows stay keyed by the requested model while the price comes from the served one. Read `docs/reference/billing-scope-and-price-key.md` before changing either.

A reservation that expires unresolved converts at the greater of what was held and the dearest eligible price, at peak with no cache hits. Capture its validated provider when reserving. Narrow to that provider only when every usable price candidate declares its provider in `prices.json`; otherwise retain the global floor. Price metadata is independent of request authorization, so never filter candidates through the policy allowlist. Lost contact means the served model is unknown; narrowing removes incidental headroom from unrelated providers, not uncertainty about the invoice. Read `docs/reference/billing-scope-and-price-key.md` for the accepted tradeoff.

A model policy declares whether the model can produce a reproducible answer at all. The claim is per model, like price, because the capability belongs to the model and not to its provider. Absent means no. The response cache needs both halves: the policy vouching for the model, and this particular request having actually turned reasoning off.

`cacheTtlMs` is 0 in `config/token-policy.json` on purpose until a real key has been validated, and a test pins it. With the response cache off, the per-model determinism declarations are correct but dormant. Turning the cache on is an operator decision about spend, not a cleanup.

A usage parser is strict and fails closed on a shape it does not know. It never fills a missing field with zero: the input bands differ by orders of magnitude, so a guess would price an unread response as if someone had read it. DeepSeek's `prompt_tokens_details.cached_tokens` must equal `prompt_cache_hit_tokens`; that is the only cheap evidence the two documented fields mean what we assume.

When a provider's usage shape cannot be parsed, record the set of field names the response carried, never a value. Names are not an error body, and they turn a failed first call into one correction instead of a blind retry.

`config/prices.json` is maintained by the operator, from their own browser, with a `verifiedAt` date. No agent transcribes a provider's price into it, and no agent adds a DeepSeek price or model identifier to configuration. Independent readings of the DeepSeek page on the same day produced different numbers, and cached snapshots circulate as if official. Until the operator enters a DeepSeek model with its price, selecting it is refused with `model_not_allowlisted`; that is the correct answer, not a gap to close.

Likewise no agent invents a model ID, a rate, a budget or a peak window, or writes real values into `config/token-policy.json`. Fictitious values belong only in tests, clearly marked as fictitious.

Price administration appends validity records in the same file. The server may fill only an open predecessor's `expiresAt`, exactly at the successor's `effectiveAt`; all other predecessor fields remain unchanged. Refuse overlap and edits or closures covering reconciled consumption. Reservations capture price-version identities and their tariff data before I/O, including known reroute candidates: a later price edit must never change their reconciliation or expiry floor. Historical prices are never deleted; browser price writes do not relax credential protections.

**The input counter is approximate.** The monetary ceiling blocks concurrency and refuses later calls, but it is a guard, not a proof of what the invoice will say. Treat it as a guard. This is why the first real call ever made against each provider, not merely the first of a session, must be checked against the actual invoice before a second one is made.

## Safety locks

A key never reaches `localStorage`, `sessionStorage`, a URL, a log, or a response body. The only request that may carry one is the local credential configuration call. Authored code holds no browser storage reference at all, and that zero has no allowlist.

No key in code, an environment variable, a file, a command argument, a log, a fixture or a commit, and an agent never creates a `.env` file: tests generate synthetic material at runtime and use mocked transport only. Anything that tries to reach a provider's network during development is stopped and reported. Gitleaks must report zero findings on staged content before every commit. If it finds a secret in something already published, stop and report at once: the key must be revoked, and history is not rewritten.

Do not weaken these guarantees: loopback binding; exact Origin and JSON checks on local POSTs; redaction in every stream and in the export; synchronous reservations in all four scopes; conservative expiry that never releases uncertain consumption; the agent paused on `unverifiable`; fixed provider endpoints without redirects; and a `/api/provider` body that carries no key, model or URL.

Every stream redacts as it sends. The graph stream, the live event feed and the artifact preview serialize each frame with `safeStringify`, even when what they hold was redacted as it was stored: a key configured later is redacted only from then on, so a record kept from before would repeat it. A new stream does the same, and `tests/repository-ratchets.test.ts` lists the streams and holds every frame to it (Round 4, R4-6).

A residue that stays only in the memory of an open panel tab, and never reaches disk, the export or a stream, is documented as an accepted risk under residual risk in `SECURITY.md` and does not open a new round (Round 4, R4-6): it is shown only in that tab, and a reload clears it.

A provider error body is never read, echoed, logged or returned. Adapters translate HTTP status into the shared `ProviderFailure` code vocabulary and nothing else crosses the boundary.

Status-to-code translation belongs to each adapter, not to a shared helper. A generic `upstreamCode` was written with one provider in hand and the second provider contradicted it: Gemini's 400 is an invalid key, DeepSeek's 400 is a malformed request of ours. The code set stays shared; the translation stays per adapter.

Each provider has its own adapter. DeepSeek speaks the OpenAI wire format but not its accounting, so it is never `OpenAIAdapter` with another base URL: that class would carry a status mapping, usage parser and price key that are each wrong for DeepSeek. Every call goes through `ProviderProxy`, which owns the timeout, and every adapter sets `redirect: 'error'` and caps the response body.

HTTP 402 means the balance ran out while the service and the key still work, so it writes no verification verdict. Only `unauthorized` and `not_found` mark a credential rejected.

Losing contact with a provider is never evidence that nothing was billed. Codes that prove rejection before generation release the reservation cleanly. Timeouts and 5xx stay unresolved and are converted to conservative usage by reservation expiry. Billing verdicts are exactly `unbilled`, `billed` and `unverifiable`, with no synonym in any layer.

Any validation that protects a key, a token budget or money decides on the server. A client-side check is presentation only.

Chain-of-thought output (`reasoning_content` and its equivalents) never enters a context envelope, an event, a preview or an artifact. It can echo the whole prompt back.

The RT-04 response cache only accepts an entry when thinking is explicitly disabled, and the thinking state is part of the payload hash. DeepSeek silently ignores `temperature` in thinking mode, so a `temperature = 0` payload is not evidence of a deterministic response. No test can kill the thinking field in that hash: only requests with reasoning off reach the cache, so the field is constant across entries. It stays as defence in depth by operator decision; do not remove it as dead code.

The connection probe switches reasoning off wherever the wire protocol has an off switch, whatever the policy says, so it cannot spend its whole output budget thinking and come back empty. Where there is no off switch the policy stands: omitting the field hands the choice back to a costlier provider default. What each provider can express lives in one table, `lib/providers/thinking-policy.ts`, not in a literal inside an adapter. Its four properties are not interchangeable; collapsing them breaks a specific guarantee.

RF-03 and RF-04 are out of scope. Do not start them.

## Operator decisions (2026-09-27)

The mock is the default in every mode. Real providers are enabled only by an explicit opt-in at startup (`SAINTPETRUS_MODE=real`), read once and pinned for the life of the process; the UI always shows whether it runs MOCK or REAL.

OpenAI is not supported until the operator has validated it. It stays out of the policy allowlist, and no agent registers an OpenAI snapshot or price.

Remembered keys and the persisted graph live in the operator's OS user data directory, never in the checkout, with the directory at 0700 and files at 0600. A legacy vault found in the checkout is copied, the copy verified, and only then the original deleted.

When a provider answers with a served model that has no captured price, a reservation that expires converts at the greater of the estimate and the reported usage in each dimension (input, output, reasoning), priced at least at the requested model's peak, cache-miss rate. It stays an estimate, is never reduced automatically, and the agent stays paused until manual reconciliation.

Removing an agent asks first and is refused while the agent has an active, unverifiable or unreconciled reservation. Its `agent` accounting rows stay, marked as a removed agent.

A graph import is untrusted input: strict schema, a size limit, unknown fields and credential-shaped text refused, and every model through the allowlist. The graph format names no model, so a `model` field is refused as unknown; a model field added later must be checked against `policy.models`. The export stays redacted and carries no accounting.

Run once goes through the same preflight and budgets as any call and asks first, showing the maximum cost it reserves. The quote and the call share `TokenService.plan`, so the quote cannot be cheaper or more permissive than the call; keep them on one code path. Run once stays because no other action sends an agent's own message and records its output.

The mock answers "MOCK answer: no model was called and nothing was billed." to Run once and to the connection test, and the `agent.output` event says "Answer recorded.": neither may claim a verified connection or a provider. Verification semantics are unchanged (`docs/reference/connection-state.md`).

Run once sends the agent's objective, unchanged, as the system instruction, with the user's message; the quote uses the same instruction through `TokenService.plan`. There is no separate instruction field. The connection test keeps `Reply OK.` with the first agent's summary, as `docs/reference/first-real-call.md` describes. `max_tokens` and the budgets in `config/` are the operator's.

Graph events name who they concern, as named at that moment (`agent`, or `source` and `target` for connections, each `{ id, name }`), so `agent.removed` still names the agent that left, and every stream event carries the server's clock `at`. The revision stays the only order; `at` is for display. `isGraphEvent` refuses unknown keys, a missing `at` or a malformed party.

Accounting is journaled (Round 3): `accounting.jsonl` in the user data directory, 0700/0600, one synced record per change, written before the change can take effect, holding only IDs, counts, amounts, price versions, verdicts and times. Start rebuilds the global, agent and model scopes, reservations with their deadlines, `unverifiable` states, pauses and the last 200 receipts; the session scope and the mock's usage stay per process. A reservation in flight when the process stopped returns `unverifiable` with its agent paused, never refunded; its deadline is the latest it could have had without the crash, `createdAt` + `DEFAULT_PROVIDER_TIMEOUT_MS` + `reservationTtlMs`, taken from the journal alone so restarts never move it, and a deadline already past converts on the first read like any other. An unreadable journal is set aside, never overwritten, and blocks real calls until the operator starts a new budget period, itself journaled; nothing restarts from zero on its own. Never rewrite or truncate a complete journal record.

A new budget period zeroes consumption and keeps limits, pauses and Pause all; it is refused while a reservation is open. It never resumes an agent: resuming stays an explicit action, as after raising a limit, and Budgets says which agents are still paused and points to **Resume eligible agents** (Round 3, R3-2).

A delegation connection is deleted only with its subagent (Round 4, 2026-09-29). The server refuses `disconnect` on a `delegation` edge with a message that says to remove the subagent; only `context` connections can be deleted. The canvas explains this while a delegation is selected, but the server decides.

No accepted graph command may leave a graph the app cannot save (Round 4, R4-2). `tests/graph-invariant.test.ts` runs every `GraphService` command, by name and in a seeded random walk, and parses the redacted snapshot with `parseGraphDocument` after each accepted one; a refused command must change nothing. A new command joins that test in the change that adds it.

While `GraphStore` cannot save the graph, for whatever reason, the panel shows a persistent warning with the store's reason until it saves again (Round 4, R4-3). The reason is the parser's own sentence or a fixed one, never the refused text or a path. `GET /api/graph/persistence` serves that state read-only from the custom server, the only copy of the modules that holds the store.

A key configured after it was typed into the graph leaves the graph at once (Round 4, R4-5). `registerSecret` tells the listeners registered with `onSecretRegistered`, kept on `globalThis` like the keys so either copy of the modules reaches them, and never passes them the key. The process graph (`runtime()`) follows that registry: `GraphService.redactSecrets` replaces every name, objective, summary, artifact and output the redactor would change with the redacted text, within its limit, as its own `graph.redacted` event, so the store saves it at once and a later Disconnect or Forget key cannot write the key back from memory. Credentials never call the graph or the store. Every stream redacts again as it sends (Safety locks), so a record retained from before a key was configured cannot repeat it. The panel never knows the key, so it does not redact what it already holds: when `graph.redacted` arrives it discards the Activity lines, the live feed lines and the Run exchanges it received before, and the Activity log says so (Round 4, R4-6). `lib/cleared-history.ts` decides what is discarded; it is presentation state only.

## Interface vocabulary

The panel, the README and the tests use these words and no synonyms:

- **Mode**: `MOCK` or `REAL`, as the server was started. Its badge stays visible next to the brand, with a tooltip.
- **Connection**: the provider and model that Run once uses. It keeps the five states of `docs/reference/connection-state.md` with their meaning (configured is not verified); only the text may be shorter.
- **Demo**: the fixed demonstration, loaded with **Load demo**, which warns that it replaces the canvas. Its fictitious spend is the **Demo cost**.
- **Graph limits**: maximum depth and maximum number of agents.
- **Roles**: Coordinator, Agent and Subagent, with the level written out ("level 1").
- **Agent status**: Ready, Running, Completed, Paused and Blocked, each with its own icon, colour and text (`lib/agent-status.ts`). Status is never shown by colour alone.
- **Budgets** and **Prices** are separate places. **Export graph** and **Import graph** are the pair for the graph file.

The graph file keeps its `Unconfigured` and `Mock` provider labels; they are not shown on screen.

## Reuse before reimplementing

Before writing new logic at any scale, look for an existing implementation and extend it. Search in proportion to the work: a quick look for something trivial, a real search before a subsystem.

The §5.4 detectors and the RF-07 handoff come from `lib/core`. They are pure, dependency-free and already tested. Do not reimplement them elsewhere.

## Dependencies

Prefer what is already installed. A new dependency needs its justification in the commit message and the handoff, a permissive license (MIT, Apache-2.0, BSD or ISC), no telemetry and active maintenance. Updates stay within patch and minor versions, and only with a green gate.

A new advisory that turns `npm audit` red is fixed the same way: a patch or minor release and a green gate. With no fix available, stop and report. Regenerate `package-lock.json` with a current npm: npm 10 drops the `libc` fields newer npm writes for platform packages, so use npm 11 (`npx npm@11 audit fix`) and then install with `npm ci`, as CI does (Round 4, R4-5).

## State ownership

Read `docs/reference/state-ownership.md` before adding a producer, cache, fallback, reader precedence or client-side ordering for graph, connection, token or event state. Each domain has one server owner; readers keep only transient presentation state.

## Reference decisions

Each reference answers, in one short paragraph, why its decision must not be simplified, and is anchored below.

- Read `docs/reference/react-flow-node-identity.md` before changing React Flow node reconciliation or replacing `useNodesState` ownership.
- Read `docs/reference/react-flow-minimap-sizing.md` before moving MiniMap dimensions between its `style` prop and CSS.
- Read `docs/reference/reservation-expiry.md` before changing unresolved reservation expiry or reconciliation.
- Read `docs/reference/price-validity-administration.md` before changing price writes, validity selection or captured reservation tariffs.
- Read `docs/reference/deepseek-price-table.md` before adding or updating DeepSeek model or price configuration.
- Read `docs/reference/deferred-price-dimensions.md` before adding a model whose rates change with prompt size, such as a long-context tier, or that charges for cache writes. The price schema models neither.
- Read `docs/reference/connection-state.md` before changing credential, provider verification or connection-status semantics.
- Read `docs/reference/first-real-call.md` before the first call with a real key against any provider.

## Comments

Brief, and only for what is not obvious from the code. Explain why, not how. One line where one line does.

## File and module names

Never `helpers`, `utils`, `common` or `misc`. Name a module after the domain concept it owns. `lib/utils.ts` is the existing violation: it re-exports `cn` under the `@/lib/utils` alias that `components.json` expects, and renaming it means changing the shadcn alias. It is the one known exception and it is waiting on a decision, not on a discovery.

## Commits

The agent does not commit. No `git add`, no `git commit`, no `git push`, and no offering to. Leave the tree dirty and report the diff. The operator commits, always; a commit the operator authorized in an earlier round is an exception, not a precedent. No stashing, no reverting, no merging, and no branches beyond the working branch you were told to create.

Do not search for a commit SHA to orient yourself. A hash depends on committer and timestamp, so yours legitimately differs from anyone else's.
