# Expired unresolved reservations become conservative usage

Read this before changing unresolved reservation expiry or reconciliation.

An `unverifiable` reservation means provider contact was lost after the request may have been accepted
and billed. Releasing or zeroing it would immediately free every budget scope for concurrent calls. At
expiry, convert it to estimated usage and charge the greater of the held amount and the
dearest known model at peak rates with 100% cache miss; the served model is unknown. Use the
reservation's validated provider only when every price candidate usable at the original request time
has provider metadata; otherwise retain the global floor. Price metadata, not the request allowlist,
defines these candidates because providers can reroute to models absent from that allowlist. Keep
the charge in all four original budget scopes; see [the pricing decision](billing-scope-and-price-key.md)
for the accepted loss of coincidental headroom from unrelated providers. Do not simplify
this to ordinary release: only a failure that proves no generation occurred is `unbilled`, and later
reconciliation must replace the same converted amount rather than charge it twice.
