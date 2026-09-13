# DeepSeek prices require operator verification

Read this before adding or changing a DeepSeek model or price entry.

The operator maintains `config/prices.json` from the current page in their own browser and records
`verifiedAt`. Independent readings and cached copies of the published table have disagreed, so an agent
must not transcribe a price or model identifier and the application must not fetch prices at runtime.
Do not simplify this to an automated or remembered value: leave an unverified model absent so preflight
fails closed until the operator supplies the auditable entry.
