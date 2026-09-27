# Operator protocol for real provider validation

Prepared from commit `0662647` on 2026-09-26 and updated on 2026-09-27 on
`night/provider-validation-ready` for served identities, receipts, the dispatch
ledger, the validation timeout and terminal DeepSeek entry. This is a procedure, not
evidence of a real call. No provider request, model discovery or price lookup was made to prepare
it. The operator runs the server and approves each paid step. Read
[First real call](reference/first-real-call.md),
[billing scopes](reference/billing-scope-and-price-key.md) and
[price validities](reference/price-validity-administration.md) first.

The first call against each provider must be compared with provider billing before
a second call. A green mock suite does not meet that condition. If billing is
delayed, aggregated beyond attribution, or disagrees, stop; do not retry to collect
more evidence. The current blockers and unverified cases are listed below.

## Operator inputs and preparation

Fill this locally. No credential belongs in this document or the results table.

| Input | Operator value / evidence |
| --- | --- |
| Provider: Gemini and/or DeepSeek; run separately | |
| Exact requested model ID (`R`) | |
| Exact possible served/billed IDs (`S`), from account/provider evidence | |
| Agent ID (`A`); session ID (`J`) from local snapshots | |
| Provider-confirmed usage/billing evidence source, including free-tier treatment | |
| Model policy: output cap (`O`), temperature, thinking support | |
| Four token limits and four USD limits; total approved validation spend | |
| Tariffs: source URL, verifiedAt, effectiveAt, optional expiresAt, UTC peak windows | |
| Both rate bands: input cache hit, input cache miss, output per million | |
| Whether feed is enabled; dispatch evidence comes from `dispatches` on `GET /api/provider` | |
| Approved timeout method (`SAINTPETRUS_VALIDATION_TIMEOUT_MS` value or an external impairment) and disposable-key rejection method | |

1. Operator: run the build on this branch before validation. Start only on
   `127.0.0.1` with `SAINTPETRUS_MODE=real` (the header must say REAL); disable preview. Enable `SAINTPETRUS_FEED=true` at startup
   if feed evidence is required. Enabling only its UI is insufficient. Do not
   restart once a possibly billed call is unresolved: counters and reservations
   are process-local. Use the policy's configured TTL, not a new timeout policy, and
   leave `SAINTPETRUS_VALIDATION_TIMEOUT_MS` unset except for V2.
2. Operator: put `R` and its provider/output/thinking policy in
   `config/token-policy.json` before startup. Keep `cacheTtlMs: 0`. Gemini currently
   requires a model supporting disabled thinking; the adapter cannot express an
   enabled thinking budget. Do not assume the local allowlist proves availability.
3. In **Tokens → Prices**, enter verified current tariffs for **`R` and every `S`**
   that can answer it. A served-only candidate needs a price but need not be
   allowlisted for requests. `R` is the key in the allowlist and its price entry;
   each `S` is a separate exact price key, not a display name. Gemini strips the
   `models/` prefix from requested and served IDs, and OpenAI usually answers with a
   dated snapshot of the alias; otherwise IDs must match exactly. No IDs or rates are supplied
   by this protocol. Include price-side provider metadata for every candidate.
4. Prices must be effective at dispatch; the requested price must remain valid
   through `dispatch + reservationTtlMs`. New validities close an open predecessor
   server-side; do not edit old values. Record current version IDs from
   `GET /api/prices`. Live Prices writes need no restart; allowlist edits do.
5. In **Tokens → Budgets**, set and record small limits for `global/all`, `agent/A`,
   `model/R`, `session/J`. Each must admit the one approved reservation. These are
   four views of the same consumption, not four independent spending allowances.
   Do not select models with unsupported context tiers or cache-write charges;
   see [deferred dimensions](reference/deferred-price-dimensions.md).
