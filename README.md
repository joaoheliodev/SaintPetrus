# SaintPetrus

Local agent graph workspace built with Next.js, TypeScript, Tailwind, Zustand and React Flow.
M0 provides manual nodes/connections validated by the local server.
M1 isolates credentials; M2 adds a local proxy with explicit mock and OpenAI adapters.
No API key is required to build, test or use the manual canvas.

## Prerequisites

- Node.js 22.13 or newer and npm.
- Git and Gitleaks available on PATH for commits.
- A local browser. Use the numeric loopback address below.

## Install and run

```sh
git clone https://github.com/joaoheliodev/SaintPetrus.git
cd SaintPetrus
npm ci
npm run setup:hooks
npm run dev
```

Open http://127.0.0.1:3000. If the port is occupied, set the PORT environment
variable to another port (1024–65535). Both dev and production launchers force
127.0.0.1 and disable Next.js telemetry; additional CLI arguments are rejected.

Production runs a real Next.js server, not a static export:

```sh
npm run build
npm start
```

No remote fonts or provider requests are used during the build.

## Manual graph

1. Click Add agent, enter a name and objective, then click Create agent.
2. Drag from the right handle of one node to the left handle of another.
3. Use Fit all to frame the graph. Click an agent to inspect its context.
4. Duplicate connections, self-connections and cycles are rejected by the server.

Node movement is transient in the UI while dragging, then confirmed by the server.
The graph is shared by tabs of this local process and resets on server restart.
M0 uses revisioned snapshots and polling; there is no database, outbox or WebSocket.
RF-05 edge type editing, automatic connection modes, preview, fan-out and message TTL
are not part of M0. Existing context/delegation labels are scaffold contracts.

## Optional mock provider

Mock mode is OFF by default. To enable it, create a local .env.local file with:

```dotenv
SAINTPETRUS_MOCK=true
```

Restart the server. The UI will visibly say MOCK MODE. Run mock starts a fixed,
synthetic demonstration and resets the current graph. It does not call an LLM.
Pause mock and Resume mock control the server-side scheduler. The mock budget is
fictitious: one cent per 30 characters, reserved before output delivery.
The provider is isolated in lib/providers/mock-provider.ts and only enabled by
this server-side flag. Tests instantiate it explicitly without API keys.

## Credentials and security

Click **Connect AI** in the header. Select OpenAI, enter the provider model ID
(or select the already configured model), and enter the key in the password field.
Show/Hide controls visibility. Connect stores the credential without testing it;
Test connection configures it if needed and makes exactly one minimal call,
showing status and latency. Disconnect clears backend memory. The badge remains
visible when the panel closes and reflects the backend state.

The key exists transiently in the browser field and the local configuration POST,
then the field is cleared. It is never attached to completion requests, returned
in responses or saved in browser storage. Remember key is unchecked by default
and opts into encryption using the OS keyring. Terminal entry remains available:
Use `npm run key -- set openai` for hidden entry while the local server is running.
Use `npm run key -- disconnect openai` to clear memory, `forget` to remove any
saved ciphertext, or `restore` to explicitly load remembered ciphertext.
`npm run key -- set openai --remember` opts into OS-keyring-backed encryption.
Default is **not to persist**. Linux needs libsecret/secret-tool and an unlocked
Secret Service; macOS uses Keychain; Windows uses DPAPI. Never pass a key as a
command argument. Tests use runtime-generated synthetic material only.
.env.example contains placeholders only.
Never paste a key into issues, screenshots or recordings, and never commit .env.
Read SECURITY.md for private reporting and credential revocation guidance.
Gitleaks runs in the pre-commit hook (fail-closed when missing) and in CI.

## Provider proxy (M2)

With the server stopped, configure `SAINTPETRUS_PROVIDER=openai` and
`SAINTPETRUS_MODEL=REPLACE_WITH_PROVIDER_MODEL_ID` in your ignored `.env.local`.
Start the server and enter your key in Connect AI or with the terminal command above. The header
shows connection state. Test connection makes one minimal provider call and shows
latency. Mock mode uses no network. No real API call was used for verification.

