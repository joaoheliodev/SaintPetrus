<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SaintPetrus — permanent rules

These rules are the project's own, not a single session's. They used to live only in chat prompts, which are unversioned: a prompt cited a file that no longer existed and another cited a commit SHA that only existed on one machine, and both rounds stalled. Anything permanent belongs here. If you are told a rule in a prompt and it is not written below, add it here before you act on it.

Language: all code, comments, commits and documentation are written in English.

## Verifying changes

One gate, run in full, for every task:

```
npm run lint && npm run typecheck && npm test && npm run build
```

`npm run typecheck` runs twice on purpose, once for the app and once for `tsconfig.core.json`, because `lib/core` is published as a dependency-free pure package and must typecheck on its own.

The test count is a floor, not a target. It stands at 242 today. A run below the floor means the working tree is incomplete: stop and report instead of building on top of it.

Every fix ships with a test that dies with it. After the gate is green, deliberately break the line you just fixed and confirm one of your tests fails. A test that survives the mutation covers nothing, so report the mutation result alongside the diff.

## Money locks

No call with a real key, to any provider, without explicit operator approval. This covers requests that generate no tokens: `GET /models` is unpriced but still authenticated, and still needs approval.

Any decision that changes how much is spent stops and asks. Do not pick an option and report it afterwards.

Preflight never underestimates. It prices at the peak rate and assumes zero cache hits, because a refusal is a preflight decision and overestimating only returns credit later. Reconciliation uses the real cache split and the rate for the hour the response arrived; a call that crosses a peak boundary reconciles at peak.

The price key is the `model` field of the **response**, never the string that was requested. Providers reroute: from 2026-09-14 every `deepseek-v4-pro` request is served and billed as Flash. A model missing from the price table fails closed before any provider I/O. Record the divergence when response and request disagree. Budget rows stay keyed by the requested model while the price comes from the served one. Read `docs/reference/billing-scope-and-price-key.md` before changing either.

A reservation that expires unresolved converts at the greater of what was held and the dearest model in the price table, at peak with no cache hits. Lost contact means the served model is unknown, so the figure held for the requested model can understate what was billed.

A model policy declares whether the model can produce a reproducible answer at all. The claim is per model, like price, because the capability belongs to the model and not to its provider. Absent means no. The response cache needs both halves: the policy vouching for the model, and this particular request having actually turned reasoning off.

When a provider's usage shape cannot be parsed, record the set of field names the response carried, never a value. Names are not an error body, and they turn a failed first call into one correction instead of a blind retry.

`config/prices.json` is maintained by the operator, from their own browser, with a `verifiedAt` date. No agent transcribes a published price table into it. Independent readings of the DeepSeek page on the same day produced different numbers, and cached snapshots circulate as if official.

**The input counter is approximate.** The monetary ceiling blocks concurrency and refuses later calls, but it is a guard, not a proof of what the invoice will say. Treat it as a guard. This is why the first real call must be checked against the actual invoice before a second one is made.

## Safety locks

A key never reaches `localStorage`, `sessionStorage`, a URL, a log, or a response body. The only request that may carry one is the local credential configuration call.

A provider error body is never read, echoed, logged or returned. Adapters translate HTTP status into the shared `ProviderFailure` code vocabulary and nothing else crosses the boundary.

Status-to-code translation belongs to each adapter, not to a shared helper. A generic `upstreamCode` was written with one provider in hand and the second provider contradicted it: Gemini's 400 is an invalid key, DeepSeek's 400 is a malformed request of ours. The code set stays shared; the translation stays per adapter.

Losing contact with a provider is never evidence that nothing was billed. Codes that prove rejection before generation release the reservation cleanly. Timeouts and 5xx stay unresolved and are converted to conservative usage by reservation expiry.

Any validation that protects a key, a token budget or money decides on the server. A client-side check is presentation only.

Chain-of-thought output (`reasoning_content` and its equivalents) never enters a context envelope, an event, a preview or an artifact. It can echo the whole prompt back.

The RT-04 response cache only accepts an entry when thinking is explicitly disabled, and the thinking state is part of the payload hash. DeepSeek silently ignores `temperature` in thinking mode, so a `temperature = 0` payload is not evidence of a deterministic response.

The connection probe switches reasoning off wherever the wire protocol has an off switch, whatever the policy says, so it cannot spend its whole output budget thinking and come back empty. Where there is no off switch the policy stands: omitting the field hands the choice back to a costlier provider default. What each provider can express lives in one table, `lib/providers/thinking-policy.ts`, not in a literal inside an adapter.

RF-03 and RF-04 are out of scope. Do not start them.

## Reuse before reimplementing

Before writing new logic at any scale, look for an existing implementation and extend it. Search in proportion to the work: a quick look for something trivial, a real search before a subsystem.

The §5.4 detectors and the RF-07 handoff come from `lib/core`. They are pure, dependency-free and already tested. Do not reimplement them elsewhere.

## Comments

Brief, and only for what is not obvious from the code. Explain why, not how. One line where one line does.

## File and module names

Never `helpers`, `utils`, `common` or `misc`. Name a module after the domain concept it owns. `lib/utils.ts` is the existing violation: it re-exports `cn` under the `@/lib/utils` alias that `components.json` expects, and renaming it means changing the shadcn alias. It is the one known exception and it is waiting on a decision, not on a discovery.

## Commits

The agent does not commit. No `git add`, no `git commit`, no `git push`, and no offering to. Leave the tree dirty and report the diff. The operator commits, always. No stashing, no reverting, no merging, and no branches beyond the working branch you were told to create.

Do not search for a commit SHA to orient yourself. A hash depends on committer and timestamp, so yours legitimately differs from anyone else's.
