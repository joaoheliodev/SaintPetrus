# SaintPetrus

SaintPetrus is a local panel for building a graph of LLM agents, connecting them, running them through a
budgeted provider proxy and watching what they cost. It is a Next.js application that listens only on
`127.0.0.1` and keeps its state in the memory of that one process. It ships adapters for OpenAI, Google Gemini
and DeepSeek plus a synthetic mock, so the whole panel works without any key.

**Status.** Everything that can be built and checked without a real provider call is done. No request with a
real key has ever been made from this code: the provider adapters, usage parsers and cost reconciliation are
tested against synthetic responses only. The first real call against each provider is an operator step,
described in [docs/provider-validation.md](docs/provider-validation.md) and
[docs/reference/first-real-call.md](docs/reference/first-real-call.md).

## Requirements

- Node.js 22.13 or newer, with npm.
- Git, and [Gitleaks](https://github.com/gitleaks/gitleaks) on `PATH` for commits (the pre-commit hook fails
  closed without it).
- A modern browser. Open the numeric loopback address below, not `localhost`.
- Optional: an OS keyring to remember a key between restarts (Secret Service with `secret-tool` on Linux,
  Keychain on macOS, DPAPI on Windows). Only the Linux path has been exercised.

## Install and run

```sh
git clone https://github.com/joaoheliodev/SaintPetrus.git
cd SaintPetrus
npm ci
npm run setup:hooks
npm run dev
```

Open http://127.0.0.1:3000. Set `PORT` (1024–65535) if 3000 is taken. Both launchers bind to `127.0.0.1`,
disable Next.js telemetry and refuse extra command-line arguments.

For a production server (a real Next.js server, not a static export):

```sh
npm run build
npm start
```

The build fetches no fonts and makes no provider request.

## Mock mode: the panel without a key

`npm run dev` starts with the mock provider on; `npm start` starts with it off, which is how real validation
runs. An explicit `SAINTPETRUS_MOCK=true` or `SAINTPETRUS_MOCK=false` (in the shell or in `.env.local`) always
wins; restart after changing it. The mock answers every call with synthetic `MOCK:` text, uses no network,
costs nothing and never writes to the price file.

With the mock on, **Run mock** plays a fixed synthetic demonstration (it replaces the current graph, so it asks
first), **Pause mock** and **Resume mock** control its scheduler, and the "Mock limits" card shows its
fictitious budget: one cent per 30 characters, reserved before output is delivered.

## Main flow

1. **Add agent** opens a form for a name and an objective; **Create agent** places it on the canvas.
   Double-clicking empty canvas does the same at the pointer.
2. **Subagents.** The **+** beside an agent in the left list, or a drag from a card's right dot to empty canvas,
   creates an agent one level deeper, already joined by a delegation edge.
3. **Connect** two existing agents by dragging from one card's right dot to another card's left dot, or from the
   keyboard with **Connect to** and **Connect** in the inspector. The server refuses duplicates,
   self-connections and cycles.
4. **Move** cards with the mouse, or focus a card, press Enter to select it and use the arrow keys. The server
   saves every settled position.
5. **Edit** an agent's name and objective from the inspector.
6. **Run once** sends one message for the selected agent through the connected provider; the answer appears
   under **Output**. With the mock it is free. With a real provider it is an ordinary budgeted call.
7. **Watch** the server events panel, the connection badge in the header, and **Tokens** for budgets,
   reservations and receipts. An optional live feed is described below.
8. **Export context** downloads the current graph as redacted JSON.
9. **Delete a connection**: select it and press Delete or Backspace, then confirm. Agents cannot be removed;
   that is deliberate and waits on an operator decision.
10. **Reset graph** and **Pause all agents** ask before acting.

The graph lives in server memory: every tab of the same process sees the same graph, and a restart resets it.
Snapshots arrive over a server-sent event stream, with 300 ms polling only while the stream is down.

## Connecting a provider

Click **Connect AI**, choose OpenAI, Google Gemini or DeepSeek (or the mock when it is enabled), enter the
provider's model ID and paste the key into the password field. **Connect and verify (1 call)** stores the key
in backend memory and makes exactly one minimal provider call; with a real key that call costs money.
**Test again** repeats the probe. **Disconnect** clears the key from memory and cancels a call in flight.
**Forget key** also deletes any encrypted copy saved on this machine. Disconnect and Forget key ask first.