6. Keep **Remember key** unchecked. **Connect and verify (1 call)** stores the key
   and immediately dispatches the probe: budgets, evidence collection and approval
   must already be ready. Do not then click **Test again** as a setup step. The
   password field and local `/api/credentials` POST transiently carry the key;
   `/api/provider` requests never should. Never export that credential request.
7. Alternative: hidden interactive `npm run key -- set gemini` or
   `npm run key -- set deepseek`, with non-secret provider/model selection configured
   at server startup (`SAINTPETRUS_PROVIDER`, `SAINTPETRUS_MODEL`) and matching
   `PORT`. Do not use `--remember`, argv, an environment variable or a file for the
   key; extra arguments are refused. This only configures the credential; the probe
   is a separate action. Verify `GET /api/credentials` reports `remembered: false`
   without returning a key.

## Code path and observable evidence

| Stage / owner | What happens | Operator evidence |
| --- | --- | --- |
| Local selection: `lib/providers/runtime.ts` | Validates provider and normalized allowlisted `R` for a UI selection; a terminal or startup selection is checked against the allowlist by `TokenService`, still before I/O; constructs adapter | Local `GET /api/provider`, credential-free execution body; configured is not verified |
| Preflight: `TokenService.execute` in `lib/tokens/service.ts` | Checks pause, policy, active captured tariffs and four token/USD ceilings | Local 409 on refusal; `budget.refused`; row/paused snapshots. `dispatches` on `GET /api/provider` stays unchanged: the server-side proof of no upstream call |
| Reservation: same service | Synchronous holds in all four rows before `ProviderProxy.execute` | `/api/tokens`: `reserved`, `costReservedUsd`; a fast call may finish before observation. Inflight IDs are omitted |
| I/O: `lib/providers/proxy.ts`, provider adapter | One active request, 15-second proxy timeout; fixed endpoint, no redirects, bounded response | Connection latency/status; local API result. Browser network shows local requests, not the server's provider transport |
| Reconciliation: service + captured `PriceCatalog` | Parses usage, prices served ID, releases holds, adds actual totals/cost; journals interval before row changes | Response `usage`, `billingModel`; four row deltas; catalog versions; a `call` receipt on `GET /api/receipts` with reserved figures, dispatch, reported usage, band, cost and journal interval |
| Unverifiable: service `finally` | Holds tokens/USD, pauses `A`, sets deadline to failure time + TTL | Reservation ID, `priceVersionId`, `status`, `createdAt`, `expiresAt`; row `unverifiable` |
| Expiry: `expireReservations` | Converts hold into conservative usage; never refunds uncertain consumption | A GET snapshot or receipts read after deadline triggers conversion and appends an `expiry` receipt. There is no independent timer; UI polls snapshots |
| Manual reconciliation | Replaces an expired estimate using provider-confirmed tokens and cost | Same four row deltas; estimate/reservation removed, then explicit resume. Appends a `manual` receipt with the replaced estimate and journal interval |
| Feed / export | Redacted circular SSE window / redacted graph snapshot | `/api/events` when enabled, `/api/graph/export`; neither is a complete billing ledger |

Save before/after `/api/tokens`, `/api/prices`, `/api/provider`, `/api/receipts`,
graph export and only the relevant local execution response. GETs to these **local** endpoints do
not call the provider. Local POSTs require the exact loopback Origin and JSON
content type; do not weaken that check. Requests to `/api/provider` contain only
`action`, optionally `input` and `agentId`; never a key, model override or URL.
The probe body is `{"action":"test"}` and uses the first graph agent. For an
explicit `A`, use the supported `agentId` field on the same local route.

## Cost worksheet: peak and 100% cache miss

For call `i`, let `I_i` be the core heuristic count of the **sanitized serialized**
`{systemPrompt, messages}` constructed by `TokenService.execute`, and `O_i` the
policy maximum output. For a probe, messages contains one user `Reply OK.` and
systemPrompt is the chosen agent's context summary. Use
`heuristicTokenCounter.count(JSON.stringify({systemPrompt, messages}))` from
`lib/core/token-estimate.ts` offline on non-secret context to reproduce the hold.
The response's `preflight.tokens` counts only the input string and is **not** `I_i`.

