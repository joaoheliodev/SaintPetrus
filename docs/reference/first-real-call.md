# First real call

Read this before the first call with a real key against any provider. The key lock in `AGENTS.md`
still applies: the operator approves the call.

No provider has answered this project yet. Until the first invoice comparison exists, every monetary
figure in the snapshot is our own arithmetic, and a systematic error in it would be invisible and
would compound with every call. Do not shorten the protocol: it applies to the first real call ever
made against each provider, not to the first call of a session.

## Before the call

- **Off-peak.** The model's `peakWindowsUtc` in `config/prices.json` is authoritative; an empty list
  means time does not change the rate. For DeepSeek, both independent readings of its pricing page
  agreed on Monday to Friday, 01:00–04:00 and 06:00–10:00 UTC, as encoded in `tests/deepseek.test.ts`
  (`weekdays: [1, 2, 3, 4, 5]`, where 0 is Sunday). The operator works in Brasília time: at UTC−03:00,
  the offset on 2026-09-15, peak is 22:00–01:00 from Sunday to Thursday night and 03:00–07:00 from
  Monday to Friday, so an afternoon call is off-peak. Confirm the offset on the day with `date +%z`.
  Start a few minutes clear of a window edge: a call that touches peak at either end reconciles at
  peak, and the proxy lets it run for up to 15 seconds.
- **Thinking off.** Use Test connection. It bypasses the response cache and switches reasoning off
  wherever the wire protocol has an off switch. OpenAI has none, so the effort declared in the policy
  applies; declare the lowest.
- **Minimal output.** Lower the model's `max_tokens` in `config/token-policy.json` to the least that
  still leaves room for visible text. A reply cut at the limit comes back `incomplete`, is billed
  anyway and does not verify the connection.
- **Small ceiling.** Lower `costLimitsUsd` so the ceiling contains a mistake, but not below one
  preflight reservation (peak rate, no cache hits, full `max_tokens`), or the call is refused before it
  is sent. Restart after editing either file; limits edited in Tokens live in memory only.
- **Visible events.** Start the server with `SAINTPETRUS_FEED=true` so the events below reach the feed.

## What to watch

- `provider.rerouted`: the served model differs from the requested one. The call is priced at the
  served model's rate; if that model has no verified price, the call stays unverifiable and the agent
  pauses.
- `provider.usage_unparsed`: the usage shape is outside the adapter's contract. The event lists field
  names, never values. The parser fails closed and pauses the agent; that is the intended behavior,
  not a defect. Correct the parser from those names in one change instead of retrying.
- An unverifiable reservation: Tokens shows `■ Awaiting usage` with the reservation ID, and the rows
  count it as unverifiable. A timeout or a 5xx lands here too, because losing contact is not evidence
  that nothing was billed.

Before any second call, compare what the provider billed for this call with the reconciled figure in
Tokens, the accounted cost and the USD used per row. The input counter is approximate and the ceiling
is a guard, not a proof of the invoice. If the two disagree, stop and find out why.

## Resuming after an unverifiable pause

1. Do not retry and do not restart the server. State is process-local, so a restart erases the record
   of a call that may have been billed.
2. Check the provider's billing for the call.
3. Wait for `reservationTtlMs`. The reservation becomes `⚠ Expired estimate`, charged at the greater of
   the hold and the dearest model in the price table at peak with no cache hits, and stops counting as
   unverifiable.
4. Enter the provider-confirmed prompt tokens, completion tokens and cost on that estimate, then choose
   Apply confirmed usage. The confirmed figures replace the conservative charge.
5. Remove the cause before calling again: correct the parser after `provider.usage_unparsed`, or have
   the operator verify a price for the model that answered a rerouted call.
6. Choose Resume eligible agents. An agent whose rows are still at a ceiling stays paused.
