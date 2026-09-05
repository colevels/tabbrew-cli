# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)

TabBrew CLI, built on Bun and commander. The repo also holds `extension/`, a
Chrome side-panel **harness** used to develop and test the CLI's browser
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

The session is a small HTTP server on `127.0.0.1` that will link this terminal
to Chrome. `start` launches it in the background and returns; `run` keeps it in
the foreground.

```bash
tabbrew session start          # spawn in the background, wait until it answers
tabbrew session status         # where it is, pid, version, uptime (exit 1 if none)
tabbrew session status --json
tabbrew session stop           # ask it to exit, wait until the port is free
tabbrew session run            # foreground, Ctrl-C to stop
```

It binds the first free port of `49227`, `49228` (the two the extension's
manifest may reach), answers `GET /health`, accepts `POST /stop` from local
processes only, and exits on its own after 10 minutes without use. An open
extension panel polling `/health` counts as use; `tabbrew session status` from
a terminal does not, so a session nobody is looking at still goes away.
Background output goes to `~/.tabbrew/session.log`.

Environment overrides, mainly for tests:

| Variable | Meaning |
| --- | --- |
| `TABBREW_SESSION_PORTS` | comma-separated ports to try, in order |
| `TABBREW_SESSION_IDLE_MS` | idle time before the session exits |
| `TABBREW_SESSION_DIR` | where `session.log` is written |

## Harness extension

`extension/` is the development harness for the CLI's browser side, not the
TabBrew product extension. Browser-facing features land here paired with their
CLI command (the session handshake today; `tabbrew chrome tabs list` and the
like next) so the protocol can be exercised end to end in a real Chrome. The
product extension moves to its own repository once that protocol is stable; see
`extension/README.md`.

It is a minimal Manifest V3 side panel, built with [WXT](https://wxt.dev), that
connects Chrome to the session. The open panel *is* the connection: while it is
open it polls `GET /health` every 3 seconds and shows what it finds; close it
and nothing runs. There is deliberately no background polling.

```bash
bun run build:ext              # production build to extension/dist/chrome-mv3
bun run dev:ext                # dev build with live reload
bun run zip:ext                # zip a loadable build to hand to someone
```

Load it once: `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/chrome-mv3`. Click the toolbar icon to open the panel.
`bun install` runs `wxt prepare`, which generates the TypeScript config in
`extension/.wxt/`; both that and `dist/` are ignored by git.

| Panel shows | Meaning |
| --- | --- |
| Connect to TabBrew CLI | Chrome has not yet allowed the panel to reach `127.0.0.1:49227/49228`. The button asks once; Chrome remembers. |
| No session | Nothing answered on either port. Run `tabbrew session start`. |
| Connected | Address, pid, CLI version and uptime of the session. It stays alive while the panel is open. |

The ports and the `service: "tabbrew-session"` marker the panel checks live in
`src/core/session/protocol.ts`, which both the CLI and the extension import, so
the two sides cannot drift apart. `extension/wxt.config.ts` also derives the
manifest's `optional_host_permissions` from that list.

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
src/commands/init/index.ts                   the init verb, writes the agent cheat sheet
src/core/<module>/index.ts                   public surface of a core module
src/core/session/protocol.ts                 wire contract shared with the extension: ports, marker, probe
src/core/session/config.ts                   timeouts, paths, env overrides, how the CLI re-runs itself
src/core/session/server.ts                   the loopback server (/health, /stop, idle exit)
src/core/session/client.ts                   find, spawn, wait for, and stop a session
src/core/session/format.ts                   one-line description of a session
src/core/agent-docs/block.ts                 find, replace and remove the marker-fenced block
src/core/agent-docs/targets.ts               which agent doc files exist and which to create
src/core/agent-docs/cheatsheet.ts            render the block from config + commander metadata
src/core/agent-docs/install.ts               write and remove the block on disk
extension/README.md                          why the extension exists: CLI harness, not the product
extension/wxt.config.ts                      WXT config; harness manifest with the CLI version and the two ports' host permissions
extension/src/entrypoints/sidepanel/main.ts  the connection: polls the session while the panel is open
extension/src/entrypoints/background.ts      only makes the toolbar icon open the panel
extension/src/utils/session.ts               permission helpers around the shared probe
```