With `ceil12(x) = ceil(x × 10^12) / 10^12`, the requested-model preflight is:

```text
T_i = I_i + O_i
B_i = ceil12((I_i × R.peak.inputCacheMissPerMillion
              + O_i × R.peak.outputPerMillion) / 1,000,000)
refuse first if, in any of the four rows:
  used + reserved >= token limit, or
  costAccountedUsd + costReservedUsd >= USD limit
then admit only if, in each of the four rows:
  used + reserved + T_i <= token limit
  costAccountedUsd + costReservedUsd + B_i <= USD limit
```

The first check means a row already at its limit refuses even a zero-cost
reservation. This is the maximum **reservation at the estimated input**, not a guaranteed
invoice maximum: input is approximate and an unanticipated served price may be
dearer. For scenario planning calculate `W_i`, the maximum of the same peak/miss
formula over every active captured candidate, restricted to the validated provider
only if **all** usable candidates have known provider metadata. Otherwise use all
providers. The conservative expiry charge is `E_i = max(B_i, W_i)`.

For a parsed response, let `H/M` be reported cached/uncached input and `C` billed
completion. `H + M = prompt`. Use the captured tariff of `S` and the band touched
by the server's dispatch-to-response interval (peak if any overlap):

```text
D_i = ceil12((H × band.inputCacheHitPerMillion
              + M × band.inputCacheMissPerMillion
              + C × band.outputPerMillion) / 1,000,000)
```

Compare API numbers to 12 decimal places, allowing final floating-point rounding;
the UI prints nine. All four affected rows add the **same** actual tokens and
`D_i`, release `T_i/B_i`, and leave mock totals unchanged. `model/R` changes even
when `S != R`; do not expect a `model/S` budget row to be charged. Do not add the
four costs together. Compare the provider invoice separately, including account
credits/free tier and rounding; a locally priced usage result is not an invoice.

## Served identity and usage contracts

- **DeepSeek:** `response.model` becomes `billingModel`. Register `R` plus each
  possible canonical `response.model` as a price key **before dispatch**.
- **OpenAI:** `response.model`, or `response.model` inside the streamed
  `response.completed` event, becomes `billingModel`. It is usually a dated snapshot
  of the requested alias, so register that snapshot's price too; a missing identity
  fails closed with field names only. Usage is strict: `input_tokens → prompt`,
  `output_tokens → completion`, `total_tokens → total`, which must add up; a reported
  `output_tokens_details.reasoning_tokens` is returned alone as `usage.reasoning`. The
  cache split is not read, so every input token is priced at the miss band. Any other
  shape fails closed with field names only.
- **Any provider, unpriced `S`:** if the served model is absent from the captured
  catalog, the local response is 409 with `error: served_model_unpriced`,
  `requestedModel`, `servedModel` and `reservationId`. Actual totals stay
  unchanged, both holds remain, the agent pauses and the feed gets
  `provider.unpriced`; the reservation shows its `servedModel`. The requested
  tariff is never used and nothing is released. Later adding `S` does not
  retrofit that reservation. At expiry it converts at the larger of the estimate
  and the reported usage in each dimension, at least at the requested model's peak,
  cache-miss rate, and the agent stays paused until provider-confirmed manual
  reconciliation. `provider.rerouted` only records the divergence; it makes no
  reconciliation claim.
