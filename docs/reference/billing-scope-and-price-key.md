# Budget scope and price key point at different models

Read this before changing how `TokenService.execute` picks a price or a budget row.

A call has two model identities. The **requested** model is the string the policy allowlisted and the
selection sent. The **served** model is the `model` field the provider puts in its response, which is
what the invoice will name. From 2026-09-14 DeepSeek serves and bills every `deepseek-v4-pro` request
as Flash, so the two identities differ on ordinary traffic, not just in edge cases.

The budget rows are keyed by the **requested** model. The price is taken from the **served** model.
That asymmetry looks like an oversight and is not one.

The reservation is taken before any provider I/O, when only the requested model is known. It is held
across four scopes at once, and the `model` scope row is one of them. Moving the reservation to the
served model at reconciliation would mean releasing a hold in one row and charging another row that
never authorized the call: the concurrency guarantee the four-scope reservation exists to provide
would be gone, because a second call could pass its preflight against a row that is about to be
charged for a call it never saw. Pricing, unlike reservation, happens after the answer arrives, when
the served model is known and is the only honest answer to "what will this cost".

Two consequences follow, and both are deliberate:

- A served model with no operator-verified price cannot be reconciled. The call already happened, so
  it is not released as free. The reservation stays unresolved, the agent pauses, and the reservation
  expiry converts it to conservative usage.
- An expired reservation does not convert at the figure that was held. It converts at the greater of
  the held figure and the dearest eligible price candidate, at the peak rate with no cache hits,
  because lost contact means the served model is unknown and could have been a dearer one.

The reservation captures the validated provider before I/O. Optional `provider` metadata in
`prices.json` identifies each price's provider; it does not authorize requests. Candidates include
prices absent from the policy allowlist, since a provider may reroute to a model the operator never
requested. Consider prices usable at the original request time. Restrict their floor to the captured
provider only when every candidate has a known provider; otherwise retain the global calculation.
Missing provider metadata forces the global floor because an unbound price may be a dearer rerouting destination.
Charge the greater of this floor and the original reservation to the same
four scopes: global, agent, requested model and session.

The operator accepted this narrower floor on the assumption that rerouting stays within a provider.
An unrelated provider's expensive model adds only coincidental headroom, so removing it improves
precision without establishing an invoice guarantee: routing outside the known price table or across
providers can exceed either estimate, and narrowing removes that extra unrelated-provider margin.

A divergence between requested and served publishes a `provider.rerouted` event. That event is the
audit trail for the asymmetry, and it is the thing to look at before assuming a budget row is wrong.
