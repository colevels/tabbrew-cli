# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/colevels/tabbrew-cli?sort=semver)](https://github.com/colevels/tabbrew-cli/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A5%201.1-000?logo=bun&logoColor=white)](https://bun.sh)

The command-line companion to **TabBrew** — it brings your TabBrew account to the
terminal and to the AI coding agents working there.

TabBrew is a Chrome extension that manages your browser tabs with natural-language
Scripts — *"tidy up my tabs"*, *"close duplicates"*, *"group my shopping tabs"* — and
has a sidepanel **Docs** view for reading plans, reports, and other HTML docs.

This CLI does three things:

- **Sign in** to your TabBrew account from the terminal — `login` / `whoami` / `logout`
- **Push HTML docs** (a plan, a report, a viewer) into the sidepanel Docs view — `docs push`
- **Teach your AI agent** that TabBrew exists so it can drive the CLI for you — `init`

The payoff: an AI agent working in your repo generates a report as HTML and pushes it
straight into your browser's Docs view, where you read it.

## Commands

```
login              Sign in via OAuth device flow and store the token
logout             Delete the stored token
whoami             Verify the token works and print the user profile
tools repo-info    Demo: shell out to `git` (only if installed) to report repo stats
docs push <file>   Send an HTML file to the TabBrew sidepanel Docs view
docs list          List the HTML docs you've pushed (titles are click-to-open)
docs open <id>     Open a pushed HTML doc in your browser
init               Install tabbrew-cli awareness into an AI agent (Claude Code)
update             Update the installed binary to the latest release
help               Show usage
```

## Install

### Prebuilt binary (recommended)

Install the latest release for macOS or Linux — no Bun required:

```bash
curl -fsSL https://raw.githubusercontent.com/colevels/tabbrew-cli/main/install.sh | sh
```

The script picks the right binary for your OS/arch, verifies its SHA-256 checksum, and
installs `tabbrew` to `~/.local/bin` (override with `TABBREW_INSTALL_DIR`). Prefer to look
before you pipe? Read [`install.sh`](./install.sh), or download a binary directly from the
[releases page](https://github.com/colevels/tabbrew-cli/releases/latest).

Confirm it landed with `tabbrew --version`. From then on you never need the installer
again — `tabbrew update` upgrades the binary in place (see [Updating](#updating)).

### From source

Requires Bun ≥ 1.1.

```bash
git clone https://github.com/colevels/tabbrew-cli && cd tabbrew-cli
bun install
```

Run directly during development:

```bash
bun run src/index.ts --help   # or: bun start -- --help
```

Install it as a global `tabbrew` command on your PATH:

```bash
bun link          # registers this package; symlinks the bin into ~/.bun/bin
tabbrew --help
bun unlink        # to remove it later
```

## Updating

If you installed the prebuilt binary, `tabbrew update` upgrades it in place — no
need to re-run the installer:

```bash
tabbrew update --check   # report current vs latest; change nothing (--json for scripting)
tabbrew update           # download the latest release, verify its checksum, swap in place
```

`update` resolves the newest release from the `releases/latest` redirect (no API
token, no rate limit), downloads the binary for your OS/arch, verifies its
SHA-256 against `checksums.txt` (same as `install.sh`), and atomically replaces
the running executable. It's a no-op when you're already current, and it only
works on the installed binary — from a source checkout, use `git pull && bun run
build`. Point `TABBREW_REPO` / `TABBREW_RELEASE_URL` / `TABBREW_DOWNLOAD_BASE_URL`
elsewhere to update from a fork or mirror.

## Usage

```bash
# 1. (Optional) point at a custom server — defaults to https://www.tabbrew.com
export TABBREW_BASE_URL="https://your-auth-server.example.com"

# 2. Sign in — prints a user code + URL, opens your browser, then polls
tabbrew login

# 3. Confirm the token works and see who you are
tabbrew whoami

# 4. External-tool demo — shells out to git only if it's installed
tabbrew tools repo-info

# 5. Send an HTML file to the Docs view (local register by default; --cloud uploads it)
tabbrew docs push ./some.html
tabbrew docs push ./some.html --cloud

# 6. List the docs you've pushed (⌘/Ctrl-click a title to open), or open one by id
tabbrew docs list
tabbrew docs list --json
tabbrew docs open 12

# 7. Keep the binary current
tabbrew update --check           # is there a newer release?
tabbrew update                   # download, verify checksum, replace in place

# 8. Sign out
tabbrew logout
```

CI/CD (no interactive login):

```bash
export TABBREW_TOKEN="ey…"       # injected secret
export TABBREW_BASE_URL="https://your-auth-server.example.com"
tabbrew whoami                   # exits non-zero on a 401
```

Configuration is env-var driven (all `TABBREW_*`), so the same binary can target prod,
staging, or a local server. See **[CLAUDE.md → Configuration](./CLAUDE.md#configuration)**
for the full variable list and the server contract.

## Agent awareness (`init`)

`tabbrew init` teaches an AI coding agent (Claude Code) that this CLI exists and
how to drive it — awareness-only (no command-rewriting hook). It writes two artifacts:

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

## Docs view (`docs push` / `docs list`)

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

### Listing docs (`docs list`)

`tabbrew docs list` prints the docs on your account — id, title, kind
(`gcs`/`local`), size, and created date:

```bash
tabbrew docs list          # aligned table
tabbrew docs list --json   # raw JSON array (for scripting)
```

Each **title is a clickable link** — ⌘/Ctrl-click it (in a hyperlink-capable
terminal like iTerm2, Terminal.app, or VS Code) to open the doc in your default
browser. Prefer a command? Open any doc by id:

```bash
tabbrew docs open 12       # open doc #12 in your browser
```

`docs open` (and the clickable titles) open a **local** doc as `file://` and a
**cloud** doc via its owner-only `https://www.tabbrew.com/api/v1/html_files/<id>/view`
URL — so a cloud doc only renders in a browser you're signed in to tabbrew.com with
(i.e. your Chrome). Set `TABBREW_NO_BROWSER` to have `docs open` just print the URL
instead of launching a browser.

Unlike `docs push`, the list route already authenticates with the **OAuth login
token** — the same one `whoami` uses — so it needs no upload token. It's the
first `/api/v1/html_files/*` route to accept the bearer; `push` follows next.

## Credentials

- Stored at `~/.config/tabbrew/credentials.json` — **not** in the project folder.
- The file is written with, and re-asserted to, `chmod 600` on every save.
- `TABBREW_TOKEN` overrides the stored file, so CI/CD never needs to run `login`.
- Any authenticated request that returns **401** stops with a clear
  "your session has expired, run `login` again" message (worded differently for
  env-var tokens vs. stored tokens).
