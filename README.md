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

This CLI does a few things:

- **Sign in** to your TabBrew account from the terminal — `login` / `whoami` / `logout`
- **Push HTML docs** (a plan, a report, a viewer) into the sidepanel Docs view — `docs push`
- **Work with your tabs** — export them from the extension, validate a generated TabBrew
  Script, and send it back for you to run — `tabs serve` / `tabs list` / `tabs check` / `tabs push`
- **Teach your AI agent** that TabBrew exists and how to generate tab scripts — `init` (installs the
  awareness doc *and* the `tabbrew-tabs` skill)

The payoff: an AI agent working in your repo generates a report as HTML and pushes it
straight into your browser's Docs view — or takes your open tabs, writes a validated
TabBrew Script, and drops it into the extension for you to run.

## Commands

```
TABS  organize your Chrome tabs
  tabs serve         Start the local bridge the extension exports your tabs to
  tabs list          Show the tabs the extension last exported
  tabs check <file>  Validate a TabBrew Script (--snapshot for a preview)
  tabs push <file>   Send a script to the extension to preview & run
  tabs prompt        Print the interactive TabBrew Script skill prompt

DOCS  send HTML into the sidepanel
  docs push <file>   Send an HTML file to the TabBrew sidepanel Docs view
  docs list          List the HTML docs you've pushed (titles are click-to-open)
  docs open <id>     Open a pushed HTML doc in your browser

ACCOUNT
  login              Sign in via OAuth device flow and store the token
  whoami             Print the signed-in user (exit 1 if signed out)
  logout             Delete the stored token

SETUP
  init               Set up an AI agent to use tabbrew (+ the tabs skill)
  update             Update the installed binary to the latest release
  help               Show this help
```

`tabbrew <cmd> --help` prints one command in depth — its options plus the caveat the
one-liner has no room for. `tabbrew help --all` prints everything: hidden commands,
every per-command flag, and the environment overrides.

Every `tabs` command is offline except `push`/`serve`, which only ever talk to
`127.0.0.1`. **None of them can change your tabs** — the browser does that, after you
click **Run**.

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

Every release is built in GitHub Actions — not on a laptop — and carries a signed SLSA
**build-provenance** attestation tying the binary to the exact commit and workflow run.
Verify a download with the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify tabbrew-darwin-arm64 --repo colevels/tabbrew-cli
```

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

`init` also installs the **`tabbrew-tabs` skill** (the interactive prompt that teaches
the agent to generate TabBrew Scripts) into the agent's skills dir —
`./.claude/skills/tabbrew-tabs/SKILL.md` locally, `~/.claude/skills/…` with `--global`.
Pick a smaller prompt with `--variant standard|compact` (default `full`), or skip it with
`--no-skill`. `--uninstall` removes it too. (You can also install the skill standalone
with `npx skills add colevels/tabbrew-skill`, the plugin form — the two are complementary.)

## Managing tabs (`tabs check` / `tabs prompt`)

An AI agent already running in your terminal can generate a **TabBrew Script** itself —
no server round-trip. This CLI is the local toolbox around that: it teaches the agent the
DSL (`init` / `tabs prompt`) and validates what it produced (`tabs check`). It never reads
or changes your tabs — the browser does that.

The copy-paste loop (no bridge, no automation of your browser). If you'd rather not
copy-paste, [the local bridge](#the-local-bridge-tabs-serve--tabs-push) does the same
round trip over `127.0.0.1`:

1. In the extension, click **Copy AI Prompt** and paste the result into your agent (it
   contains your live tabs as `# Windows` / `# Groups` / `# Tabs` sections).
