# SaintPetrus — current status

Branch: `night/m0-m2`. Remote repository: `joaoheliodev/SaintPetrus`.

## Gemini step 1A / 1B

Step 1A implemented: GeminiAdapter uses the existing ProviderProxy and RF-06 TokenService, with UI and terminal credential configuration. OpenAI adapter unchanged (verified by git diff). Endpoint: fixed Google generateContent API; key only in x-goog-api-key backend header; no query credential, redirects or raw error passthrough.

Documented mapping: promptTokenCount → prompt; candidatesTokenCount + thoughtsTokenCount → completion; totalTokenCount → total. Required numeric counts and exact equality checked. Nonzero cached/tool usage is rejected rather than mispriced. Valid zero-text responses retain usage. Gemini uses non-streaming generateContent in this step; preview gets the completed output.

Prepared model: gemini-2.5-flash-lite, global 1024 tokens, maxOutputTokens 64, thinkingBudget 0, cache off, persistence off by default. Gemini 1.5 models and 2.0 Flash requested initially are retired according to official changelog/deprecation pages; they are not exposed as working allowlisted models. Model/account availability remains unverified.

Prices checked 2026-09-07 at https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite : standard paid text input USD 0.10/M, output including thinking USD 0.40/M. Free tier can cost zero if eligible; usageMetadata does not prove the billing tier. UI cost is a configured-rate estimate based on reported usage, not an invoice.

212 tests passed, lint passed, both typechecks passed and build passed without real API calls. Synthetic fixture proves 17 prompt + 2 candidate + 5 thinking = 24 total, completion 7, estimated paid-rate cost USD 0.0000045; full configure/execute/disconnect API path also tested. Fixture is explicitly labeled synthetic, with official schema source. No live response has been captured.

Step 1B NOT EXECUTED: awaiting Gemini key entered via RF-01 with Remember unchecked and Connect only. Pending: one successful minimal real call; usage/reconciliation/cost/schema comparison; forced real provider error and fragment checks; 429/timeout if feasible; context export and enabled-feed scans; sanitized real fixtures and regression fixes for each observed divergence. Do not mark any real-key acceptance approved yet.

## Current scope

Item 1 completed in `c4c6895` after foundation WIP `87c2e47`: internal typed append-only circular event bus and optional SSE feed. Both live SSE and disabled HTTP 404 verified. The Node entrypoint change was explicitly approved by the user. Feed event selection targets the existing agent inspector; the full RF-02 panel remains pending.

Item 2 implemented in this change: independent optional preview SSE, separate loopback listener, trusted wrapper with HTTP CSP, nested opaque generated-code iframe, partial Responses text integration, bounded debounced version history, pause, source and previous-version controls. Both sandboxes permit only scripts. Generated code cannot fetch the backend or navigate itself there: the outer CSP blocks child frame navigation. Storage, cookies and parent document access were denied in Chromium.

Both toggles default false: `SAINTPETRUS_FEED` and `SAINTPETRUS_PREVIEW`. They are read by the server at startup. Feed-off leaves the internal bus running. Preview-off registers no artifact endpoint and opens no preview port. User must explicitly enable and restart; these are not cosmetic UI toggles. No RF-03/RF-04 implementation started.

## Verification

- 209 unit/integration tests passed without API keys, including event-to-SSE redaction and HTML text escaping, bounded histories, disabled route registries and streaming usage/partial text.
- Gitleaks directory and full-history scans passed with build cache present; staged scan is enforced before commit.
- Lint, root ES2017 typecheck, separate core ES2022 typecheck and production build passed.
- Feed live browser verification: creation arrives via SSE, newest first, type filter and selecting corresponding inspector; disabled endpoint HTTP 404.
- Independent disposable Chromium check: HTML/JS rendering, incremental versions, source, previous version, paused historical view retained while new versions arrive, fetch denied by connect-src, self-navigation denied by parent frame-src, storage/cookies/parent inaccessible, allow-scripts only.
- Preview-only and both-enabled server configurations tested independently of feed. With preview disabled, artifact route and preview route return 404 and its port does not listen.
- Browser check is reproducible with `npm run test:browser`, an installed Chromium and the documented disposable mock server. No real key, user browser profile, external provider or live fixture used.

## Open debts and limits

- Counters, budgets, graph, events and artifacts are process-local; restarting clears them.
- Reservations without trustworthy provider usage do not expire; resolving this remains a separate pending step.
- Existing Gitleaks suppression in tests/core/token-estimate.test.ts remains for the verified public counter name.
- Native Windows/macOS keyrings are not verified. Prior Linux keyring test used synthetic material.
- No real provider call has been executed. Real usage/cost reconciliation, error/fragment handling and the new Responses streaming path remain unverified against the live provider.
- Previously mock-only defaults now additionally allow GPT-5 nano with published standard rates. Account availability and cached-input discounts remain unverified/unaccounted for. Configured global budget is 1024 tokens, not an independent cash ceiling.
- Configured credential fragments of 12+ characters are redacted. Arbitrary shorter substrings are not reliably distinguishable from normal text.
- Generated code can consume excessive CPU/memory; iframe sandboxing is not a resource quota. Browser checks cover the documented HTTP fetch/navigation, origin and storage boundaries, not every browser engine or every possible network subsystem.
- RF-02 full panel and all later milestones are pending. The earlier real-key validation gate is still open, not silently approved.

## Execution notes

The sandbox initially denied binding (`listen EPERM`) and a later build could not parse `tsc --showConfig`; granted turn-scoped network permission resolved those execution restrictions. Initial browser harness attempts needed hydration waiting, out-of-process frame attachment and moving storage assertions before deliberately invalidating a document through blocked navigation. These were test-harness corrections; final assertions passed. NIGHT-LOG.md remains append-only.
