# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`tabbrew-cli` is a Bun + TypeScript CLI (`tabbrew` binary) that authenticates to a
TabBrew server via the OAuth 2.0 Device Authorization Grant (RFC 8628) and exposes
a few agent-facing tools. It has **zero external runtime dependencies**: arg parsing
is `parseArgs` from `node:util`, HTTP is the global `fetch`, and shelling out uses
Bun's shell (`Bun.$` / `Bun.which`).

## Commands

```bash
bun install                        # requires Bun ≥ 1.1
bun run src/index.ts <cmd>         # run in dev, e.g. `... whoami`
bun start -- <cmd>                 # same, via the start script
bun run typecheck                  # tsc --noEmit — the only automated check
bun run build                      # → dist/tabbrew (self-contained compiled binary)
```

There is **no test runner and no linter configured**; `typecheck` + `build` (in
`.github/workflows/ci.yml`) is the whole *check* CI surface — releases are cut by the
separate `.github/workflows/release.yml` (see **Releasing**). "Testing" a subcommand
means running it against a real/staging server by
pointing `TABBREW_BASE_URL` at it (see README "Testing each subcommand"). Set
`TABBREW_TOKEN` to exercise authed commands without an interactive `login`.

## Architecture

`src/index.ts` is the command router: it parses `Bun.argv`, dispatches on the first
positional, and wraps everything in a **single error boundary**. That boundary only
prints a clean message (no stack trace) for the CLI's four typed error classes —
`AuthError` (`auth.ts`), `ApiError` / `NotAuthenticatedError` / `TokenExpiredError`
(`api.ts`). Throw one of these for any user-facing failure; anything else surfaces a
generic message unless `TABBREW_DEBUG` is set. Because `parseArgs` runs in `strict`
mode, **every accepted flag must be declared in `index.ts`** — even flags only used
by one subcommand (all the `init` flags are declared there).

`src/config.ts` is the seam that makes the same binary target prod/staging/local:
all configuration comes from `TABBREW_*` env vars with sensible defaults, resolved
once into the exported `config` object. Endpoints derive from `TABBREW_BASE_URL`
unless individually overridden. Nothing else reads `process.env` for configuration —
route new config through here.

The codebase is three loosely-coupled subsystems that share only `config`, `ui`, and `util`:

**1. Auth / API (the original purpose)**
- `auth.ts` — device-flow protocol: request a device code, then `pollForToken`
  handles the RFC 8628 `authorization_pending` / `slow_down` / `access_denied` /
  `expired_token` states.
- `credentials.ts` — token storage at `~/.config/tabbrew/credentials.json` (chmod
  600, re-asserted on every save). `resolveToken()` is the single source of truth
  for the active token: **`TABBREW_TOKEN` env var always wins over the stored file**
  (so CI never runs `login`).
- `api.ts` — `authedFetch` attaches the bearer token and converts any `401` into a
  `TokenExpiredError` whose wording differs for env-var vs stored tokens. It also
  holds `htmlFilesPost` (see `docs push` below).
- Commands: `commands/login.ts`, `logout.ts`, `whoami.ts`, `tools.ts` (the
  `repo-info` demo — guards every external call with `which()` before shelling to git),
  `docs.ts`.

`commands/docs.ts` (`tabbrew docs push <file>`) sends an HTML file to TabBrew's
`/api/v1/html_files/*` endpoints so it shows up in the sidepanel **Docs** view —
`local` mode (default) registers the absolute path as JSON; `--cloud` uploads the
content as multipart (≤ 2 MB, checked client-side before sending). These endpoints
are a **dual-token seam**: they currently accept only a legacy per-feature
`x-upload-token` (from `TABBREW_UPLOAD_TOKEN` or `~/.config/tabbrew/upload-token`,
resolved by `resolveUploadToken()`), but the goal is the OAuth login token. So
`htmlFilesPost` tries `Authorization: Bearer` **first** and falls back to
`x-upload-token` on a 401 (rebuilding the body per attempt via a `makeBody` thunk so
a consumed multipart stream is regenerated). Once the server accepts the bearer for
these routes the fallback is dead code — remove it then.

`commands/docs.ts` also has `tabbrew docs list` (`GET /api/v1/html_files`), which
prints the account's docs as a hand-padded table (`--json` for the raw array). It
is **not** part of the dual-token seam: the read route already accepts the OAuth
login token, so `htmlFilesList()` in `api.ts` uses `authedFetch` directly (like
`fetchUserInfo`). Its `HtmlFileRow` mirrors the server's `HtmlFileDTO`
(`tabbrew-web/lib/html-files.ts`) and stays a tolerant reader — extra server
fields are ignored, not fatal.

> **Cross-repo:** the server routes + wire contract for every `docs`/API-backed
> command live in the `tabbrew` monorepo (`tabbrew-web`), which is their source of
> truth. When adding such a command, follow the *"Adding a `tabbrew-cli` command
> backed by a web API route"* checklist in that repo's root `CLAUDE.md`: contract
> first → server (+ `curl` verify) → CLI here (against local web via
> `TABBREW_BASE_URL`/`TABBREW_TOKEN`) → ship the server before the binary.

