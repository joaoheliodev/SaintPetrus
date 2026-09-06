# Security policy

SaintPetrus is a local application. M0 does not connect to any LLM provider.
Do not use real credentials in the scaffold. Mock mode requires no API key.

## Report a vulnerability

Use GitHub private vulnerability reporting when available. If it is disabled,
ask the maintainer to enable a private reporting channel without describing
sensitive details publicly. Never attach keys, cookies, transcripts containing
secrets, or unredacted screenshots to an issue.

## If a credential leaks

1. Revoke the exposed credential at its provider immediately.
2. Review provider usage and create a replacement only after revocation.
3. Remove the exposure and rewrite affected Git history with git filter-repo.
4. Coordinate cleanup of clones, forks and cached artifacts with maintainers.
5. Scan both the working tree and all available history with Gitleaks.

Renaming a repository or changing its visibility does not remove its history.
Never commit .env files. The example file must contain placeholders only.

## Local boundaries

Development and production scripts bind exclusively to 127.0.0.1.
Do not expose this scaffold through a public tunnel or reverse proxy.
Next.js telemetry is disabled in the launcher. Local API mutations require a
same-origin request. M0 state is volatile and resets when the server restarts.
M0 does not implement encrypted key storage, provider proxying or authentication.

## Contributor checks

Install Gitleaks and run npm run setup:hooks after cloning. The pre-commit hook
fails closed if Gitleaks is unavailable. CI also scans all fetched Git history.