- **Gemini:** `promptTokenCount → prompt`;
  `candidatesTokenCount + thoughtsTokenCount → completion`;
  `totalTokenCount → total`. Thoughts are therefore charged at the output rate, and a reported
  `thoughtsTokenCount` is also returned alone as `usage.reasoning`.
  Cached input is already inside prompt; `cachedContentTokenCount` splits hit/miss
  and is not added again. Missing candidates/thoughts/cache fields default to zero,
  which stays safe: a missing output count breaks the total check, and a missing
  cache split prices every input token at the dearer miss band. Missing
  prompt/total, inconsistent totals or nonzero tool usage fail and publish
  `provider.usage_unparsed` with field names only.
  **Served identity:** `modelVersion`, normalized without its `models/` prefix,
  becomes `billingModel` and the price key, as `response.model` does for DeepSeek.
  Register `R` and every possible served ID before dispatch. A missing or
  malformed `modelVersion` fails closed as unverifiable and publishes
  `provider.usage_unparsed` with field names only.
- **DeepSeek usage:** `prompt_tokens`, `completion_tokens`, `total_tokens` must
  agree; cache hit + miss must equal prompt. Optional cached detail must equal
  cache hits. Reasoning detail, when present, must not exceed completion; it is
  already included in completion and must **not** be added twice; it is returned
  alone as `usage.reasoning`, a count only. Raw reasoning
  text is discarded. Unknown usage retains the hold and may emit field names only.
- A probe disables thinking where supported. A zero reasoning/cache count does
  not prove a nonzero real response case. Do not enable thinking or add calls to
  manufacture coverage without a separate spending decision. Gemini cannot enable
  thinking through its current policy. Synthetic coverage is not live evidence.

## Minimum sequence, with stops between paid steps

Run one provider and one agent at a time, without other workloads using the same
account. Fill `I_i`, `O_i`, rates, `B_i`, `W_i` and totals **before** approving each
attempt. The minimum path is three upstream attempts per provider, conditional on
the evidence/methods below being available. No retry is part of the sequence.

| Step | Action | Preflight / cost plan | Expected accounting in each of the four scopes |
| --- | --- | --- | --- |
| L0: local refusal, optional before first paid call | Configure while a zero budget prevents the UI's automatic probe; observe local 409 | Zero provider calls; hypothetical `B_0` uses peak/miss formula but no hold is created | Actual, held and accounted unchanged; agent paused. Configure approved small limits and explicitly resume before V1 |
| V1: one success | Exactly one probe, `Reply OK.`, no tools | `T_1`, `B_1`; plan possible reroute exposure `E_1` too | Held `T_1/B_1` then released; actual += reported usage; accounted += `D_1`; cached=false, mocked=false. STOP for invoice comparison |
| L1: warning and hard-stop checks | Local limit changes and refused probes described below | No extra provider calls, no additional holds | Same usage/cost; warning/stopped presentation, refusals and pauses |
| V2: one forced timeout | Same minimum probe with approved server-egress response delay | `T_2`, `B_2`; eventual conservative charge `E_2` | After timeout: held amounts remain, unverifiable +=1. After TTL: holds zero, used/estimated +=`T_2`, accounted/unmeasured +=`E_2`; no actual increment |
| V3: one genuine provider rejection | After resolving V2, provider-side restrict/revoke the disposable validation credential, then attempt the same probe with it still in memory | `T_3`, `B_3` before I/O, planned exposure `E_3`; a proven rejection releases holds | Expected unauthorized rejection: actual/cost unchanged, no unresolved hold, credential rejected. Unexpected 5xx/timeout instead follows V2; stop |

Numeric sequence total is **not filled** until the operator supplies tariffs and
caps. Sum of admitted preflight reservations: `B_1 + B_2 + B_3`; conservative
planning envelope: `E_1 + E_2 + E_3`. Neither bounds unknown invoice behavior.
Expected accounted total before confirming V2 is `D_1 + E_2 + 0`; after replacing
its estimate it is `D_1 + providerConfirmedCost_2 + 0`. Expected actual tokens then
equal `usage_1 + providerConfirmedUsage_2`, in each of the same four rows. Across
providers, global/session include both runs, model/agent depend on chosen IDs;
record deltas per run. Approve the numerical total, not merely each individual cap.

### V1: evidence before a second provider attempt