The badge reports the backend's state: `● Connected` (verified), `◐ Configured, not verified`,
`▲ Connection rejected`, `△ No visible output` or `△ Output budget exhausted` (the probe was billed but proved
nothing), `○ Disconnected` and `○ Local server unavailable`.

A key only works for a model the operator has prepared:

- `config/token-policy.json` must allowlist the exact model ID with its provider, `max_tokens`, `temperature`,
  thinking policy and whether it can answer deterministically. Restart after editing it.
- The model must have a verified price. Add it in **Tokens → Prices** ("Add price validity"): effective date,
  `verifiedAt`, source URL, UTC peak windows and USD rates for cache hit, cache miss and output in both
  off-peak and peak bands. Records are appended to `config/prices.json`: nothing is deleted, and an open
  predecessor only receives its end date.
- Prices are keyed by the model the **response** names, not the one requested. OpenAI usually answers with a
  dated snapshot of the alias, and Gemini's `modelVersion` is used without its `models/` prefix. A served
  model without a price makes the call `unverifiable` and pauses its agent until the usage is confirmed by hand.
- No DeepSeek model or price is configured. Selecting DeepSeek is refused with `model_not_allowlisted` until
  the operator enters a browser-verified price, following
  [docs/reference/deepseek-price-table.md](docs/reference/deepseek-price-table.md).

From a terminal, while the server runs: `npm run key -- set <provider>` prompts for the key without echo;
`disconnect`, `forget` and `restore` do what their names say, and `set <provider> --remember` opts into
keyring-backed encryption. The providers with an adapter are `openai`, `gemini` and `deepseek`. Never pass a
key as an argument.

## Security model

- **Local only.** Both servers bind to `127.0.0.1`. API routes check the Host, and every state-changing
  request must carry the exact page Origin and a JSON content type. Every response carries a strict content
  security policy and related headers.
- **Keys.** A key travels once, from the password field to the local configuration route, and then lives in
  backend memory. It never reaches browser storage, a URL, a log, a response body or a completion request.
  Remembering it is off by default and uses encryption backed by the OS keyring.
- **Providers.** Each provider has its own adapter with a fixed endpoint, redirects refused and a bounded
  response. Provider error bodies are never read. One request is active at a time, with a 15-second timeout.
- **Money.** Every call reserves tokens and USD synchronously across four scopes (global, agent, model and
  session) before any provider I/O, priced at the peak rate with no cache hits. The answer is reconciled at
  the served model's captured price. Timeouts and server errors are never treated as free: the reservation
  stays unresolved and expires into conservative usage.
- **Output.** The event feed and the export are redacted, and model reasoning text never enters an event, a
  preview or an artifact.

[SECURITY.md](SECURITY.md) has the threat model, the life of a key and how to report a problem;
[docs/architecture.md](docs/architecture.md) follows one call through the modules.

## Budgets, prices and receipts

**Tokens** shows global, agent, model and session limits in tokens and in USD. Either dimension warns at 80%;
a call whose reservation would pass any limit is refused before provider I/O and pauses its agent, and at 100%
further calls are blocked. Raising a limit does not restart work: use **Resume eligible agents**.
**Pause all agents** cancels the active provider request and pauses the mock too.

Costs are estimates from the dated local price table, not invoices. Preflight counts input approximately and
assumes the full output allowance at the peak rate with no cache hits; reconciliation uses the reported usage,
the reported cache split and the rate for the hour the answer arrived (peak if the call touched a peak window).
An actual excess over the reservation is recorded, never hidden, and blocks further calls.

A call that fails without trustworthy usage keeps its reservation unresolved. After `reservationTtlMs` it
converts into usage at the greater of what was held and the dearest price eligible for it, at peak with no
cache hits. Check the provider's billing, then replace that estimate with **Apply confirmed usage**.

`GET /api/receipts` lists the last 200 settled calls with their verdict, served model, price versions and
dispatch; `GET /api/provider` includes a per-provider count of requests actually dispatched upstream.
Counters, reservations and receipts are process-local and reset on restart; the price file and its journal
of reconciled intervals persist. The response cache is off (`cacheTtlMs` is 0) until a real key has been
validated; turning it on is an operator decision.

