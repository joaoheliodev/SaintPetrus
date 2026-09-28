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

## MOCK and REAL mode

Every start runs in **MOCK** mode unless you opt in: `npm run dev` and `npm start` both start with the keyless mock,
and no keyed provider can be selected, no key is stored and no request can reach a provider. Real providers need
`SAINTPETRUS_MODE=real` at startup (for example `SAINTPETRUS_MODE=real npm start`); the value is read once and
cannot change while the server runs, and in REAL mode the mock is off. A badge next to the name in the sidebar always
says **MOCK** or **REAL**. The former `SAINTPETRUS_MOCK` variables are gone, and the server refuses to start if one
is still set. The mock answers every call with synthetic `MOCK:` text, uses no network, costs nothing and never
writes to the price file.

With the mock on, **Load demo** (in the canvas **More** menu) plays a fixed synthetic demonstration (it replaces
the current graph, so it asks first), **Pause demo** and **Resume demo** control its scheduler, and the "Demo cost" section shows its
fictitious budget: one cent per 30 characters, reserved before output is delivered.

## Main flow

**The screen.** The sidebar holds the name, the **MOCK** or **REAL** badge (always visible), the views
(**Workspace**, **Activity**, **Budgets**, **Prices**, **Connection**) and the list of agents with their status.
The top bar shows the connection Run once uses (`● Connected · mock-v1`; click it to open **Connection**), a budget
meter (the fullest of the global and session budgets; click it to open **Budgets**), **Commands** (Ctrl+K) and
**Pause all agents**. The agent panel on the right has a **Run** and a **Details** tab. While the graph is new, a
**First steps** bar above the canvas lists the next thing to do.

1. **Add agent** (canvas toolbar) opens a form for a name and an objective; **Create agent** places it on the
   canvas. Double-clicking empty canvas does the same at the pointer.
2. **Subagents.** **Add subagent**, the **+** beside an agent in the sidebar, or a drag from a card's right dot to
   empty canvas creates an agent one level deeper, already joined by a delegation connection. Cards say their role
   and level in words ("Subagent · level 1") and their status with an icon and a word.
3. **Connect** two existing agents by dragging from one card's right dot to another card's left dot, or from the
   keyboard with **Details → Connect to** and **Connect**. The server refuses duplicates, self-connections and
   cycles.
4. **Move** cards with the mouse, or focus a card, press Enter to select it and use the arrow keys. The server
   saves every settled position.
5. **Run** (agent panel, first tab): type a message and press **Send (1 call)**. The server first quotes what the
   call would reserve, through the same preflight and budgets as the call itself, and the confirmation shows that
   maximum in tokens and dollars; nothing is reserved or sent until you accept. Your message, the answer, its
   tokens, latency and the cost the server accounted appear right under the button. With the mock it is free.
6. **Details** (second tab): edit the name and objective (the objective is sent, unchanged, as the instruction with
   every Run once, together with your message), connect to another agent, and **Remove agent** in the
   Danger zone. Removal is refused for the Coordinator, for an agent with subagents, while the demo runs, and while
   the agent has a call in flight or usage that is unverifiable or awaiting reconciliation. Its accounting rows
   stay in **Budgets**, marked as a removed agent.
7. **Watch** the Activity drawer under the canvas (card moves and demo output are hidden until you ask for them),
   or the full **Activity** view, and **Budgets** for how much is left and what to do when something is blocked.
8. **More** (canvas toolbar) holds **Import graph…**, **Export graph** (redacted JSON), **Reset graph…** (with the
   objective the Coordinator receives on reset) and, in MOCK mode, **Load demo…**. Every action that replaces the
   canvas asks first.
9. **Delete a connection**: select it and press Delete or Backspace, then confirm.
10. Every confirmation opens inside the app with the focus on **Cancel**.

The server owns the graph: every tab sees the same one. It is saved to `graph.json` in the user data directory
(the same place as remembered keys, see `SECURITY.md`) and restored at startup, with every agent back at rest.
Token accounting is journaled next to it, in `accounting.jsonl` (see **Budgets** below). The event feed and the
session budget are not saved: a restart starts them empty.

An imported file is untrusted input. It must be at most 4 MiB and match the export format exactly: an unknown
field at any level, a `model` field included, is refused, as is credential-shaped text, a provider other than
`Unconfigured` or `Mock`, and a graph the canvas could not have built (wrong depths, cycles, dangling or duplicate
connections, limits out of range). The graph format names no model, so nothing in a file can select one; models
are chosen only through the policy allowlist. Import is refused during a mock run and while any current agent
holds a reservation. A saved `graph.json` that fails the same checks at startup is renamed to
`graph-rejected-<time>.json` and the server starts with a new graph.

Snapshots arrive over a server-sent event stream (`GET /api/graph/stream`), with 300 ms polling only while the stream
is down. Each event carries its revision (`id`, the only order), the new snapshot, the server's clock (`at`, shown in
Activity) and who it concerns: `agent` (`id` and the name it had at that moment, so `agent.removed` still names the
agent that left) and, for connections, `source` and `target`. The stream is redacted like every other response, names
included, and the client refuses an event with an unknown field, no `at` or a malformed party.

## Connecting a provider

