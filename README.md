# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)

TabBrew CLI, built on Bun and commander. The repo also holds `extension/`, a
Chrome extension **harness** used to develop and test the CLI's browser
protocol; the TabBrew product extension lives in its own repository.

## Run

```bash
bun install
bun start --help
```

## Build a standalone binary

```bash
bun run build
./dist/tabbrew --version
```

## Format & lint

Biome handles formatting, linting, and import order (`biome.json`).

```bash
bun run check       # verify (what CI runs)
bun run check:fix   # apply safe fixes
```

## Session

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
The id is fixed by the `key` pinned in the harness manifest, so the CLI never
has to ask Chrome for it. Opening the page twice is harmless: the second copy
finds the first and closes itself. When its session stops, the page closes
itself too. Set `TABBREW_CHROME` to a program that takes the URL as its only
argument to use another browser or profile.

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

## Tabs

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

## Windows

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

## Groups

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

## Harness extension

`extension/` is the development harness for the CLI's browser side, not the
TabBrew product extension. Browser-facing features land here paired with their
CLI command (the session handshake, the three `list` verbs,
`tabbrew groups collapse`/`uncollapse`, `tabbrew tabs move` and
`tabbrew tabs discard` today)
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
bun run zip:ext                # zip a loadable build to hand to someone
```

Load it once: `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/chrome-mv3`. The manifest pins a `key`, so the id Chrome
shows is the one the CLI computes; a build loaded before the key was pinned
must be removed and loaded again. From then on `tabbrew session start` opens
the page; the toolbar icon opens the side panel instead.
`bun install` runs `wxt prepare`, which generates the TypeScript config in
`extension/.wxt/`; both that and `dist/` are ignored by git.

| Page shows | Meaning |
| --- | --- |
| No session | Nothing answered on either port. Run `tabbrew session start`. |
| Connected | Address, pid, CLI version and uptime of the session, and the last command the page served. It stays alive while the page is open. |

The ports, the `service: "tabbrew-session"` marker the page checks, and the
command channel's paths and shapes live in `src/core/session/protocol.ts`,
which both the CLI and the extension import, so the two sides cannot drift
apart. `extension/wxt.config.ts` also derives the manifest's
`optional_host_permissions` from that list.

## Init

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
```

The command reference inside the block is generated from the registered
commands, so it cannot drift; re-run `init` after upgrading the CLI.

## Layout

Commands are organised as noun folders with one verb per file; `init` is the
one top-level verb. `src/core/` holds the logic behind them and never imports
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
