# Expired unresolved reservations become conservative usage

Read this before changing unresolved reservation expiry or reconciliation.

An `unverifiable` reservation means provider contact was lost after the request may have been accepted
and billed. Releasing or zeroing it would immediately free every budget scope for concurrent calls. At
expiry, convert it to estimated usage and charge the greater of the held amount and the
dearest known model at peak rates with 100% cache miss; the served model is unknown. Do not simplify
this to ordinary release: only a failure that proves no generation occurred is `unbilled`, and later
reconciliation must replace the same converted amount rather than charge it twice.