## Optional features

**Live event feed.** `SAINTPETRUS_FEED=true npm run dev` adds `/api/events`, a server-sent stream of redacted
events with replay (`Last-Event-ID`) and a bounded history (`SAINTPETRUS_EVENT_CAPACITY`, 1–10000, default
500). Without the switch the route does not exist. Clicking an event selects its agent.

**Artifact preview.** Off by default because it executes model-generated code. `SAINTPETRUS_PREVIEW=true
PORT=3210 npm start` (after a build) starts an isolated listener on `127.0.0.1` at `PORT + 1`
(`SAINTPETRUS_PREVIEW_PORT` overrides it). Generated code runs in an opaque `srcdoc` iframe inside a document
whose CSP allows no connections, forms, remote frames, objects, workers or base changes, and whose
`frame-ancestors` admits only the application origin. Both sandbox attributes allow scripts and nothing else.
A sandbox is not a CPU or memory quota: an infinite loop can still exhaust the browser tab. Versions update at
most every 250 ms and the latest 20 stay in memory. OpenAI calls stream text deltas into the preview; Gemini and
DeepSeek update it when the answer completes.

## Provider notes

- **OpenAI** uses the Responses API with storage disabled. The price key is the response's `model`.
- **Gemini** uses `generateContent` with the key only in the `x-goog-api-key` header and a zero thinking
  budget. `promptTokenCount` is input, `candidatesTokenCount + thoughtsTokenCount` is output, the total must
  add up, and `cachedContentTokenCount` is the cache-hit share of the input. Any missing or inconsistent count
  fails closed.
- **DeepSeek** has its own adapter although it speaks the OpenAI wire format, because its status codes, usage
  fields and price key differ. `prompt_tokens_details.cached_tokens` must equal `prompt_cache_hit_tokens`.
- When a usage shape cannot be parsed, only the names of the fields the response carried are recorded, never
  a value. The prices and model availability described in older notes were checked on 2026-09-07 and are not
  a current verification.

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run build
gitleaks dir . --no-banner --redact=100
gitleaks git --no-banner --redact=100 --log-opts=--all
```

`npm run typecheck` runs twice on purpose: once for the app and once for the dependency-free `lib/core`.
Two browser checks need Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`) and a running instance; each
uses a throwaway profile and reaches only `127.0.0.1`:

- `PORT=3310 npm run dev`, then `TEST_APP_PORT=3310 npm run test:e2e`: the main flow, keyboard paths, visible
  focus, control names, confirmations and the absence of CSP violations or console errors.
- `PORT=3210 SAINTPETRUS_PREVIEW=true SAINTPETRUS_MOCK=true npm start`, then `npm run test:browser`: preview
  isolation and live updates.

## Limitations

- No real provider call has been made. Parsers, accounting and error handling are proven against synthetic
  fixtures only; the first real call against each provider must be checked against its invoice before a second.
- The input token count is an estimate; the budget is a guard, not a proof of what the invoice will say.
- State is in memory and single-user: no database, no import, no agent removal.
- Keyring encryption was exercised on Linux only.
- Accessibility was checked in Chromium (contrast, names, focus, keyboard paths), not with a screen reader.
- The core health detectors in `lib/core` are integrated as a library; their orchestration is future work.

## Repository rename

The repository was renamed from StPetrus to SaintPetrus. GitHub redirects the old URL, but update existing
clones explicitly: `git remote set-url origin https://github.com/joaoheliodev/SaintPetrus.git`.

## Português (Brasil)

SaintPetrus é um painel local para montar um grafo de agentes de LLM, conectá-los, executá-los por um proxy
com orçamento e acompanhar o custo. Execute `npm ci` e `npm run dev` e abra http://127.0.0.1:3000: em
desenvolvimento o mock vem ligado e o painel inteiro funciona sem chave. Nenhuma chamada com chave real foi
feita; a primeira chamada real de cada provedor segue `docs/provider-validation.md`. Não publique chaves em
issues, capturas de tela ou commits. Consulte `SECURITY.md`.