In REAL mode, open **Connection** in the sidebar, choose Google Gemini or DeepSeek (in MOCK mode only the mock is offered), enter the
provider's model ID and paste the key into the password field. **Connect and verify (1 call)** stores the key
in backend memory and makes exactly one minimal provider call; with a real key that call costs money.
**Test again** repeats the probe. **Disconnect** clears the key from memory and cancels a call in flight.
Remembered keys are encrypted into the OS user data directory (for example `~/.local/share/saintpetrus/vault` on
Linux), never into the checkout; a vault left in `data/vault` by earlier versions is moved there at startup.
**Forget key** also deletes the selected provider's encrypted copy saved on this machine; `npm run key -- forget
<provider>` removes any provider's copy, including after a restart. Disconnect and Forget key ask first.

The badge reports the backend's state: `● Connected` (verified), `◐ Configured, not verified`,
`▲ Connection rejected`, `△ No visible output` or `△ Output budget exhausted` (the probe was billed but proved
nothing), `○ Disconnected` and `○ Local server unavailable`.

A key only works for a model the operator has prepared:

- `config/token-policy.json` must allowlist the exact model ID with its provider, `max_tokens`, `temperature`,
  thinking policy and whether it can answer deterministically. Restart after editing it.
- The model must have a verified price. Add it in **Prices** ("Add price validity"): effective date,
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

**Budgets** shows global, agent, model and session limits in tokens and in USD. Either dimension warns at 80%;
a call whose reservation would pass any limit is refused before provider I/O and pauses its agent, and at 100%
further calls are blocked. Raising a limit does not restart work: use **Resume eligible agents**. The view opens
with a summary and one sentence saying what is blocked and how to unblock it; the full table is under **Details**.
The mock's estimated tokens count against the token limits too, so the mock alone can reach a limit.
**Pause all agents** cancels the active provider request and pauses the mock too.

Costs are estimates from the dated local price table, not invoices. Preflight counts input approximately and
assumes the full output allowance at the peak rate with no cache hits; reconciliation uses the reported usage,
the reported cache split and the rate for the hour the answer arrived (peak if the call touched a peak window).
An actual excess over the reservation is recorded, never hidden, and blocks further calls.

A call that fails without trustworthy usage keeps its reservation unresolved. After `reservationTtlMs` it
converts into usage at the greater of what was held and the dearest price eligible for it, at peak with no
cache hits. Check the provider's billing, then replace that estimate with **Apply confirmed usage**.

`GET /api/receipts` keeps the last 200 receipts (settled calls, cache hits, expiries and manual reconciliations share
them) with their verdict, served model, price versions and dispatch; `GET /api/provider` includes a per-provider count of requests actually dispatched upstream.
Accounting survives a restart. Every change to the global, agent and model budgets (consumption, cost, limits changed
in Budgets, held and expired reservations with their captured prices, pauses and Pause all) and every receipt is
appended to `accounting.jsonl` in the user data directory (directory 0700, file 0600, synced per record) before it can
take effect. The journal holds IDs, counts, amounts, price versions, verdicts and times, never a key, a prompt or an
answer. At start the server rebuilds from it, with the last 200 receipts. The session budget and the mock's usage start
empty with each run. A call that was in flight when the server stopped comes back `unverifiable`, with its agent
paused; it is never refunded. If the journal cannot be read it is set aside as `accounting-rejected-<time>.jsonl`,
never overwritten, and real calls stay blocked (the mock still runs) until you check the invoice and choose **Start a
new budget period** in Budgets. That action is journaled, keeps the history and limits, restarts consumption from zero
and is refused while any reservation is open. The price file and its journal of reconciled intervals persist too. The response cache is off (`cacheTtlMs` is 0) until a real key has been
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

- **OpenAI** is **not supported until the operator validates it**: it is out of the policy allowlist and the panel does
  not offer it. The adapter stays: it uses the Responses API with storage disabled. The price key is the response's `model`. Usage is parsed
  as strictly as for the others: input plus output must equal the total, and the reasoning share is only a count.
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
Two browser checks need Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`) and a running instance. Each uses a
throwaway profile in the OS temporary directory, reaches only `127.0.0.1` and removes the profile even when Chromium
dies or the run is interrupted. The main-flow check changes the instance it runs against (it resets the graph and
pauses every agent), so it refuses one that already holds work or has a keyed provider connected: start a fresh one.

- `PORT=3310 npm run dev`, then `TEST_APP_PORT=3310 npm run test:e2e`: the main flow, keyboard paths, visible
  focus, control names, confirmations and the absence of CSP violations or console errors.
- `PORT=3210 SAINTPETRUS_PREVIEW=true npm start`, then `npm run test:browser`: preview
  isolation and live updates.

## Limitations

- No real provider call has been made. Parsers, accounting and error handling are proven against synthetic
  fixtures only; the first real call against each provider must be checked against its invoice before a second.
- The input token count is an estimate; the budget is a guard, not a proof of what the invoice will say.
- Single-user. The graph and the global, agent and model accounting are saved; the session budget, the mock's usage,
  the event feed and the dispatch ledger are not.
- Keyring encryption was exercised on Linux only.
- Accessibility was checked in Chromium (contrast, names, focus, keyboard paths), not with a screen reader.
- The core health detectors in `lib/core` are integrated as a library; their orchestration is future work.

## Repository rename

The repository was renamed from StPetrus to SaintPetrus. GitHub redirects the old URL, but update existing
clones explicitly: `git remote set-url origin https://github.com/joaoheliodev/SaintPetrus.git`.

## Português (Brasil)

SaintPetrus é um painel local para montar um grafo de agentes de LLM, conectá-los, executá-los por um proxy
com orçamento e acompanhar o custo. Execute `npm ci` e `npm run dev` e abra http://127.0.0.1:3000: o
mock vem ligado por padrão e o painel inteiro funciona sem chave; provedores reais só com `SAINTPETRUS_MODE=real`. Nenhuma chamada com chave real foi
feita; a primeira chamada real de cada provedor segue `docs/provider-validation.md`. Não publique chaves em
issues, capturas de tela ou commits. Consulte `SECURITY.md`.
