# Operator protocol for real provider validation

Prepared from commit `0662647` on 2026-09-26. This is a procedure, not evidence of a
real call. No provider request, model discovery or price lookup was made to prepare
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
| Whether feed is enabled; method for observing upstream dispatch without payloads | |
| Approved timeout method and disposable-key rejection method | |

1. Operator: run the build on this branch before validation. Start only on
   `127.0.0.1`; disable mock and preview. Enable `SAINTPETRUS_FEED=true` at startup
   if feed evidence is required. Enabling only its UI is insufficient. Do not
   restart once a possibly billed call is unresolved: counters and reservations
   are process-local. Use the policy's configured TTL, not a new timeout policy.
2. Operator: put `R` and its provider/output/thinking policy in
   `config/token-policy.json` before startup. Keep `cacheTtlMs: 0`. Gemini currently
   requires a model supporting disabled thinking; the adapter cannot express an
   enabled thinking budget. Do not assume the local allowlist proves availability.
3. In **Tokens → Prices**, enter verified current tariffs for **`R` and every `S`**
   that can answer it. A served-only candidate needs a price but need not be
   allowlisted for requests. `R` is the key in the allowlist and its price entry;
   each `S` is a separate exact price key, not a display name. Gemini strips the
   `models/` prefix; otherwise IDs must match exactly. No IDs or rates are supplied
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
7. Alternative for Gemini: hidden interactive `npm run key -- set gemini`, with
   non-secret provider/model selection configured at server startup and matching
   `PORT`. Do not use `--remember`, argv, an environment variable or a file for the
   key. This only configures the credential; the probe is a separate action.
   The current terminal script **does not support DeepSeek**; use its UI. Verify
   `GET /api/credentials` reports `remembered: false` without returning a key.

## Code path and observable evidence

| Stage / owner | What happens | Operator evidence |
| --- | --- | --- |
| Local selection: `lib/providers/runtime.ts` | Validates provider and normalized allowlisted `R`; constructs adapter | Local `GET /api/provider`, credential-free execution body; configured is not verified |
| Preflight: `TokenService.execute` in `lib/tokens/service.ts` | Checks pause, policy, active captured tariffs and four token/USD ceilings | Local 409 on refusal; `budget.refused`; row/paused snapshots. `dispatches` on `GET /api/provider` stays unchanged: the server-side proof of no upstream call |
| Reservation: same service | Synchronous holds in all four rows before `ProviderProxy.execute` | `/api/tokens`: `reserved`, `costReservedUsd`; a fast call may finish before observation. Inflight IDs are omitted |
| I/O: `lib/providers/proxy.ts`, provider adapter | One active request, 15-second proxy timeout; fixed endpoint, no redirects, bounded response | Connection latency/status; local API result. Browser network shows local requests, not the server's provider transport |
| Reconciliation: service + captured `PriceCatalog` | Parses usage, prices served ID, releases holds, adds actual totals/cost; journals interval before row changes | Response `usage`, `billingModel`; four row deltas; catalog versions; a `call` receipt on `GET /api/receipts` with reserved figures, dispatch, reported usage, band, cost and journal interval |
| Unverifiable: service `finally` | Holds tokens/USD, pauses `A`, sets deadline to failure time + TTL | Reservation ID, `priceVersionId`, `status`, `createdAt`, `expiresAt`; row `unverifiable` |
| Expiry: `expireReservations` | Converts hold into conservative usage; never refunds uncertain consumption | A GET snapshot or receipts read after deadline triggers conversion and appends an `expiry` receipt. There is no independent timer; UI polls snapshots |
| Manual reconciliation | Replaces an expired estimate using provider-confirmed tokens and cost | Same four row deltas; estimate/reservation removed, then explicit resume. Appends a `manual` receipt with the replaced estimate and journal interval |
| Feed / export | Redacted circular SSE window / redacted graph snapshot | `/api/events` when enabled, `/api/graph/export`; neither is a complete billing ledger |

Save before/after `/api/tokens`, `/api/prices`, `/api/provider`, graph export and
only the relevant local execution response. GETs to these **local** endpoints do
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
admit only if, in each of the four rows:
  used + reserved + T_i <= token limit
  costAccountedUsd + costReservedUsd + B_i <= USD limit
