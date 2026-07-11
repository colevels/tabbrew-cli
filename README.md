# tabbrew-cli

A small [Bun](https://bun.sh) + TypeScript CLI for testing connectivity to a
TabBrew server that speaks the **OAuth 2.0 Device Authorization Grant**
([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)).

It has no external dependencies — argument parsing is `parseArgs` from `node:util`,
HTTP is the global `fetch`, and the external-tool demo uses Bun's shell (`Bun.$`).

```
login              Sign in via OAuth device flow and store the token
logout             Delete the stored token
whoami             Verify the token works and print the user profile
tools repo-info    Demo: orchestrate `git` (checked with which()) to report repo stats
docs push <file>   Send an HTML file to the TabBrew sidepanel Docs view
init               Install tabbrew-cli awareness into an AI agent (Claude Code)
help               Show usage
```

## Install

Requires Bun ≥ 1.1.

```bash
cd tabbrew-cli
bun install
```

Run directly during development:

```bash
bun run src/index.ts --help
# or
bun start -- --help
```

Install it as a global command (`tabbrew`) on your PATH:

```bash
bun link          # registers this package; symlinks the bin into ~/.bun/bin
tabbrew --help
bun unlink        # to remove it later
```

## Configure

Everything is driven by environment variables, so the same binary can point at
prod, staging, or a local server. The defaults target the hosted TabBrew server
at `https://www.tabbrew.com`:

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

## Agent awareness (`init`)

`tabbrew init` teaches an AI coding agent (Claude Code) that this CLI exists and
how to drive it — patterned after [`rtk init`](https://github.com/rtk-ai/rtk) but
awareness-only (no command-rewriting hook). It writes two artifacts:

- a slim `TABBREW-CLI.md` "how to use tabbrew-cli" doc, and
- a version-tagged managed block in `CLAUDE.md` that imports it via `@TABBREW-CLI.md`:

  ```md
  <!-- tabbrew-cli-instructions v1 -->
  ## tabbrew-cli (agent CLI)
  …
  @TABBREW-CLI.md
  <!-- /tabbrew-cli-instructions -->
  ```

```bash
tabbrew init                 # local: write ./CLAUDE.md + ./TABBREW-CLI.md
tabbrew init --global        # write to ~/.claude (or $CLAUDE_CONFIG_DIR)
tabbrew init --dry-run       # print what would change; write nothing
tabbrew init --uninstall     # remove the block + delete the awareness doc
tabbrew init --yes           # skip the confirm prompt when editing an existing file
tabbrew init --agent claude  # target agent (default; only claude supported so far)
```

Behavior: idempotent (re-runs report `unchanged`), writes are atomic, an existing
`CLAUDE.md` is copied to `CLAUDE.md.bak` before it's edited, the managed block is
matched by a version-less marker so upgrades replace in place (never duplicate), and a
malformed (unterminated) block makes `init` refuse rather than guess. Editing an
existing `CLAUDE.md` prompts for confirmation (default **No**); non-interactive shells
decline unless `--yes` is passed, so it's safe in CI. The `AgentTarget` registry in
`src/agents.ts` is the seam for adding Cursor/Codex/Gemini later.

## Docs view (`docs push`)

`tabbrew docs push <file>` sends an HTML file (a plan doc, report, or viewer) to
TabBrew so it opens from the sidepanel **Docs** view. Two modes:

```bash
tabbrew docs push ./plan.html                    # local (default)
tabbrew docs push ./report.html --cloud          # upload the content (≤ 2 MB)
tabbrew docs push ./doc.html --title "Auth plan" # override the Docs-list title
```

- **local** (default): registers the file's **absolute path** only — the file
  stays on this machine and TabBrew opens it as `file://`. (Opening it from the
  extension needs "Allow access to file URLs" enabled.)
- **cloud** (`--cloud`): uploads the content to private storage (max **2 MB**;
  the CLI checks this before sending) and prints an owner-only view URL.

The title defaults to the document's `<title>`, falling back to the filename.

**Auth.** These endpoints are moving to the same OAuth login token as the rest of
the CLI, so `docs push` tries the **login token** (`Authorization: Bearer`) first
and falls back to a legacy per-feature **upload token** if the server rejects the
bearer with 401. The upload token is read from `TABBREW_UPLOAD_TOKEN` (wins) or
`~/.config/tabbrew/upload-token`; generate one at
`https://www.tabbrew.com/profile`. Once the server accepts the bearer for
`/api/v1/html_files/*` the fallback becomes dead code and can be removed.

## Credentials

- Stored at `~/.config/tabbrew/credentials.json` — **not** in the project folder.
- The file is written with, and re-asserted to, `chmod 600` on every save.
- `TABBREW_TOKEN` overrides the stored file, so CI/CD never needs to run `login`.
- Any authenticated request that returns **401** stops with a clear
  "your session has expired, run `login` again" message (worded differently for
  env-var tokens vs. stored tokens).

## Testing each subcommand

```bash
# 1. Point at your server
export TABBREW_BASE_URL="https://your-auth-server.example.com"

# 2. Sign in — prints a user code + URL, opens your browser, then polls
tabbrew login

# 3. Confirm the token works and see who you are
tabbrew whoami

# 4. External-tool demo — shells out to git only if it's installed
tabbrew tools repo-info

# 5. Send an HTML file to the Docs view (local register, then cloud upload)
tabbrew docs push ./some.html
tabbrew docs push ./some.html --cloud

# 6. Sign out
tabbrew logout
```

CI/CD (no interactive login):

```bash
export TABBREW_TOKEN="ey…"       # injected secret
export TABBREW_BASE_URL="https://your-auth-server.example.com"
tabbrew whoami               # exits non-zero on a 401
```

## Build a single binary

`bun build --compile` bundles the runtime + your code into one self-contained
executable (no Bun install needed on the target machine):

```bash
bun run build          # → dist/tabbrew  (Mach-O / ELF for the current platform)
./dist/tabbrew --help
```

Cross-compile for another target with `--target` (see `bun build --help`), e.g.:

```bash
bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist/tabbrew-linux
```

## Project layout

```
src/
  index.ts            # command router — Bun.argv + parseArgs, single error boundary
  config.ts           # env-driven configuration (base URL, client id, endpoints)
  auth.ts             # OAuth device-flow logic (request code, poll, pending/slow_down)
  credentials.ts      # token storage (~/.config, chmod 600) + env-var override
  api.ts              # authed fetch wrapper + 401 handling + userinfo + html_files client
  util.ts             # sleep, which(), safeText, open-browser
  ui.ts               # colors, help text, version
  agents.ts           # init: AgentTarget registry (Claude Code; extensible)
  awareness.ts        # init: bundled awareness doc + managed-block string ops
  fsops.ts            # init: atomic write, writeIfChanged, backup, safe read/remove
  commands/
    login.ts logout.ts whoami.ts tools.ts docs.ts init.ts
```