The server owns the destination, model, output ceiling, timeout and single active
request limit. Browser completion requests contain only action/input, never the
credential. OpenAI requests disable storage and redirects; errors are normalized.
The adapter follows the [official Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
RF-06 accounts provider usage and enforces budgets. Streaming and agent-driven real execution are not implemented.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
gitleaks dir . --no-banner --redact=100
gitleaks detect --source . --log-opts=--all --no-banner --redact=100
```

The suite covers graph services, local HTTP boundaries, credential security and the proxy with mock transport.
Checks cover cycles, duplicate/self edges, limits, mock cancellation/accounting,
mock opt-in, request bounds, origin/Host validation and fixed parse errors.

## Repository rename

The repository was renamed from StPetrus to SaintPetrus. GitHub redirects the old
URL, but existing clones should update their remote explicitly:

```sh
git remote set-url origin https://github.com/joaoheliodev/SaintPetrus.git
```

## Current scope

M0–M2, RF-01, core integration and RF-06 are implemented. Core health detectors
are integrated as a library; their orchestration, summarizer/reviewer agents and
replacement workflows await later milestones.
Real Linux keyring encryption/decryption was verified with synthetic material.
Windows/macOS keyring execution remains unverified; command adapters use test doubles.
The full product README and complete accessibility audit belong to later milestones.

## Portuguese Brazil

SaintPetrus é um painel local de agentes. Execute npm ci e npm run dev e abra
http://127.0.0.1:3000. O M0 permite criar nós e conexões manuais, com validação no
servidor. Não exige chave de API. O mock é opcional, explícito e desligado por padrão.
Não publique chaves em issues, prints ou commits. Consulte SECURITY.md.

## Integrated core and known limitations

The core is in `lib/core`, with 168 original tests in `tests/core`. The proxy
invokes its injectable TokenCounter for preflight estimation. Next keeps ES2017;
the independent `tsconfig.core.json` checks core and tests at ES2022 with the
original strict flags. Root file sets are disjoint; imported dependencies may
still be traversed by TypeScript. Removing the test exclusion reintroduces TS1501.

- `evaluated:false` means **not evaluated**, never healthy.
- Handoff `withinBudget:false` must be visible; protected items can exceed the ceiling.
- Repeated-question detection is lexical and can miss paraphrases.
- Token heuristics are approximate. Displayed cost is an **estimate** using a
  dated local price table; actual provider usage is the source for billed tokens.


## Token controls (RF-06)

Open **Tokens** in the header. Set global, agent, model and current-session limits;
Apply updates the authoritative in-memory budget on the local server. Limits are
token counts. Warnings start at 80%. A request whose reservation would exceed any
limit is rejected before provider I/O and pauses its agent. At 100%, further calls
are blocked. Raising a limit does not restart work: use Resume eligible agents.
Pause all agents cancels the active proxy request and pauses the graph demo too.

Before real calls, edit `config/token-policy.json` to allow the exact provider model
ID with its provider (`openai`), `max_tokens` and `temperature`. Add that same ID to
`config/prices.json` with verified numeric `inputPerMillion` and `outputPerMillion`
USD rates, and update the table date. Restart the server after file edits. Only the
free synthetic mock is supplied; no real model or unverified price is enabled.
No price lookup uses the network. Then configure the model/key through Connect AI.

Preflight uses the core's approximate TokenCounter plus the allowed maximum output.
The reservation is reconciled to `usage.input_tokens`, `usage.output_tokens` and
`usage.total_tokens` from the provider. Estimates may undercount; any actual excess
is retained in the ledger and pauses further calls, never hidden or rewritten to
match the reservation. This is not an exact tokenizer or a guaranteed provider
invoice cap. The actual-token columns use only reported usage. Mock estimates are
separate. Dollar amounts are explicitly **cost estimates**, calculated from the
dated local table, not a fetched provider invoice.

If a real request fails without trustworthy usage, its reservation remains marked
unresolved, with no fabricated billed usage. Resume is refused until billing can
be checked outside the app; this version has no automated billing reconciliation.
State is process-local: one server-issued session per process; restarting clears
counters, reservations, cache and memory-only limit edits. Check outstanding
provider billing before restarting; this is not a durable accounting ledger.

The cache key hashes provider, model, complete system prompt, every message and
role, temperature and max_tokens. Only temperature=0 is cached. TTL comes from
`cacheTtlMs`; cache hits add saved tokens without adding billed usage. Connection
tests bypass cache so Test connection still makes one minimal call. The graph's
old animated mock demonstration is a separate synthetic simulation; only proxy
calls enter this ledger.

### Optional live event feed

The internal process-local event bus always runs. Its circular history defaults to 500 entries (`SAINTPETRUS_EVENT_CAPACITY`, range 1–10000); restart loses events and accumulated token totals. Consumer snapshots cannot modify stored events.

Client exposure defaults off. Start with `SAINTPETRUS_FEED=true npm run dev` to enable the SSE feed. The Node entrypoint registers `/api/events` only when this switch is true; otherwise Next has no such route and returns 404. Restart to change it. This uses the existing `tsx` installation; install development dependencies for local server operation. Feed replay uses Last-Event-ID and reports evicted history. Slow consumers disconnect and reconnect instead of accumulating an unbounded queue. Tokens include explicitly labeled mock estimates. Clicking an event selects the existing agent inspector; the full RF-02 panel is still pending.
