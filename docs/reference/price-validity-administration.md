# Price validities preserve the accounting ruler

Read this before changing price administration, version selection or captured tariffs.

Reservations capture tariff values as well as version identities because closing a validity later must not change the ruler used to reconcile work already dispatched. Do not simplify this to a lookup of the current price. Capture every tariff usable at dispatch, including price-only reroute candidates, and price the served model from that capture. Keep the requested model's four budget scopes and the provider-aware conservative expiry floor, including the original-hold minimum. A served model unpriced at dispatch remains unverifiable even if a price is added before its response. Peak-window and cache-split accounting still apply within the captured tariff.

`config/prices.json` remains the sole price source. Initial records stay in `models`;
successors append to `versions[model]`. Identity is the model/effective-date pair.
Dates are strict calendar dates at midnight UTC, with inclusive start and exclusive
end. The server may fill only an open predecessor's `expiresAt`, exactly from the
successor's `effectiveAt`; it preserves every other field, including verification,
source and rates. Finite overlaps and duplicate starts are refused. Nothing deletes
historical tariffs; closing the UI history only hides it.

New records require provider metadata, `verifiedAt`, `sourceUrl`, valid bands and
UTC windows. Legacy metadata is not invented. The local endpoint accepts matching-
origin browser JSON for prices without changing credential-route protections.
The UI has only form drafts; the server selects current prices and orders history.
Safe server validation errors are displayed verbatim as text. Prices do not grant
model authorization: the policy allowlist remains separate.

Before actual or manual reconciliation changes counters, the catalog records the
requested and known served model's protected time interval in `reconciled`. An
append is refused if either its new interval or its predecessor closure intersects
that history. This journal begins with this feature; it cannot reconstruct older
process-local consumption. It survives restart, although counters and inflight
reservations remain process-local. File writes use an exclusive temporary file,
fsync and atomic rename; failure leaves the previous file and memory unchanged.
Use the local endpoint for live updates; out-of-band edits are not hot-reloaded.

The existing preflight `reservationTtlMs` validity guard still refuses new calls
near a known expiry. For an already-captured reservation, the operator explicitly
chose its original tariff even after a successor closes it or the response arrives
after expiry. That exception does not relax preflight or choose a successor price.