Capture baseline rows and catalog. Connect once (or use the terminal-configured
probe once). Retain only the local execution response and subsequent row snapshot.
Compare prompt/completion/total, input split and served identity to request-specific
provider evidence; recompute `D_1` and the four deltas. Check badge and latency,
feed `agent.message` tokens, and secret-free graph export. Expect any tariff
validity chosen at dispatch to remain in force for this reservation.

Raw upstream JSON is not exposed in the browser; internal usage alone cannot prove
the wire mapping. Compare the `call` receipt's `reportedUsage` (prompt, completion,
cache split, reasoning) with provider-confirmed records; the receipt proves only what
the adapter parsed. Do not enable HTTP-body/header debug logging. If an empty
reply, unknown usage, unpriced served ID, invoice discrepancy, or missing evidence
occurs, stop without a second attempt. Record that criterion as blocked, not passed.

### L1: 80% and 100%, without buying extra output

After V1 has reconciled and been checked, retain its positive token usage `U` and
accounted cost `D`. Temporarily use **Tokens** to set one row's token limit to
`floor(U / 0.8)` when that value exceeds `U`; verify `warning`. Restore the approved
limit. Repeat independently for all four scopes. With `D > 0`, a USD limit between
`D` and `D / 0.8` gives the USD warning. If either amount is zero/too small for that
construction, mark that observation unavailable; do not spend to inflate it.

For each scope independently, with all other limits restored and the agent
resumed, set its token limit to exactly `U`; snapshot must show `stopped`. Attempt
one same probe: local 409 before provider I/O, unchanged accounting, `budget.refused`
and agent pause. Restore and resume before the next scope. Repeat with its USD
limit at exactly `D`. A zero limit is also a local refusal but does not prove the
positive 80% transition. Local cap changes do not themselves pause the graph until
an execution checks it, and do not emit `budget.warning`.

The UI warning can be verified this way; the **warning event** is emitted only
after a reconciled call is at or above 80%. Record it if V1 naturally crosses the
threshold. Otherwise live event coverage remains unverified; obtaining it would
require a separately approved call, not an automatic retry. The existing tests
cover that event. For hard stops, pair the local 409 with the `dispatches`
snapshot from `GET /api/provider` before and after: `total` and the provider's
count must not change. Browser DevTools alone does not prove zero backend I/O.

### V2: timeout, expiry and manual reconciliation

Force the timeout with `SAINTPETRUS_VALIDATION_TIMEOUT_MS`, an integer from 1 to
14999 read once at server startup (shell or `.env.local`); an invalid value stops
the server from starting. The header then shows `⏱ Validation timeout`, and
`GET /api/provider` reports `validationTimeoutMs`. It shortens only the proxy's
timeout: preflight and all four budgets still run first, and no request body can set
or change it. The dispatch ledger records the request before the abort, so the
provider may still process and bill it; a value too small can abort before the
request reaches the provider, which stays unverifiable all the same. The operator
chooses a value below the model's usual latency. Because V1 must run with the
normal timeout, restart with the flag only after V1 is reconciled, compared and its
snapshots and receipts saved; then do not restart again until V2's reservation has
expired and been reconciled, and restart without the flag before V3. An approved
external network impairment remains an alternative. Cancelling locally tests
`cancelled`, not `timeout`.

Expect local 504 with `error: timeout`, a generic error event, paused agent and an
`unverifiable` reservation. A connection error/5xx is a different case; do not label
it a forced timeout. Before expiry verify that holds remain in all four rows and
resume is refused. Save reservation ID and captured price version. After its
`expiresAt`, read `/api/tokens`: holds convert to `estimated`, with `used += T_2`,
`costAccountedUsd += E_2`, `costUnmeasuredUsd += E_2`, `unverifiable` decremented.
No actual usage is fabricated. The pause remains until explicit resume.