2. The agent, following the installed `tabbrew-tabs` skill, generates a `` ```tabbrew `` block.
3. Validate it locally before running:

   ```bash
   tabbrew tabs check script.txt                       # parse only — syntax, unknown verbs, DEL count
   tabbrew tabs check script.txt --snapshot snap.md    # + before/after preview from the pasted snapshot
   printf 'DEL 101 102\nGROUP 103 104 "Code"\n' | tabbrew tabs check -   # or pipe it (accepts a fenced block)
   ```

   `check` exits non-zero on any parse error (with line numbers), so it drops into scripts
   and pre-run gates. `--json` emits `{ ok, ops, errors, stats, preview }`. The `--snapshot`
   argument accepts the Copy-AI-Prompt markdown **or** a raw `SnapshotPayload` `.json`.

4. Paste the validated script into the extension's developer mode and click **Run** —
   execution happens in the browser.

`tabbrew tabs prompt [--variant full|standard|compact]` prints the same interactive skill
prompt `init` installs — handy to `pbcopy` into a chat AI or inspect it.

> The preview is a **directional** simulation (it mirrors the extension's phase order:
> `DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE`), not a byte-exact prediction of Chrome's
> final layout. It's meant to catch mistakes — wrong ids, surprise closes, stale ids — not
> to replace running the script.

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

**Auth.** These endpoints use the same OAuth **login token** as the rest of the
CLI — `docs push` authenticates with `Authorization: Bearer` (from `tabbrew login`,
or `TABBREW_TOKEN` for CI/CD), exactly like `whoami` and `docs list`. If you aren't
logged in, or the token is rejected with a 401, run `tabbrew login`.

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

Like `docs push`, the list route authenticates with the **OAuth login token** —
the same one `whoami` uses. Every `/api/v1/html_files/*` route the CLI calls now
accepts the bearer.

## The local bridge (`tabs serve` / `tabs push`)

The bridge replaces the copy-paste round trip with a loopback one. `tabbrew tabs
serve` starts a small HTTP server on `127.0.0.1` that does two things: the
extension **POSTs your open tabs to it** (saved as JSON on disk), and it **hands
back a script** you send with `tabbrew tabs push`.

```bash
tabbrew tabs serve                   # listens on 127.0.0.1:49227 — leave it running
tabbrew tabs serve --out ./tabs.json # save somewhere other than the default
```

Then, in Chrome, click **Send to Claude Code** in the sidepanel (or **Send to CLI**
in Developer mode → Tab List). Your tabs land on disk:

```bash
tabbrew tabs list          # human-readable, with how stale the export is
tabbrew tabs list --json   # { "savedAt": "…", "count": 2, "tabs": [ /* … */ ] }
```

Hand a script back the same way. `tabs push` validates it first (the same parse
step as `tabs check`) and then queues it; the extension picks it up while its
**Developer mode → TabBrew Script** panel is connected, and shows it to you as a
preview:

```bash
tabbrew tabs push ./group-tabs.txt
```

**`tabs push` does not run anything.** It has no access to your browser — the
script sits in the panel until *you* click **Run**. That's the whole reason this
command isn't called `run`.

### Ports

Both commands default to **49227** and take a matching `--port` (or
`TABBREW_SERVE_PORT`) — if they disagree, `tabs push` reports that nothing is
listening rather than quietly sending your script somewhere else.

⚠️ **The extension only ever talks to 49227.** The port is baked into its
`optional_host_permissions`, so a non-default port works for your own scripts but
reads as "bridge isn't running" in the UI. Change it only if 49227 is taken, and
expect the extension side not to follow.

### Security model

A departure from every other command, which is OAuth-gated: `tabs serve` binds
**`127.0.0.1` only** (hardcoded, not configurable) and requires **no token** — the
loopback-only bind is the entire boundary against the network. Anything already
running as you on this machine can reach it.

Two header checks keep a *browser* from being used as the way in:

- **`Host` must be `127.0.0.1:<port>` or `localhost:<port>`.** This is what stops
  [DNS rebinding](https://en.wikipedia.org/wiki/DNS_rebinding): a page on
  `http://evil.com` whose DNS is flipped to `127.0.0.1` reaches this server while
  keeping its own origin, making its requests *same-origin* — and browsers omit
  `Origin` on same-origin GETs, so the check below alone would let it read a
  queued script. The browser sets `Host` from the URL the page asked for, and
  page JS can't forge it (it's a forbidden header name).
- **`Origin`, when present, must be `chrome-extension://…`.** Browsers always
  attach `Origin` to non-GET requests, so this is what blocks a drive-by
  `POST /tabs` from writing to your disk.

Neither affects `curl` or scripts run by you, which address `127.0.0.1` directly
and send no `Origin`.

The saved `tabs.json` is written **`chmod 600`**, like `credentials.json` — it
holds the URL and title of every open tab, which is browsing history and doesn't
become un-leaked the way a revoked token does.

A queued script is claimed by exactly one poll, so if the extension isn't
connected yet it simply waits; pushing again replaces whatever is still pending.

## Credentials

- Stored at `~/.config/tabbrew/credentials.json` — **not** in the project folder.
- The file is written with, and re-asserted to, `chmod 600` on every save.
- `TABBREW_TOKEN` overrides the stored file, so CI/CD never needs to run `login`.
- Any authenticated request that returns **401** stops with a clear
  "your session has expired, run `login` again" message (worded differently for
  env-var tokens vs. stored tokens).
