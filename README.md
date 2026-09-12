# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/colevels/tabbrew-cli)](https://github.com/colevels/tabbrew-cli/releases/latest)
[![npm](https://img.shields.io/npm/v/tabbrew-cli)](https://www.npmjs.com/package/tabbrew-cli)

Manage Chrome tabs, windows and tab groups from the terminal: list them, open,
focus, move, group, discard, reload and close tabs, fold and close groups. Every verb
has `--json`, and `tabbrew init` writes a cheat sheet so an AI coding agent
working in your repo can drive the browser the same way.

It needs two things: the `tabbrew` binary, and the [TabBrew
extension](https://chromewebstore.google.com/detail/ikmpmkkcmhhnjmdiooekbhfmomcbefkf)
in Chrome, which the CLI talks to over `127.0.0.1`. The extension in this repo
is the CLI's **harness** for developing that protocol (see [Harness
extension](#harness-extension)); it is shipped as a zip with every release.

## What Tabbrew Does

Each command goes over `127.0.0.1` to the TabBrew extension, which runs it
against the Chrome you already have open and reports back. Nothing changes
unless a command names it.

| Command | What it does |
| --- | --- |
| `tabbrew session start` / `stop` | Start or stop the local session that links this terminal to Chrome |
| `tabbrew tabs list` | Every open tab across every window, one row each |
| `tabbrew tabs create` | Open a URL in a new background tab: at the end of a window, next to a tab, or inside a group |
| `tabbrew tabs focus` | Select a tab and raise its window |
| `tabbrew tabs move` | Put tabs next to another tab, across windows if needed |
| `tabbrew tabs group` | Gather tabs into a new or existing group, with title, colour and collapsed state |
| `tabbrew tabs discard` | Unload tabs from memory, keeping them on the tab strip |
| `tabbrew tabs reload` | Reload tabs in place, optionally bypassing the cache |
| `tabbrew tabs close` | Close tabs |
| `tabbrew windows list` | One row per open window, with tab and group counts |
| `tabbrew windows create` | Open a new window, empty or with URLs |
| `tabbrew groups list` | One row per tab group, with colour and collapsed state |
| `tabbrew groups collapse` / `uncollapse` | Fold or expand groups |
| `tabbrew groups close` | Close groups while Chrome keeps them among its saved groups |
| `tabbrew init` | Write a cheat sheet into `CLAUDE.md` / `AGENTS.md` so an AI agent can drive the browser |
| `tabbrew update` | Replace the installed binary with the latest release |

## Install

### Install script (macOS, Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/colevels/tabbrew-cli/main/install.sh | sh
```

Picks the binary for your OS and CPU from the latest release, verifies its
SHA-256 against `checksums.txt`, and installs `tabbrew` to `~/.local/bin`
(override with `TABBREW_INSTALL_DIR`). Read [`install.sh`](./install.sh) first
if you prefer.

### Prebuilt binary

Download `tabbrew-<os>-<arch>` from the [releases
page](https://github.com/colevels/tabbrew-cli/releases/latest), `chmod +x` it
and put it on your PATH. Every asset is built in GitHub Actions and carries a
SLSA build-provenance attestation; verify one with the [GitHub
CLI](https://cli.github.com):

```bash
gh attestation verify tabbrew-darwin-arm64 --repo colevels/tabbrew-cli
```

### npm

Requires [Bun](https://bun.sh) 1.1 or newer on the machine: the package ships
TypeScript that Bun runs directly.

```bash
npm install -g tabbrew-cli     # or: bun install -g tabbrew-cli
bunx tabbrew-cli --help        # one-off, no install
```

### From source

```bash
git clone https://github.com/colevels/tabbrew-cli && cd tabbrew-cli
bun install
bun link                       # puts `tabbrew` on your PATH, pointing at this checkout
```

## Set up the extension

Install [TabBrew](https://chromewebstore.google.com/detail/ikmpmkkcmhhnjmdiooekbhfmomcbefkf)
from the Chrome Web Store. That is all: `tabbrew session start` opens its
connection page by id.

To drive another build instead, the harness or an unpacked checkout of the
product, load it through `chrome://extensions` → **Developer mode** → **Load
unpacked** and set `TABBREW_EXTENSION_ID` to the id Chrome shows there, or
record it once for the project with `tabbrew init --extension <that id>`
(`--extension harness` for the harness, `--extension store` to go back), which
keeps it in `.tabbrew.json` next to the agent docs. The
harness is `tabbrew-extension.zip` on the [release that matches
`tabbrew --version`](https://github.com/colevels/tabbrew-cli/releases/latest);
its page tells you when the two drift apart.

## Quick start

```bash
tabbrew session start   # starts the local session and opens the connection page in Chrome
tabbrew tabs list       # every open tab, across every window
tabbrew init            # write the cheat sheet for AI agents into CLAUDE.md
```

The session exits on its own after 10 idle minutes; `tabbrew session start`
again brings it back. Nothing works while no extension page is open, and the
CLI never changes a tab that you did not name.

| Page shows | Meaning |
| --- | --- |
| No session | Nothing answered on either port. Run `tabbrew session start`. |
| Connected | Address, pid, CLI version and uptime of the session, and the last command the page served. It stays alive while the page is open. |

## Update

Installed the binary (install script or download):

```bash
tabbrew update --check   # current vs latest, changes nothing (--json for scripts)
tabbrew update           # download the latest release, verify its checksum, swap the binary in place
```

`update` reads the newest version from the `releases/latest` redirect (no API
token, no rate limit), downloads the asset for your OS and CPU, checks it
against `checksums.txt` and atomically replaces the running executable. It is
a no-op when you are current. `TABBREW_UPDATE_REPOSITORY`,
`TABBREW_UPDATE_LATEST_URL` and `TABBREW_UPDATE_DOWNLOAD_BASE_URL` point it at
a fork or mirror.

Installed from npm: `npm install -g tabbrew-cli@latest`. From source:
`git pull && bun run build`. `tabbrew update` refuses to touch either.

After any update, run `tabbrew session stop` then `tabbrew session start` so
the new version serves, load the matching `tabbrew-extension.zip` in
`chrome://extensions` (remove the old one first), and re-run `tabbrew init` in
repos that carry the cheat sheet.

## Uninstall

```bash
rm ~/.local/bin/tabbrew      # or wherever it was installed; npm: npm uninstall -g tabbrew-cli
rm -rf ~/.tabbrew            # session log
```

Then remove the extension in `chrome://extensions`.

## Commands

### Session

The session is a small HTTP server on `127.0.0.1` that links this terminal to
Chrome. `start` launches it in the background, opens the extension's
connection page in Chrome and returns once that page is serving; `run` keeps
the server in the foreground.

```bash
tabbrew session start          # spawn in the background, then open the connection page in Chrome
tabbrew session start --no-open  # spawn only
tabbrew session open           # (re)open the connection page for a running session
tabbrew session status         # where it is, pid, version, uptime, connected or not (exit 1 if none)
tabbrew session status --json
tabbrew session stop           # ask it to exit, wait until the port is free
tabbrew session run            # foreground, Ctrl-C to stop
```

It binds the first free port of `49227`, `49228` (the two the extension's
manifest may reach), answers `GET /health`, accepts `POST /stop` from local
processes only, and exits on its own after 10 minutes without use. An open
extension page polling `/health` counts as use; `tabbrew session status` from
a terminal does not, so a session nobody is looking at still goes away.
Background output goes to `~/.tabbrew/session.log`.

`open` launches `chrome-extension://<id>/connection.html` through `open -a
"Google Chrome"` on macOS, `google-chrome` on Linux and `start chrome` on
Windows, then waits up to 5 seconds for the page to hold the command channel.
The id is the Web Store extension's, so the CLI never has to ask Chrome for
it; `TABBREW_EXTENSION_ID`, else `extensionId` in the nearest `.tabbrew.json`
up from the current directory, names another build, such as the harness. Opening
the page twice is harmless: the second copy finds the first and closes itself.
When its session stops, the page closes itself too. Set `TABBREW_CHROME` to a
program that takes the URL as its only argument to use another browser or
profile.

Browser commands travel through the same server. A local process posts an
operator call (`POST /operators/<name>`, for instance `readSnapshot`); a
connected extension page (the connection page or the side panel) claims it by
long-polling `GET /requests/next`, runs it against Chrome, and posts the answer
to `POST /requests/<id>/result`; the call resolves with that answer. A call
nobody claims within 2 seconds fails with `no_panel`; a claimed call with no
result within 10 seconds fails with `timeout`; a poll with nothing to serve is
released empty after 25 seconds and the page polls again. `GET /health`
reports `listening: true` while a page holds the channel.
Only local processes may post calls, for the same reason only they may stop the
session.

Environment overrides, mainly for tests:

| Variable | Meaning |
| --- | --- |
| `TABBREW_SESSION_PORTS` | comma-separated ports to try, in order |
| `TABBREW_SESSION_IDLE_MS` | idle time before the session exits |
| `TABBREW_SESSION_DIR` | where `session.log` is written |
| `TABBREW_SESSION_CLAIM_WAIT_MS` | how long a call waits for a page to claim it |
| `TABBREW_SESSION_OPERATOR_TIMEOUT_MS` | how long a claimed call waits for its result |
| `TABBREW_SESSION_LONG_POLL_MS` | how long a page's poll is held open |
| `TABBREW_SESSION_CONNECT_WAIT_MS` | how long `open` waits for the connection page |
| `TABBREW_CHROME` | program that opens the connection page, given its URL |
| `TABBREW_EXTENSION_ID` | extension whose connection page to open, instead of the Web Store one; overrides `.tabbrew.json` |

### Tabs

`tabbrew tabs list` prints every open tab, across every window, as the
extension sees it. It needs a session with a connected page, which
`tabbrew session start` sets up; without one it fails with "nothing is
connected to the session; run \"tabbrew session open\".

```bash
tabbrew tabs list              # one row per tab
tabbrew tabs list --json       # the raw snapshot: windows, groups, tabs
```

```
TAB   WINDOW  GROUP  FLAGS   URL              TITLE
1901  1842    -      active  mail.google.com  Inbox
1903  1842    7      -       github.com       Pull Request #42
1950  1843    -      -       newtab           New Tab
```

Rows are ordered by window, then by position in the tab strip. TAB, WINDOW and
GROUP are Chrome's ids (`-` when the tab is in no group); FLAGS is any of
`active`, `pinned`, `audible`, `muted`, `discarded`, `loading`, or `-`. The URL
column shows the host only, without a leading `www.`. TITLE comes last, where a
long one extends its own row instead of shifting the columns, and is capped at
60 columns with a trailing `…`; the full title and url, group titles and
colours, window focus and `lastAccessed` are all in `--json`.

`tabbrew tabs create` opens a tab. Without a url it opens a new tab page, and
without a placement flag Chrome puts it at the end of the current window. The
tab always opens in the background, so a script can build up a window without
the focus jumping around.

```bash
tabbrew tabs create https://example.com              # at the end of the current window
tabbrew tabs create example.com                      # a bare host is read as https://
tabbrew tabs create https://example.com --after 1901 # right after 1901, in its window
tabbrew tabs create --window 1843                    # a new tab page, at the end of window 1843
tabbrew tabs create --group 7 --json                 # inside group 7: {tabId, windowId, index, url, groupId}
```

Prints `created tab <id> in window <label> at index <n>` on success, because the
new id is the one thing you cannot look up beforehand. `--window`, `--after` and
`--before` all name the destination window, so give at most one; `--group` may
join any of them, as long as the group is in that same window, and is applied by
a second call once the tab exists. An id that is not a positive integer is
rejected before the session is contacted; an unknown tab, window or group fails
after the snapshot read with `no tab <id>`, `no window <id>` or `no group <id>`.
A url Chrome will not open surfaces as `createTab failed`.

`tabbrew tabs focus` is the counterpart to `create`'s background opening: it
selects the tab in its window and raises that window to the front. The raise is
real OS focus, so it pulls attention away from whatever the person is doing —
it is the one verb that does, deliberately.

```bash
tabbrew tabs focus 1901         # select 1901 and bring its window forward
tabbrew tabs focus 1901 --json  # {tabId, windowId}
```

Silent on success, and takes exactly one tab: focusing several is meaningless.
An id that is not a positive integer is rejected before the session is
contacted. Unlike the verbs that plan against a snapshot, `focus` needs no
snapshot, so an unknown id is Chrome's answer, not the CLI's: it fails with
`focusTab failed: tab <id> not found` rather than `no tab <id>`.

`tabbrew tabs move` puts tabs next to another tab, addressed by the TAB
column. The moved tabs end up in the anchor's window, so a tab from window B
placed after a tab in window A crosses windows with no extra flag. It is the
first verb that changes tabs.

```bash
tabbrew tabs move 1950 --after 1901         # 1950 lands right after 1901
tabbrew tabs move 1950 1952 --before 1903   # both, in the order given, just before 1903
tabbrew tabs move 1950 --after 1901 --json  # [{tabId, windowId, index}]
```

Silent on success. All the ids go to Chrome in one call, so either every tab
moves or none does. An id that is not a positive integer, a missing anchor
flag, or a tab named as its own anchor is rejected before the session is
contacted; an id Chrome does not know fails after the snapshot read with
`no tab <id>`. Chrome decides what happens at a group boundary (a tab dropped
inside a group joins it) and refuses to move an unpinned tab ahead of pinned
ones; both surface as `moveTabs failed`.

`tabbrew tabs discard` unloads tabs from memory and leaves them on the tab
strip, where they reload on their next click. It is the way to free memory
without closing anything.

```bash
tabbrew tabs discard 1950                 # unload one tab
tabbrew tabs discard 1950 1952 --json     # [{tabId, previousTabId, changed}]
```

Silent on success. Chrome takes one tab per call, so the ids go in order and
the first refusal stops the rest untouched; Chrome refuses the active tab, an
unknown id and a few others, and each surfaces as `discardTab failed`. Chrome
may replace a discarded tab with a new one under a new id: `--json` reports the
id it has now as `tabId`, the one you gave as `previousTabId`, and `changed`
when they differ. Take the new id from there, or re-list, before reusing it.

`tabbrew tabs reload` reloads tabs in place, as F5 does: the tab keeps its id,
its position and its group. It is the verb an agent wants after changing the
code behind a localhost tab, and it loads a discarded tab back.

```bash
tabbrew tabs reload 1950                   # reload one tab
tabbrew tabs reload 1950 1952 --hard       # both, bypassing the cache
tabbrew tabs reload 1950 --json            # [{tabId}]
```

Silent on success. Chrome takes one tab per call, so the ids go in order and
the first refusal stops the rest untouched. An id that is not a positive
integer is rejected before the session is contacted; `reload` needs no
snapshot, so an unknown id is Chrome's answer and fails with
`reloadTab failed: No tab with id: <id>`. `--hard` is the hard reload of
DevTools: the page is fetched again instead of served from the cache. The
command returns as soon as Chrome starts the reload, not when the page has
finished loading.

`tabbrew tabs close` closes tabs outright. It is the counterpart to `discard`:
nothing is kept, and there is no undo from the CLI.

```bash
tabbrew tabs close 1950            # close one tab
tabbrew tabs close 1950 1952 --json  # [1950, 1952]
```

Silent on success. All the ids go to Chrome in one call, so either every tab
closes or none does; a repeated id is collapsed, since Chrome refuses a list
that names the same tab twice. An id that is not a positive integer is rejected
before the session is contacted, and an id Chrome does not know fails after the
snapshot read with `no tab <id>` — nothing closes in either case. Anything
Chrome itself refuses surfaces as `closeTabs failed`. Closing the last tab in a
window closes that window, exactly as it does in the UI; closing every tab of a
group drops the group, so use `tabbrew groups close` when Chrome should keep it
among its saved groups.

### Windows

`tabbrew windows list` prints one row per open window, derived from the same
snapshot as `tabs list`, with the same session and connection requirements.

```bash
tabbrew windows list           # one row per window
tabbrew windows list --json    # [{id, focused, incognito, state, tabCount, groupCount, activeTabId}]
```

```
WINDOW  TABS  GROUPS  FLAGS    ACTIVE
1842    2     1       focused  mail.google.com  Inbox
1843    1     0       -        newtab  New Tab
```

Rows are ordered by window id. TABS and GROUPS are counts; FLAGS is any of
`focused`, `incognito`, `minimized`, `maximized`, `fullscreen`,
`locked-fullscreen`, or `-` (a `normal` state is not shown). ACTIVE comes last
and shows the host and title of the window's active tab, the title capped at
60 columns, or `-` when the window has no active tab.

### Groups

`tabbrew groups list` prints one row per tab group, derived from the same
snapshot as `tabs list`, with the same session and connection requirements.

```bash
tabbrew groups list            # one row per group
tabbrew groups list --json     # [{id, windowId, windowLabel, title, color, collapsed, tabCount}]
```

```
GROUP  WINDOW  TABS  COLOR  FLAGS      TITLE
7      A       1     blue   -          Work
9      A       3     red    collapsed  Reading
```

Rows are ordered by window, then by the group's position in the tab strip.
GROUP is Chrome's group id, as shown by `tabs list`; WINDOW is the window's
label; TABS is a count; FLAGS is `collapsed` or `-`. TITLE comes last, capped
at 60 columns with a trailing `…`, or `-` when the group has no title.

`tabbrew groups collapse` and `tabbrew groups uncollapse` fold or expand
groups, addressed by the GROUP column of `groups list`. They are the first
verbs that change Chrome.

```bash
tabbrew groups collapse 7 9       # collapse groups 7 and 9, in order
tabbrew groups uncollapse 7       # expand it again
tabbrew groups collapse 7 --json  # [{groupId, collapsed}]
```

Both are silent on success. Ids are sent one at a time in the order given;
the first failure stops with exit 1 and the groups before it stay changed. An
id that is not a positive integer is rejected before the session is contacted,
and an unknown id fails with Chrome's message.

`tabbrew groups close` closes groups. Removing a group's tabs would also
drop it from Chrome's saved tab groups, so instead each group is moved into a
throwaway window and that window is closed: the tabs go away and the group
stays saved on the profile.

```bash
tabbrew groups close 7 9       # close groups 7 and 9, in order
tabbrew groups close 7 --json  # [{groupId, tabIds}]
```

Silent on success, with the same ordering, validation and failure rules as
`collapse`. An id with no tabs behind it fails with `No group with id`.

### Init

`tabbrew init` writes a cheat sheet for AI coding agents so they discover the
CLI instead of guessing. It is non-interactive and safe to re-run: the block
lives between `<!-- TABBREW:START -->` and `<!-- TABBREW:END -->` markers and is
replaced in place on every run; everything outside it is left alone.

```bash
tabbrew init                    # update CLAUDE.md, .claude/CLAUDE.md, AGENTS.md, .cursorrules if present, else create CLAUDE.md
tabbrew init --agent codex      # target one tool's file: claude, cursor, codex, all
tabbrew init --path docs/AI.md  # explicit file(s); must stay inside the current directory
tabbrew init --print            # show the block, write nothing
tabbrew init --remove           # strip the block everywhere (deletes a file that held nothing else)
tabbrew init --extension harness   # also record which extension build `session start` opens: store, harness or an id
```

The command reference inside the block is generated from the registered
commands, so it cannot drift; re-run `init` after upgrading the CLI.

`--extension` writes `{"extensionId": "<id>"}` to `.tabbrew.json` in the
current directory and `session start` / `session open` read the nearest one up
from wherever they run. `harness` resolves to the harness id, a 32-letter id is
kept as given, and `store` removes the key (and the file, if nothing else is in
it). `TABBREW_EXTENSION_ID` still wins over the file.

## Development

```bash
bun install
bun start --help            # run from source
bun run build               # standalone binary at dist/tabbrew
./dist/tabbrew --version
```

Biome handles formatting, linting, and import order (`biome.json`).

```bash
bun run check       # verify (what CI runs)
bun run check:fix   # apply safe fixes
bun run typecheck
bun test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the branch flow and how a release
is cut.

## Harness extension

`extension/` is the development harness for the CLI's browser side, not the
TabBrew product extension. Browser-facing features land here paired with their
CLI command (the session handshake, the three `list` verbs,
`tabbrew groups collapse`/`uncollapse`/`close`, `tabbrew tabs create`,
`tabbrew tabs focus`, `tabbrew tabs move`, `tabbrew tabs discard`,
`tabbrew tabs reload` and `tabbrew tabs close` today)
so the protocol can be exercised end to end in a real Chrome. The product extension moves to its own repository once that protocol is
stable; see `extension/README.md`.

It is a minimal Manifest V3 extension, built with [WXT](https://wxt.dev) and
React, that connects Chrome to the session. An open extension page *is* the
connection: while it is open it polls `GET /health` every 3 seconds, and once
a session answers it holds a long-poll on that session and serves the commands
it claims; close it and nothing runs. There are two such pages running the
same app: `connection.html`, a tab the CLI opens itself (`tabbrew session
start` / `open`), and the side panel behind the toolbar icon, for opening by
hand. There is deliberately no background polling.

```bash
bun run build:ext              # production build to extension/dist/chrome-mv3
bun run dev:ext                # dev build with live reload
bun run zip:ext                # extension/dist/tabbrew-extension.zip, the release asset
```

Load it once: `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/chrome-mv3`. The manifest pins a `key`, so the id Chrome
shows is the same on every machine; a build loaded before the key was pinned
must be removed and loaded again. The CLI opens the Web Store extension by
default, so point it here with `TABBREW_EXTENSION_ID=<that id>` or, once per
checkout, `tabbrew init --extension harness`; from then on
`tabbrew session start` opens the page, and the toolbar icon opens the side
panel instead.
`bun install` runs `wxt prepare`, which generates the TypeScript config in
`extension/.wxt/`; both that and `dist/` are ignored by git.

The e2e suite in `src/e2e/` drives the compiled CLI against a real Chrome
holding this build, with no fake panel in between. It is skipped by plain
`bun test`; CI runs it under Xvfb in the `e2e-chrome` job. Locally:

```bash
bunx @puppeteer/browsers install chrome@stable   # Chrome for Testing; branded Chrome 137+ refuses --load-extension
bun run build && bun run build:ext
TABBREW_E2E_CHROME_BIN=/path/to/chrome bun run test:e2e
```

It uses a throwaway profile and state directory, needs the default ports free
(no other session running), and closes its Chrome when done.

The ports, the `service: "tabbrew-session"` marker the page checks, and the
command channel's paths and shapes live in `src/core/session/protocol.ts`,
which both the CLI and the extension import, so the two sides cannot drift
apart. `extension/wxt.config.ts` also derives the manifest's
`host_permissions` from that list.

## Layout

Commands are organised as noun folders with one verb per file; `init` and
`update` are the top-level verbs. `src/core/` holds the logic behind them and never imports
from `src/commands/`, so it can be tested without going through the CLI.

```
src/index.ts                                 root program, registers nouns
src/commands/<noun>/index.ts                 new Command("<noun>") + addCommand(each verb)
src/commands/<noun>/<verb>.ts                one verb = one exported Command
src/commands/tabs/list.ts                    readSnapshot through the session, as a table or --json
src/commands/groups/collapse.ts              the collapse verb and the factory uncollapse shares
src/commands/init/index.ts                   the init verb, writes the agent cheat sheet
src/core/<module>/index.ts                   public surface of a core module
src/core/session/protocol.ts                 wire contract shared with the extension: ports, marker, probe, command channel
src/core/session/config.ts                   timeouts, paths, env overrides, how the CLI re-runs itself
src/core/session/server.ts                   the loopback server (/health, /stop, the request queue, idle exit)
src/core/session/lifecycle.ts                find, spawn, wait for, and stop a session
src/core/session/call.ts                     post an operator call to a session and explain its failures
src/core/session/chrome.ts                   the extension id, the connection page URL, and opening it in Chrome
src/core/session/format.ts                   one-line description of a session
src/core/operators/contract.ts               what the CLI may ask of Chrome: the snapshot and the operators
src/core/tabs/format.ts                      the tab table
src/core/agent-docs/block.ts                 find, replace and remove the marker-fenced block
src/core/agent-docs/targets.ts               which agent doc files exist and which to create
src/core/agent-docs/cheatsheet.ts            render the block from config + commander metadata
src/core/agent-docs/install.ts               write and remove the block on disk
src/commands/update/index.ts                 the update verb: check, download, verify, swap
src/core/update/config.ts                    where releases live, with env overrides for tests and forks
src/core/update/index.ts                     resolve the latest release, verify its checksum, replace the binary
install.sh                                   curl | sh installer: picks the asset, verifies it, installs to ~/.local/bin
extension/README.md                          why the extension exists: CLI harness, not the product
extension/wxt.config.ts                      WXT config; harness manifest with the CLI version and the two ports' host permissions
extension/src/components/App.tsx             the connection: polls the session and serves its commands while a page is open
extension/src/entrypoints/connection/main.tsx mounts App into connection.html, the tab the CLI opens; yields to a twin, closes with its session
extension/src/entrypoints/sidepanel/main.tsx mounts App into sidepanel.html
extension/src/entrypoints/background.ts      only makes the toolbar icon open the side panel
extension/src/utils/session.ts               the shared probe with a browser-sized timeout
extension/src/utils/channel.ts               a page's half of the command channel: claim, run, answer
extension/src/utils/operators.ts             operators -> chrome.*, the one place that touches Chrome
```