**2. `init` — agent-awareness installer**
`tabbrew init` teaches an AI agent (currently only Claude Code) that this CLI exists.
It writes a slim `TABBREW-CLI.md` doc plus a version-tagged managed block in
`CLAUDE.md` that `@import`s it. Design constraints worth preserving:
- `awareness.ts` is **filesystem-free** — the awareness doc and all block-manipulation
  are pure string constants/functions so they survive `bun build --compile` (no
  runtime file reads). Disk I/O lives in `fsops.ts`; orchestration in `commands/init.ts`.
- The managed block is located by a **version-less marker** (`<!-- tabbrew-cli-instructions`)
  so a future v2 replaces v1 in place instead of duplicating. A block with an opening
  marker but no close is treated as malformed → `init` **refuses** rather than guessing.
- `fsops.ts` writes are **atomic** (temp file in the same dir + rename) and follow
  symlinks; an existing `CLAUDE.md` is copied to `.bak` before editing.
- `agents.ts` holds the `AgentTarget` registry — this is the extension seam for adding
  Cursor/Codex/Gemini. Note the comment there: Claude resolves `@` imports relative to
  the importing file, but Codex resolves relative to CWD, so a new target will need an
  absolute `importRef`.
- Behavior is idempotent (re-runs report `unchanged`) and safe non-interactively:
  `confirm()` defaults to No and auto-declines on a non-TTY unless `--yes` is passed.

**3. `update` — self-updating binary**
`tabbrew update` replaces the running compiled binary with the newest GitHub Release.
It is **not** part of the web-API/dual-token seams — it talks only to GitHub Releases,
so its config lives in `config.update` (`TABBREW_REPO` / `TABBREW_RELEASE_URL` /
`TABBREW_DOWNLOAD_BASE_URL` / `TABBREW_DOWNLOAD_TIMEOUT_MS`), separate from the auth
endpoints. `update.ts` is the IO/protocol module (like `api.ts`); `commands/update.ts`
is the thin presentation layer. Design constraints worth preserving:
- **Version discovery uses the `releases/latest` 302 redirect**, not the REST API — no
  token, no 60/hr rate limit, and no coupling to API JSON. Same trick `install.sh` uses.
  (The producer side — how those releases are built, signed, and published — is
  **Releasing** below.)
