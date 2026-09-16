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

One gate, run in full, for every task:

```
npm run lint && npm run typecheck && npm test && npm run build
```

If a build fails with an error the code does not explain, run `rm -rf node_modules .next && npm ci` before investigating further. An inconsistent dependency installation once consumed four diagnostic rounds.

The Codex sandbox is the exception. There `npm run build` fails with `Could not parse output from TypeScript's --showConfig` because the sandbox refuses nested Node processes (`spawnSync /usr/bin/node EPERM`). That is the environment, not a defect in the repository: run lint, typecheck and tests, report, and leave the build to the operator. Do not reinstall, add a shim or change configuration to get past it. It has already cost two investigations from scratch.

`npm run typecheck` runs twice on purpose, once for the app and once for `tsconfig.core.json`, because `lib/core` is published as a dependency-free pure package and must typecheck on its own.

The test count is a floor, not a target. It stands at 292 today. A run below the floor means the working tree is incomplete: stop and report instead of building on top of it. Raise the number here in the change that adds tests; a stale floor silently authorizes losing the difference.

Every fix ships with a test that dies with it. After the gate is green, deliberately break the line you just fixed and confirm one of your tests fails. A test that survives the mutation covers nothing, so report the mutation result alongside the diff. A change that only touches documentation has no mutation: say so instead of inventing one.

Ratchet pins and allowlists in `tests/repository-ratchets.test.ts` only go down. They hold direct `fetch` inside `lib/providers/` apart from a shrinking legacy allowlist, zero browser storage references, no provider error-body reads, no model-literal branches in adapters, React Flow nodes owned by `useNodesState`, shrinking counts of type assertions and Gitleaks suppressions, and the anchors of the reference documents below. A failing ratchet is fixed by migrating the occurrence, never by raising a pin or extending an allowlist; when a count falls, lower its pin in the same change. A new pin is computed from the current tree, never estimated. Do not add a `max-lines` limit on its own: this code concentrates density in long lines, so a line count would pass unreadable files. A useful limit needs line length too, which is a large refactor: propose it and wait.

Never create a recovery copy or backup inside the project, and ask before creating one anywhere else. A recovery copy under `.audit/` was once linted as source.

## Money locks

No call with a real key, to any provider, without explicit operator approval. This covers requests that generate no tokens: `GET /models` is unpriced but still authenticated, and still needs approval.

Any decision that changes how much is spent stops and asks. Do not pick an option and report it afterwards.

Preflight never underestimates. It prices at the peak rate and assumes zero cache hits, because a refusal is a preflight decision and overestimating only returns credit later. Reconciliation uses the real cache split and the rate for the hour the response arrived; a call that crosses a peak boundary reconciles at peak.

The price key is the `model` field of the **response**, never the string that was requested. Providers reroute: from 2026-09-14 every `deepseek-v4-pro` request is served and billed as Flash. A model missing from the price table fails closed before any provider I/O. Record the divergence when response and request disagree. Budget rows stay keyed by the requested model while the price comes from the served one. Read `docs/reference/billing-scope-and-price-key.md` before changing either.

A reservation that expires unresolved converts at the greater of what was held and the dearest model in the price table, at peak with no cache hits. Lost contact means the served model is unknown, so the figure held for the requested model can understate what was billed.

A model policy declares whether the model can produce a reproducible answer at all. The claim is per model, like price, because the capability belongs to the model and not to its provider. Absent means no. The response cache needs both halves: the policy vouching for the model, and this particular request having actually turned reasoning off.

`cacheTtlMs` is 0 in `config/token-policy.json` on purpose until a real key has been validated, and a test pins it. With the response cache off, the per-model determinism declarations are correct but dormant. Turning the cache on is an operator decision about spend, not a cleanup.

A usage parser is strict and fails closed on a shape it does not know. It never fills a missing field with zero: the input bands differ by orders of magnitude, so a guess would price an unread response as if someone had read it. DeepSeek's `prompt_tokens_details.cached_tokens` must equal `prompt_cache_hit_tokens`; that is the only cheap evidence the two documented fields mean what we assume.

When a provider's usage shape cannot be parsed, record the set of field names the response carried, never a value. Names are not an error body, and they turn a failed first call into one correction instead of a blind retry.

`config/prices.json` is maintained by the operator, from their own browser, with a `verifiedAt` date. No agent transcribes a provider's price into it, and no agent adds a DeepSeek price or model identifier to configuration. Independent readings of the DeepSeek page on the same day produced different numbers, and cached snapshots circulate as if official. Until the operator enters a DeepSeek model with its price, selecting it is refused with `model_not_allowlisted`; that is the correct answer, not a gap to close.

**The input counter is approximate.** The monetary ceiling blocks concurrency and refuses later calls, but it is a guard, not a proof of what the invoice will say. Treat it as a guard. This is why the first real call ever made against each provider, not merely the first of a session, must be checked against the actual invoice before a second one is made.

## Safety locks

A key never reaches `localStorage`, `sessionStorage`, a URL, a log, or a response body. The only request that may carry one is the local credential configuration call. Authored code holds no browser storage reference at all, and that zero has no allowlist.

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

## Reuse before reimplementing

Before writing new logic at any scale, look for an existing implementation and extend it. Search in proportion to the work: a quick look for something trivial, a real search before a subsystem.

The §5.4 detectors and the RF-07 handoff come from `lib/core`. They are pure, dependency-free and already tested. Do not reimplement them elsewhere.

## State ownership

Read `docs/reference/state-ownership.md` before adding a producer, cache, fallback, reader precedence or client-side ordering for graph, connection, token or event state. Each domain has one server owner; readers keep only transient presentation state.

## Reference decisions

Each reference answers, in one short paragraph, why its decision must not be simplified, and is anchored below.

- Read `docs/reference/react-flow-node-identity.md` before changing React Flow node reconciliation or replacing `useNodesState` ownership.
- Read `docs/reference/react-flow-minimap-sizing.md` before moving MiniMap dimensions between its `style` prop and CSS.
- Read `docs/reference/reservation-expiry.md` before changing unresolved reservation expiry or reconciliation.
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