Use **Apply confirmed usage** only with provider-confirmed prompt, completion and
cost. Verify it replaces the estimate, does not add another full charge, removes
the reservation, and updates all four rows. If confirmation is unavailable, retain
the estimate and stop; do not guess zero, restart to erase it or proceed to V3.
Adding tariffs after dispatch does not change the captured expiry candidates.

### V3: real error, and a naturally occurring 429

Prefer a disposable validation credential restricted or revoked **by the operator
in the provider account**, after V1/V2, while its original value remains configured
in backend memory. This makes the configured real endpoint return an authentication
error without inventing a model/price or weakening local validation. The operator
must approve that credential action and confirm no other workload depends on it.
If it is unsuitable, leave V3 blocked; an invalid local model/payload is refused
before transport and does not test real provider errors.

Expect a fixed local error code (e.g. unauthorized/401), no provider error body,
no credential or recognizable fragment in the response/feed/logs, and released
reservations for a proven unbilled rejection. An unexpected response is a recorded
divergence, not permission to try again. Both adapters map upstream 429 to local
429/rate_limited, release the proven rejected hold and leave the verification verdict
unchanged. If 429 happens naturally during an approved step, record that substitution
and stop; never send bursts to induce it. Not observed means not verified.

## Secret checks and retained evidence

- Inspect browser storage for the application origin: no key in localStorage,
  sessionStorage, cookies or other persisted application storage. Leave password
  saving/autofill disabled for this field. No screenshots while a key is visible.
- Inspect only `/api/provider` request/response and local token/catalog responses.
  Do not export a HAR, credential configuration body, clipboard contents or an
  authenticated provider request. A full network export can contain the key even
  though execution requests do not. Disconnect at the end; confirm configured
  credential status becomes disconnected.
- Export context with `/api/graph/export`. Collect feed events if enabled and
  ordinary server logs; no verbose transport logging. The feed sanitizes before
  storage. Graph export is not a token ledger; retain token snapshots separately.
- Keep candidate evidence local and unshared. Run, with the installed scanner,
  `gitleaks dir /ABSOLUTE/PATH/TO/VALIDATION-EVIDENCE --no-banner --redact=100`.
  Report file/location/count only, never a match value. Do not apply project build
  exclusions to the evidence directory or claim the scan finds arbitrary fragments.
- Gitleaks and format matching are not proof that **every** fragment is absent.
  Configured-key redaction covers full values and recognizable 12+ character
  fragments; shorter fragments are a documented limit. A stronger check needs an
  approved ephemeral comparator with hidden input, match counts only, no key in
  argv/files/logs and no printed matches (G9). No such tool is implemented here.
- Record raw-format divergences only from an approved metadata-only source. A
  regression fixture may retain numeric usage, finish reason and served identity,
  never credentials, headers, prompt, reasoning or account identifiers. Review and
  scan before sharing. This mission does not create fixtures from unexecuted calls.

## Gaps: resolved and still open

