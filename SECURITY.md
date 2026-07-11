# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public issue.

Use GitHub's private reporting: open the repository's **Security** tab →
**Report a vulnerability**, or go directly to
<https://github.com/colevels/tabbrew-cli/security/advisories/new>.

You can expect an initial response within a few days. Once a fix is ready we'll
coordinate disclosure with you.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## How tabbrew-cli handles secrets

- OAuth tokens are stored **outside the repository** at
  `~/.config/tabbrew/credentials.json`, written with `chmod 600` (re-asserted on
  every save). They are never committed.
- `TABBREW_TOKEN` lets CI/CD supply a token via environment variable, so an
  interactive `login` — and any on-disk token — is never required in automation.
- The CLI has **zero external runtime dependencies**, which keeps the
  supply-chain surface minimal: arg parsing, HTTP, and shell-outs all use
  built-ins.

If you find a case where a token is logged, written to an unexpected location, or
sent anywhere other than the configured `TABBREW_*` endpoints, please report it
via the process above.
