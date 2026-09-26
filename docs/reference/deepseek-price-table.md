# DeepSeek prices require operator verification

Read this before adding or changing a DeepSeek model or price entry.

The operator maintains `config/prices.json` from the current page in their own browser and records
`verifiedAt`. Independent readings and cached copies of the published table have disagreed, so an agent
must not transcribe a price or model identifier and the application must not fetch prices at runtime.
Do not simplify this to an automated or remembered value: leave an unverified model absent so preflight
fails closed until the operator supplies the auditable entry.

## Validity interval

Every model price may declare `expiresAt`, a strict `YYYY-MM-DD` calendar date using
the same validation as `effectiveAt`. When present, it must be later than `effectiveAt`.
The interval starts inclusively at `effectiveAt` and ends exclusively at `expiresAt`,
both at midnight UTC. A price valid through December 31 uses `expiresAt: "2027-01-01"`.
Omitting the field preserves the existing open-ended price behavior.

Before reserving or dispatching, the server requires the price to remain valid through
`requestAt + reservationTtlMs`: expiration at or before that instant refuses the request,
even when a response-cache entry exists. Price administration retains that preflight
guard. For work already dispatched, the operator approved reconciliation with the
captured tariff even after its expiry or closure by a successor; the newer tariff
never reprices that reservation. This explicitly supersedes the previous refusal
of every late response. An unpriced served model still stays unresolved. The
conservative expiry floor uses the captured candidates at the original request time;
see [price administration](price-validity-administration.md) for the version contract.