```

This is the maximum **reservation at the estimated input**, not a guaranteed
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
- **Any provider, unpriced `S`:** if the served model is absent from the captured
  catalog, the local response is 409 with `error: served_model_unpriced`,
  `requestedModel`, `servedModel` and `reservationId`. Actual totals stay
  unchanged, both holds remain, the agent pauses and the feed gets
  `provider.unpriced`; the reservation shows its `servedModel`. The requested
  tariff is never used and nothing is released. Later adding `S` does not
  retrofit that reservation. After expiry use provider-confirmed manual
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

No existing UI/runtime flag forces a provider timeout. Approve an operator-owned,
disposable, process-scoped network impairment that allows the request out but
delays the response beyond 15 seconds, preserves TLS and records no payloads or
headers; restore it immediately afterwards. Do not change endpoints, install a TLS
interceptor, edit proxy code or throttle browser-to-localhost traffic as a substitute.
If such a method is unavailable, V2 is **not verified**, not a simulated success.
Cancelling locally tests `cancelled`, not `timeout`.

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

## Gaps and minimum proposed changes (not implemented)

| ID | Verified limitation | Minimum proposal / decision |
| --- | --- | --- |
| G1 | Resolved: Gemini prices the normalized `modelVersion`; a missing or malformed identity fails closed | Register every possible served ID with its price before dispatch; an unpriced served ID stays unverifiable |
| G2 | Resolved: `GET /api/receipts` serves a bounded (200), newest-first journal of `call`, `cache`, `expiry` and `manual` receipts: requested and served model, captured price versions, reservation figures (`inputTokens` is the reservation input, unlike the proxy's `preflight.tokens`), dispatch, reported usage with cache split and reasoning, band, cost, verdict, outcome and the persisted journal interval. Numbers, identities and codes only | Process-local; eviction is reported, not hidden. Raw provider JSON is still never kept, so the wire mapping needs provider-side evidence |
| G3 | Resolved: `GET /api/provider` returns `dispatches` (`total`, `byProvider`, the latest 50 with `sequence`, `provider`, `model`, `correlationId` = reservation ID, `at`), recorded by the proxy immediately before transport, never for a local refusal or cache hit | Process-local; restart clears it. It counts requests that left, not what the provider billed |
| G4 | No controllable upstream timeout in live configuration | Operator decides safe external impairment; otherwise leave live timeout unverified. Any future runtime control must be explicit and separately reviewed |
| G5 | Feed tokens are message totals: omit billed output-limit responses, expiry/manual adjustments. The reroute text no longer claims reconciliation, and an unpriced served model has its own `provider.unpriced` event | Keep feed as activity evidence; per-call accounting evidence belongs to receipts (G2) |
| G6 | Token/price receipt export absent; graph export omits ledger, inflight reservations and captures | Propose sanitized accounting export carrying four scopes and captured tariff identities; save local snapshots meanwhile |
| G7 | DeepSeek is absent from terminal helper's provider list | Use UI now; separately add its ID to the existing validated CLI contract with a regression test |
| G8 | Zero live cached/thinking tokens cannot establish nonzero cases. The names-only diagnostic now covers Gemini usage failures and a missing usage object in both adapters | Obtain numeric provider evidence, or explicitly leave nonzero cases unverified. Do not manufacture billable coverage |
| G9 | No safe arbitrary-key/fragment comparator for exported artifacts; short fragments not generally identifiable | Approve an ephemeral, nonlogging comparator and an explicit fragment criterion; Gitleaks alone is insufficient |
| G10 | Counters/holds vanish on restart; input approximate; price-only reroutes beyond known candidates and unsupported price dimensions can exceed estimates | Preserve process/evidence during the run, select only supported pricing, approve residual exposure; durable receipts/accurate counting need a separate task |
| G11 | Empty text without an output-limit finish reason can still mark a probe verified | Require visible output during manual validation; separately enforce that requirement without dropping billed usage |

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

## README discrepancies (listed only; README unchanged)

- Opening scope omits Gemini/DeepSeek and live Prices administration.
- Manual graph says polling; graph snapshots now use SSE.
- Credentials says Connect stores without testing; the button now verifies once.
- Proxy says streaming is unimplemented despite the optional OpenAI preview path.
- Token controls describe initial file/restart administration and OpenAI usage
  fields without the provider-specific contracts or captured tariff versions.
- Expiry wording implies only the original hold, omitting the larger eligible
  floor; cache wording omits explicit determinism/thinking requirements and hash.
- Historical model/rate examples are not current operator verification. Do not
  reuse them as validation inputs. First-real-call reference also has historical
  schedule examples: current operator-verified catalog is the authority.