| ID | Verified limitation | Minimum proposal / decision |
| --- | --- | --- |
| G1 | Resolved: Gemini prices the normalized `modelVersion`; a missing or malformed identity fails closed | Register every possible served ID with its price before dispatch; an unpriced served ID stays unverifiable |
| G2 | Resolved: `GET /api/receipts` serves a bounded (200), newest-first journal of `call`, `cache`, `expiry` and `manual` receipts: requested and served model, captured price versions, reservation figures (`inputTokens` is the reservation input, unlike the proxy's `preflight.tokens`), dispatch, reported usage with cache split and reasoning, band, cost, verdict, outcome and the persisted journal interval. Numbers, identities and codes only | Process-local; eviction is reported, not hidden. Raw provider JSON is still never kept, so the wire mapping needs provider-side evidence |
| G3 | Resolved: `GET /api/provider` returns `dispatches` (`total`, `byProvider`, the latest 50 with `sequence`, `provider`, `model`, `correlationId` = reservation ID, `at`), recorded by the proxy immediately before transport, never for a local refusal or cache hit | Process-local; restart clears it. It counts requests that left, not what the provider billed |
| G4 | Resolved: startup-only `SAINTPETRUS_VALIDATION_TIMEOUT_MS` (1–14999 ms) shortens the proxy timeout, is visible in the header and status, and never bypasses preflight or budgets | A local abort does not prove the provider received the request; pair it with the dispatch ledger and provider billing |
| G5 | Feed tokens are message totals: omit billed output-limit responses, expiry/manual adjustments. The reroute text no longer claims reconciliation, and an unpriced served model has its own `provider.unpriced` event | Keep feed as activity evidence; per-call accounting evidence belongs to receipts (G2) |
| G6 | Partly resolved: per-call accounting evidence is in `GET /api/receipts` (G2). The graph export still omits the budget rows, inflight reservations and captured tariffs | Save `/api/tokens`, `/api/prices` and `/api/receipts` snapshots next to the graph export; a combined accounting export stays a proposal |
| G7 | Resolved: the terminal helper accepts `deepseek` under the same rules as the other providers, and a test pins its provider list to the backend credential store | None |
| G8 | Zero live cached/thinking tokens cannot establish nonzero cases. The names-only diagnostic now covers Gemini usage failures and a missing usage object in both adapters | Obtain numeric provider evidence, or explicitly leave nonzero cases unverified. Do not manufacture billable coverage |
| G9 | No safe arbitrary-key/fragment comparator for exported artifacts; short fragments not generally identifiable | Approve an ephemeral, nonlogging comparator and an explicit fragment criterion; Gitleaks alone is insufficient |
| G10 | Counters, holds, receipts and the dispatch ledger vanish on restart; input approximate; price-only reroutes beyond known candidates and unsupported price dimensions can exceed estimates | Preserve process/evidence during the run, select only supported pricing, approve residual exposure; durable receipts/accurate counting need a separate task |
| G11 | Resolved: a probe answered without visible text returns 422 `empty_output`, keeps its billed usage and leaves the connection `incomplete` ("No visible output"), like an output-limit result | Still require visible output during manual validation |

## Results record

For each row, record PASS, FAIL, BLOCKED or NOT OBSERVED with the evidence location.
No entry is pre-marked passed. Repeat per provider, preserving the process/session.

| Check | Provider / R / S / A / J | UTC start/end, price version | Planned T/B/E; observed usage/cache/thoughts | Four-scope delta / provider billing | Evidence and outcome |
| --- | --- | --- | --- | --- | --- |
| Preparation, memory-only credential, approved total | | | | | |
| V1 success and invoice comparison before second call | | | | | |
| L1 token 80% / 100% in each scope | | | | | |
| L1 USD 80% / 100% in each scope; zero dispatch | | | | | |
| Warning event (observed or unverified) | | | | | |
| V2 timeout → unverifiable → conservative expiry | | | | | |
| V2 confirmed manual replacement and explicit resume | | | | | |
| V3 genuine provider error, no credential fragments | | | | | |
| 429 (natural only) | | | | | |
| Cache/thoughts nonzero wire mapping (or unverified) | | | | | |
| Export, feed, logs, storage and redacted scanner results | | | | | |
| Disconnection, divergence and proposed regression fixture | | | | | |

Before the **first** real call, the operator must decide: provider/R/S and verified
rates; output cap and the numerical four-scope/sequence budget; whether the remaining
gaps block the chosen provider; evidence and fragment-check methods; feed enablement; the safe
timeout and disposable-key error procedures. Nothing in this protocol authorizes an
agent call. A step with unresolved evidence stays blocked, even if its mock passes.

## README

The README was rewritten to match the code: provider scope, live price administration, the event stream,
Connect and verify, the streaming preview path, served-model price keys, the expiry floor and the disabled
response cache. Historical model and rate examples, here and in `docs/reference/first-real-call.md`, are not
current operator verification and must not be reused as validation inputs: the operator-verified catalog is
the authority.