- **Compiled-vs-dev is gated on `import.meta.url` containing `/$bunfs/`** (a compiled
  standalone runs its entry from Bun's virtual FS; `bun run src/…` is a real `file://`).
  `update` refuses in dev so it never overwrites the `bun` binary. `process.execpath`
  (realpath'd) is the file to replace.
- **The swap is an atomic rename over self**: temp file in the target's own dir (no
  `EXDEV`), `chmod 0o755`, then `rename` — safe while running (keeps the old inode; we
  never write in place, which would `ETXTBSY`). Mirrors `fsops.ts`'s temp+rename idiom.
  Permission failures (`EACCES`/`EPERM`/`EROFS`) become an actionable `UpdateError`.
- **SHA-256 is verified client-side** against `checksums.txt` (`Bun.CryptoHasher`, zero
  dep) before the swap — a mismatch aborts and leaves the original binary untouched.
- `--check` reports current-vs-latest and **always exits 0** (`--json` for scripting);
  the full form has **no confirmation prompt** (the command *is* the intent) and is a
  no-op when already current. Throw `UpdateError` for any user-facing failure.

`ui.ts` centralizes colors (disabled when non-TTY or `NO_COLOR`) and reads the version
from `package.json` (bundled at compile time). The repo/package name is `tabbrew-cli`;
the user-facing binary/command is `tabbrew` (`BIN` in `ui.ts`).

## Project layout

```
src/
  index.ts            # command router — Bun.argv + parseArgs, single error boundary
  config.ts           # env-driven configuration (base URL, client id, endpoints, update)
  auth.ts             # OAuth device-flow logic (request code, poll, pending/slow_down)
  credentials.ts      # token storage (~/.config, chmod 600) + env-var override
  api.ts              # authed fetch wrapper + 401 handling + userinfo + html_files client
  update.ts           # self-update: release lookup, download+checksum, atomic binary swap
  util.ts             # sleep, which(), safeText, open-browser
  ui.ts               # colors, help text, version
  agents.ts           # init: AgentTarget registry (Claude Code; extensible)
  awareness.ts        # init: bundled awareness doc + managed-block string ops
  fsops.ts            # init: atomic write, writeIfChanged, backup, safe read/remove
  commands/
    login.ts logout.ts whoami.ts tools.ts docs.ts init.ts update.ts
```

## Configuration

Everything is driven by `TABBREW_*` env vars (resolved once in `config.ts`), so the
same binary can point at prod, staging, or a local server. The defaults target the
hosted TabBrew server at `https://www.tabbrew.com`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TABBREW_BASE_URL` | `https://www.tabbrew.com` | Base URL of the auth/identity server |
| `TABBREW_CLIENT_ID` | `tabbrew-cli` | OAuth client id sent in the device flow |
| `TABBREW_SCOPE` | *(unset)* | Optional space-delimited OAuth scopes |
| `TABBREW_DEVICE_CODE_URL` | `$BASE/api/v1/oauth/device/code` | Override the device-code endpoint (POST) |
| `TABBREW_TOKEN_URL` | `$BASE/api/v1/oauth/token` | Override the token endpoint (POST, polled) |
| `TABBREW_USERINFO_URL` | `$BASE/api/v1/oauth/userinfo` | Override the whoami endpoint (GET) |
| `TABBREW_HTML_LOCAL_URL` | `$BASE/api/v1/html_files/local` | Override the `docs push` local-register endpoint (POST) |
| `TABBREW_HTML_UPLOAD_URL` | `$BASE/api/v1/html_files/upload` | Override the `docs push` cloud-upload endpoint (POST) |
| `TABBREW_HTML_LIST_URL` | `$BASE/api/v1/html_files` | Override the `docs list` endpoint (GET) |
| `TABBREW_REPO` | `colevels/tabbrew-cli` | GitHub `owner/name` the `update` release URLs derive from |
| `TABBREW_RELEASE_URL` | `github.com/$REPO/releases/latest` | Override the `update` latest-release redirect URL |
| `TABBREW_DOWNLOAD_BASE_URL` | `github.com/$REPO/releases/latest/download` | Override the `update` release-asset download base |
| `TABBREW_DOWNLOAD_TIMEOUT_MS` | `120000` | `update` binary-download timeout (separate from `TABBREW_TIMEOUT_MS`) |
| `TABBREW_TOKEN` | *(unset)* | Use this token directly; **wins over the stored file** (for CI/CD) |
| `TABBREW_UPLOAD_TOKEN` | *(unset)* | `docs push` upload token; **wins over** `~/.config/tabbrew/upload-token` |
| `TABBREW_NO_BROWSER` | *(unset)* | Set to skip auto-opening the browser during `login` |
| `TABBREW_TIMEOUT_MS` | `15000` | Per-request timeout in milliseconds (device code / poll / whoami) |
| `TABBREW_DEBUG` | *(unset)* | Print stack traces on unexpected errors |
| `NO_COLOR` | *(unset)* | Disable ANSI colors |

The server is expected to implement RFC 8628:

- `POST {device code endpoint}` with `client_id` → `{ device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval }`
- `POST {token endpoint}` with `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id=…` → `{ access_token, … }`, or an error body of `authorization_pending` / `slow_down` / `access_denied` / `expired_token`
- `GET {userinfo endpoint}` with `Authorization: Bearer <token>` → any user JSON (the CLI surfaces `id`/`sub`, `email`, `name`/`username`/`login` when present, then prints the full body)

## Build

`bun build --compile` bundles the runtime + code into one self-contained executable
(no Bun install needed on the target machine):

```bash
bun run build          # → dist/tabbrew  (Mach-O / ELF for the current platform)
./dist/tabbrew --help
```

Cross-compile for another target with `--target` (see `bun build --help`), e.g.:

```bash
bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist/tabbrew-linux
```

## Releasing

Releases are **automated** — `.github/workflows/release.yml` builds and publishes on a
`v*` tag push; **do not hand-build release binaries** (a laptop build has no provenance
and isn't reproducible). Cutting a release is two steps:

1. Bump `package.json` `version` via PR → squash-merge to `main`. `VERSION` is read from
   `package.json` at compile time (`ui.ts`), so this bump is what makes `tabbrew update`
   see a newer build.
2. Tag `main` and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The workflow then runs on one `ubuntu-latest` runner (Bun cross-compiles all targets —
no OS matrix) and:
- builds the four targets — asset names are `tabbrew-<os>-<arch>` and **must** match
  `assetName()` in `update.ts` and `install.sh` exactly;
- writes `checksums.txt` (`<sha256>  <asset>` lines — the format `update.ts`'s
  `downloadAndVerify` and `install.sh` both parse);
- records a signed **SLSA build-provenance** attestation via
  `actions/attest-build-provenance` (keyless Sigstore over OIDC), so a download can be
  verified with `gh attestation verify <bin> --repo colevels/tabbrew-cli`;
- creates the GitHub Release with `gh release create --generate-notes` + the assets.

Constraints worth preserving:
- The release must publish as the non-draft, non-prerelease **"latest"** so the
  `releases/latest` 302 redirect that `tabbrew update` follows resolves to it (the
  consumer side is the `update` subsystem above).
- **Bun is pinned** (`bun-version: 1.3.5`) in **both** `ci.yml` and `release.yml` for
  reproducible builds — bump the two together.
- The workflow needs `contents: write` (create the release), `id-token: write` (OIDC
  token the attestation signs with), and `attestations: write`.
- Manual fallback (only if Actions is down): build the four targets + `checksums.txt`
  locally and `gh release create vX.Y.Z --target main --generate-notes …` — but the
  result carries **no** provenance attestation, so prefer re-running the workflow.
