# tabbrew-cli

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

## Usage

```bash
# 1. Point at your server (defaults to https://www.tabbrew.com)
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
tabbrew whoami                   # exits non-zero on a 401
```

Configuration is env-var driven (all `TABBREW_*`), so the same binary can target prod,
staging, or a local server. See **[CLAUDE.md → Configuration](./CLAUDE.md#configuration)**
for the full variable list and the server contract.

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
