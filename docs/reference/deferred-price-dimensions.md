# Two price dimensions the schema does not model yet

Read this before adding a model whose rates change with prompt size or that charges for cache writes.

`lib/tokens/pricing.ts` prices a call along two axes: `peakWindowsUtc` picks the `peak` or `offPeak`
`RateBand` by time, and each band splits input into cache hits and cache misses. Two real dimensions
are missing. No model in `config/prices.json` exercises either today, so neither is implemented, and
implementing either changes how calls are priced, which is an operator decision. Do not simplify
either one into the existing bands when it becomes necessary: entering the higher rate as the only
rate overcharges every call, entering the lower one underprices exactly the calls the dimension
exists for, and preflight must never underestimate. This page carries no rate, threshold or model
identifier, because the operator's entry in `config/prices.json` is the only price source and a
figure copied into a document outlives the page it came from.

## Long-context tier

Some models raise their rates once a prompt passes a size threshold. `RateBand` has no
prompt-size axis, so such a model would be priced at one tier for every prompt.

Necessary the day a model with a prompt-size tier enters the price table. Reconciliation would pick
the tier from the reported prompt. Preflight only has the approximate input counter, so a prompt
estimated just under the threshold must not be reserved at the lower tier. The expiry worst case
would have to consider the higher tier as well.

## Cache-write band

Some providers charge for writing a prompt to the cache, above the cache-miss rate. `validBand`
requires `inputCacheMissPerMillion >= inputCacheHitPerMillion` and has no third input band, and
`inputBreakdown` reports only hits and misses, so written tokens would be priced as misses.

Necessary the day a model that charges for cache writes enters the price table. From then on a cache
miss is no longer the dearest input token, so assuming zero cache hits stops being the preflight
worst case. The count of written tokens must come from a usage field confirmed in a real response,
never from memory.
