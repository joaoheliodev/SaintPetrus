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

M1 provides a terminal-only credential boundary; no browser form receives keys.
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
Start the server and enter your key with the terminal command above. The header
shows connection state. Test connection makes one minimal provider call and shows
latency. Mock mode uses no network. No real API call was used for verification.

The server owns the destination, model, output ceiling, timeout and single active
request limit. Browser completion requests contain only action/input, never the
credential. OpenAI requests disable storage and redirects; errors are normalized.
The adapter follows the [official Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
Token accounting, streaming and agent-driven real execution are not implemented.

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

M0–M2 scaffold and security/proxy foundation. Token budgets, health detectors,
summarizer/reviewer agents and replacement workflows await later milestones.
Windows/macOS use the same Node launcher; native testing was performed on Linux.
The full product README and complete accessibility audit belong to later milestones.

## Portuguese Brazil

SaintPetrus é um painel local de agentes. Execute npm ci e npm run dev e abra
http://127.0.0.1:3000. O M0 permite criar nós e conexões manuais, com validação no
servidor. Não exige chave de API. O mock é opcional, explícito e desligado por padrão.
Não publique chaves em issues, prints ou commits. Consulte SECURITY.md.
