# Provider fixtures

`gemini-generate-content.json` is synthetic, not captured from an account or live request. Counts (17 prompt, 2 candidates, 5 thoughts, 24 total) deliberately exercise the reconciliation arithmetic. Schema source: https://ai.google.dev/api/generate-content#UsageMetadata, checked 2026-09-07. It contains no credential or user content. Live fixtures must be labeled separately and redacted before writing.

`deepseek-chat-completion.json`, `deepseek-cache-miss.json` and `deepseek-max-tokens.json` are synthetic as well, and no DeepSeek request has been made from this repository. Field names follow https://api-docs.deepseek.com, checked 2026-09-10, and the `usage` shape is treated as unverified: the parser fails closed rather than assume it. The counts exercise a partial cache hit (16 of 24 prompt tokens), a zero cache hit, and an output-limit response whose whole completion was reasoning. `model` is a placeholder id, never a rate card: the served model id and its price come from the operator.

