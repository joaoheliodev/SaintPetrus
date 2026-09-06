# SaintPetrus

Local agent graph workspace built with Next.js, TypeScript, Tailwind, Zustand and React Flow.
M0 provides manual nodes/connections validated by the local server.
No LLM provider, API key or durable storage is required or implemented.

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

Do not configure a real key in M0. .env.example contains placeholders only.
Never paste a key into issues, screenshots or recordings, and never commit .env.
Read SECURITY.md for private reporting and credential revocation guidance.
Gitleaks runs in the pre-commit hook (fail-closed when missing) and in CI.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
gitleaks dir . --no-banner --redact=100
gitleaks detect --source . --log-opts=--all --no-banner --redact=100
```

The suite contains six adapted server service/provider cases and four API cases.
Checks cover cycles, duplicate/self edges, limits, mock cancellation/accounting,
mock opt-in, request bounds, origin/Host validation and fixed parse errors.

## Repository rename

The repository was renamed from StPetrus to SaintPetrus. GitHub redirects the old
URL, but existing clones should update their remote explicitly:

```sh
git remote set-url origin https://github.com/joaoheliodev/SaintPetrus.git
```

## Current scope

M0 only. Real providers, secret storage, token budgets, health detectors,
summarizer/reviewer agents and replacement workflows await later milestones.
Windows/macOS use the same Node launcher; native testing was performed on Linux.
The full product README and complete accessibility audit belong to later milestones.

## Portuguese Brazil

SaintPetrus é um painel local de agentes. Execute npm ci e npm run dev e abra
http://127.0.0.1:3000. O M0 permite criar nós e conexões manuais, com validação no
servidor. Não exige chave de API. O mock é opcional, explícito e desligado por padrão.
Não publique chaves em issues, prints ou commits. Consulte SECURITY.md.
