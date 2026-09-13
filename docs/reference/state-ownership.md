# State ownership

Each authoritative state has one server owner. A reader may keep only transient presentation state and must not add precedence, reorder records, infer missing truth or maintain a competing contract.

- `GraphService` owns the graph. `useProjection` is a mirror, and its revision guard is the only ordering arbiter. A client response or stream event must pass the graph contract before reaching that guard; a stale command receives the current projection rather than its rejected snapshot.
- The provider runtime owns the selected provider/model pair, verification proof and connection status. Credential presence means configured; only a successful uncached connection test with usable output means verified. The connection panel renders the complete server snapshot. Polling joins an explicit refresh instead of cancelling it, while an explicit refresh may retire stale polling.
- `TokenService` owns counters, reservations and token-budget pause transitions. An API reader applies only the exact transition IDs returned by that owner, and the graph uses compare-and-set so a later status cannot be overwritten.
- `EventBus` sanitizes, identifies, orders and retains events before publication. Feeds render the server window as delivered; filtering and visual direction are presentation only.

Form drafts, feed filters and in-progress drag positions are presentation state. They may live in the client while they remain outside authoritative snapshots and never resolve a disagreement between server states.
