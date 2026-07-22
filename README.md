# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/colevels/tabbrew-cli?sort=semver)](https://github.com/colevels/tabbrew-cli/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A5%201.1-000?logo=bun&logoColor=white)](https://bun.sh)

> **Status: proof of concept.** `v0.6.0` was the high-water mark of the exploration;
> `v0.7.0` is where the subtraction started. **`tabs check`, `tabs push`, `tabs watch`,
> `tabs history` and `tabs prompt` are gone**, and the `--port`, `--out` and `--variant`
> flags with them — the tab surface is three commands now (`serve` / `list` / `suggest`).
> `init` follows: it installs one skill instead of two, and deletes the orphaned
> `tabbrew-auto` it finds. `docs`, `login`/`whoami`/`logout` and `update` are untouched. Pin
> [`v0.6.0`](https://github.com/colevels/tabbrew-cli/releases/tag/v0.6.0) if you depend
> on a command that disappeared; some of them may come back in a simpler shape.

The command-line companion to **TabBrew** — it brings your TabBrew account to the
terminal and to the AI coding agents working there.

TabBrew is a Chrome extension that manages your browser tabs with natural-language
Scripts — *"tidy up my tabs"*, *"close duplicates"*, *"group my shopping tabs"* — and
has a sidepanel **Docs** view for reading plans, reports, and other HTML docs.

This CLI does a few things:

- **Sign in** to your TabBrew account from the terminal — `login` / `whoami` / `logout`
- **Push HTML docs** (a plan, a report, a viewer) into the sidepanel Docs view — `docs push`
- **Work with your tabs** — the extension sends your open tabs to a local bridge, your
  agent reads them and proposes a TabBrew Script with a one-sentence note, and you
  **Accept** or **Deny** it in the sidepanel — `tabs serve` / `tabs list` / `tabs suggest`
- **Teach your AI agent** that TabBrew exists and how to generate tab scripts — `init` (installs the
  awareness doc *and* the `tabbrew-tabs` skill)

The payoff: an AI agent working in your repo generates a report as HTML and pushes it
straight into your browser's Docs view — or reads your open tabs, writes a validated
TabBrew Script, and puts it in the sidepanel for you to accept.

## Commands

```
TABS  organize your Chrome tabs
  tabs serve           Start the local bridge the extension exports your tabs to
  tabs list            Show the tabs the extension last sent, and recent answers
  tabs suggest <file>  Propose a script, with a note they read before deciding

DOCS  send HTML into the sidepanel
  docs push <file>     Send an HTML file to the TabBrew sidepanel Docs view
  docs list            List your pushed docs (titles are click-to-open)
  docs open <id>       Open a pushed HTML doc in your browser

ACCOUNT
  login                Sign in via OAuth device flow and store the token
  whoami               Print the signed-in user (exit 1 if signed out)
  logout               Delete the stored token

SETUP
  init                 Set up an AI agent to use tabbrew (+ the tabs skill)
  update               Update the installed binary to the latest release
  help                 Show this help
```

`tabbrew <cmd> --help` prints one command in depth — its options plus the caveat the
one-liner has no room for. `tabbrew help --all` prints everything: hidden commands,
every per-command flag, and the environment overrides.

`tabs list` only reads a file on disk; `tabs serve` and `tabs suggest` only ever talk to
`127.0.0.1`. **None of them can change your tabs** — the browser does that, after you press
**Accept**.

Prefer a picture? [`docs/commands.html`](./docs/commands.html) is a single-page visual map
of the whole surface — every command colour-coded by how far it reaches, the tab loop as a
diagram, the bridge's routes, and the six-verb Script grammar.

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

`init` also installs the **`tabbrew-tabs`** skill into the agent's skills dir
(`./.claude/skills/tabbrew-tabs/SKILL.md` locally, `~/.claude/skills/…` with `--global`).
It is the loop written down: read `tabs list` → decide (**default: do nothing**) → write
the ops → `tabs suggest --note` → read the verdict on the next pass, plus the rules for
writing a note and for treating a denial as a standing instruction.

There used to be two skills — an interactive one and a separate `tabbrew-auto` watch
loop — which disagreed on purpose about whether to confirm a `DEL` in chat. With the
Accept/Deny card being the confirmation either way, a one-off request and a standing watch
are the same three steps, so there is one skill and no `--variant` flag. `init` **deletes
an orphaned `tabbrew-auto` directory** it finds (on install as well as `--uninstall`),
because that skill tells the agent to run `tabs watch`, which no longer exists.

`--no-skill` skips the install; `--uninstall` removes everything.

The skill installed here is written for an agent with a terminal — it runs commands and
reads their output. If you want the **chat-shaped** version instead, the one you paste
into ChatGPT, Gemini, or claude.ai alongside the extension's **Copy AI Prompt** output,
that lives in its own package: `npx skills add colevels/tabbrew-skill`. Same DSL, no CLI.

## The tab loop (`tabs serve` / `tabs list` / `tabs suggest`)

Three commands, one direction of travel. The extension pushes your open tabs down to a
loopback bridge; your agent reads them and proposes a TabBrew Script with a sentence
explaining it; you press **Accept** or **Deny** in the sidepanel; the answer comes back on
the next read. The CLI is on one side of that loop only — **it cannot change a tab**.

```
  Chrome  ──── your tabs ─────▶  tabs serve ──▶ tabs.json ──▶  tabs list
  Chrome  ◀──── a script ─────   tabs serve  ◀───────────────  tabs suggest --note
  Chrome  ──── Accept/Deny ───▶  tabs serve ──▶ tabs.json ──▶  tabs list   (next pass)
```

### 1. Start the bridge

```bash
tabbrew tabs serve                            # 127.0.0.1:49227 (or :49228) — blocks until Ctrl+C
TABBREW_TABS_PATH=./tabs.json tabbrew tabs serve   # put the state file elsewhere
```

`TABBREW_TABS_PATH` is the only way to move that file, and it has to be set for
`tabs list` and `tabs suggest` too — they read the same path. A `--out` flag used to move
just the writer, which left the other two silently reading a stale default; it's gone for
the same reason `--port` is.

It blocks, so give it its own shell (or the background). Then, in Chrome, open the
TabBrew sidepanel and click **Connect to TabBrew CLI** — leave that screen open and it
keeps sending tabs as they change; navigate away and it stops. There is no toggle to
find. (Developer mode → Tab List → **Send to CLI** exports too, but without the rendered
snapshot — see below.)

If `49227` is already taken by something else, the bridge falls back to `49228` and says
so; Chrome checks both. If it's taken by *another TabBrew bridge*, it refuses to start a
second one instead — Chrome always uses the lowest port that answers, so the second would
never receive anything.

### 2. Read the tabs

```bash
tabbrew tabs list          # header, recent answers, then the snapshot
tabbrew tabs list --json   # the raw saved payload
```

```
4 tabs · 1 window · v1 · exported just now

# Cross-window: no
# Windows
{"id":1,"focused":true,"tabCount":4}
# Groups
# Tabs
{"id":901,"idx":0,"pinned":true,"winId":1,"title":"Gmail","url":"https://mail.google.com/"}
{"id":4310,"idx":1,"winId":1,"title":"colevels/tabbrew","url":"https://github.com/colevels/tabbrew"}
{"id":4311,"idx":2,"winId":1,"title":"Pull requests","url":"https://github.com/pulls"}
{"id":4471,"idx":3,"winId":1,"title":"YouTube","url":"https://youtube.com/watch?v=…"}
```

That snapshot is the extension's **own** rendering, printed verbatim — not a table this
CLI builds. Two reasons: it's the exact format the skill is written against, so the agent
reads it without a translation step, and the CLI can never drift from what the extension
shows. An export that arrives without one (the developer-mode panel, or an older build)
says so rather than falling back to a second renderer.

It's a file on disk, not a live query, which is why the header prints how old it is — and
why an export older than five minutes also prints a staleness warning **on stderr**, where
it won't land in the middle of the snapshot an agent is parsing.

### 3. Propose a change

Write the ops to a file — one verb per line, `#` for comments:

```bash
cat > /tmp/plan.txt <<'EOF'
DEL 4471
GROUP 4310 4311 "Code"
EOF

tabbrew tabs suggest /tmp/plan.txt \
  --note "ปิดแท็บ YouTube 1 อัน แล้วรวม github 2 แท็บเป็นกลุ่ม Code"
```

```
✓ Sent (2 ops) — it's waiting for Accept or Deny in the TabBrew sidepanel.
  Nothing has changed in your browser yet. Run `tabbrew tabs list` later to see what they decided.
```

The six verbs are `DEL` / `PIN` / `UNPIN` / `GROUP` / `UNGROUP` / `MOVE`; the installed
skill has the full grammar. `suggest` parses the script first and refuses to send a broken
or empty one — parse errors print with line numbers and exit 1:

```
✗ 1 parse error:
  line 1: DELL 1
            → unknown verb "DELL"
```

`--note` is **required**. It's the only thing most people read before deciding, so a
suggestion nobody asked for has to explain itself — in their language, leading with
anything that closes tabs. The script can also come from stdin (`tabs suggest -`, which
accepts a whole `` ```tabbrew `` block), and `--json` prints
`{ ok, id, opCount, basedOn }` instead of the two lines above.

**It returns as soon as the bridge has the script — it does not wait for an answer.**
Earlier versions held the socket open across a human decision, which is a bad shape for
both ends: the agent burns a turn blocking on someone who has gone to lunch, and the
bridge grows long-polling to serve it. The extension polls on its own timer and the
verdict is recorded on disk instead.

### 4. Read the answer on the next pass

```bash
tabbrew tabs list
```

```
4 tabs · 1 window · v1 · exported just now

recent suggestions
  2 minutes ago  DENIED  ปิดแท็บ YouTube 1 อัน แล้วรวม github 2 แท็บเป็นกลุ่ม Code — "อย่าปิด youtube เปิดฟังเพลงอยู่"
```

`tabs.json` keeps a ring of the **newest 5** suggestions — id, note, op count, the tab
version it was written against, and what became of it. Once the extension has sent tabs at
least once, it survives both a tab change and a restart of `tabs serve` — it's the agent's
only memory of what you already said no to, and without it a loop re-proposes the thing you
just rejected, forever.

| State | Meaning |
| --- | --- |
| `PENDING` | Not answered yet. Wait — don't pile a second proposal on the first. |
| `ACCEPTED` | It ran. The tabs have actually moved; re-read before planning anything else. |
| `DENIED` | With a reason, if one was given. A standing rule, not a one-off no. |
| `STALE` | The tabs changed before it could run, so it never applied. |
| `FAILED` | You said yes and Chrome refused. The tabs are unchanged. |

`FAILED` exists because the alternative — recording `accepted` for a batch that errored —
tells a watching agent its plan worked when nothing moved, and it will happily build the
next suggestion on that fiction.

### A worked pass with Claude Code

The three steps are one turn, whether you asked once or asked for a standing watch. In one
shell:

```bash
tabbrew tabs serve
```

Then in Claude Code, for a one-off:

```
> tidy up my tabs
```

or, to keep it going, hand the pacing to Claude Code's `/loop`:

```
> /loop 10m watch my tabs and suggest tidy-ups
```

Each invocation is **one pass**: read `tabs list`, decide, maybe suggest, report in a line,
stop. The skill deliberately does not `sleep`, poll, or re-invoke itself — a loop inside a
loop just burns tokens. And the default decision is to do nothing: a high tab count is not
a problem, 200 open tabs may be exactly how you work.

### The bridge

`tabs serve` speaks **protocol 3** (echoed by `GET /health`) over five plain
request/response routes — nothing long-polls:

| Route | Who calls it | What it does |
| --- | --- | --- |
| `POST /tabs` | extension | Save the current tab state (bumps `version`) |
| `POST /suggestion` | `tabs suggest` | Queue a script (one at a time; a new one replaces it) |
| `GET /suggestion` | extension | **Pops** the queued script — claimed by exactly one poll |
| `POST /decision` | extension | Record accepted / denied / stale / failed |
| `GET /health` | extension | Reachability + protocol version |

Both ends of this bridge move independently — the extension updates through the Web Store,
the CLI through `tabbrew update` — so neither may assume the other is current. All four
routes a protocol-2 extension actually calls (`POST /tabs`, `GET /suggestion`,
`POST /decision`, `GET /health`) are unchanged; what protocol 3 dropped is the three long
polls only the CLI ever issued, and the legacy `/script` pair.

**There is no `--port` flag.** The extension lists exactly `49227` and `49228` in both
manifests' `optional_host_permissions`, so a bridge listening anywhere else is unreachable
from the browser — a flag that could only ever produce a broken setup isn't worth having.
`tabs serve` picks the first of the two that's free and `tabs suggest` finds whichever is
answering, so neither end has to be told. `TABBREW_SERVE_PORT` pins a single port, for
tests.

Both ends verify **identity**, not just reachability: `GET /health` returns
`service: "tabbrew-bridge"`, and a port that answers without proving it's a bridge is
skipped rather than adopted. That check is what makes a second port safe — otherwise any
JSON service squatting on `49228` would be handed a script describing your tabs.

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

The saved `tabs.json` is written **`chmod 600`**, like `credentials.json` — it holds the
URL and title of every open tab, which is browsing history and doesn't become un-leaked
the way a revoked token does. It is also the *only* thing the CLI keeps: it's overwritten
on every export and holds just the currently-open tabs. (v0.6.0's `tabs-history.jsonl`
delta log, which remembered tabs you had since closed, is gone along with `tabs history`.)

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

## Testing each subcommand

`bun test` covers only the pure functions (help layout, display width); everything that
touches the network, the filesystem, or a terminal is verified by hand. There's no
mock server — point the binary at a real one:

```bash
export TABBREW_BASE_URL="http://localhost:3000"   # or your staging deploy
export TABBREW_TOKEN="tbcli_…"                    # skip the interactive login
bun run src/index.ts whoami
bun run src/index.ts docs push ./fixture.html --title "Test"
bun run src/index.ts docs list --json
```

The three `tabs` commands need no server at all — just the bridge and something
speaking to it. Give the run its own port and state file so it can't disturb yours:

```bash
export TABBREW_SERVE_PORT=49999
export TABBREW_TABS_PATH=/tmp/tabs-test.json

bun run src/index.ts tabs serve &                 # 1. the bridge

curl -s -X POST http://127.0.0.1:49999/tabs \
  -H 'content-type: application/json' \
  -H 'origin: chrome-extension://test' \
  -d '{"tabs":[{"id":901,"title":"Gmail","url":"https://mail.google.com/","windowId":1}],
       "windows":[{"id":1}],"snapshot":"# Tabs\n{\"id\":901,\"idx\":0,\"winId\":1}"}'

bun run src/index.ts tabs list                    # 2. what the extension "sent"

printf 'DEL 901\n' | bun run src/index.ts tabs suggest - --note "close Gmail"   # 3. propose

curl -s http://127.0.0.1:49999/suggestion         # play the extension: pop it,
curl -s -X POST http://127.0.0.1:49999/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"denied","reason":"reading it"}'                              #    then answer

bun run src/index.ts tabs list                    # 4. DENIED, with the reason
```

Two things to remember while doing this by hand: the bridge rejects a request whose
`Host` isn't `127.0.0.1:<port>`/`localhost:<port>` (so address it by IP, not by a name
that resolves there), and `GET /suggestion` **pops** — the second call returns 204.

`tabs serve` blocks until Ctrl+C, so background it or use a second shell.
`tabbrew update --check` works from a source checkout, but the swap refuses to run there
(it would overwrite `bun` itself) — test that against a compiled `dist/tabbrew`, with
`TABBREW_REPO` / `TABBREW_RELEASE_URL` pointed at a fork.

## Credentials

- Stored at `~/.config/tabbrew/credentials.json` — **not** in the project folder.
- The file is written with, and re-asserted to, `chmod 600` on every save.
- `TABBREW_TOKEN` overrides the stored file, so CI/CD never needs to run `login`.
- Any authenticated request that returns **401** stops with a clear
  "your session has expired, run `login` again" message (worded differently for
  env-var tokens vs. stored tokens).
