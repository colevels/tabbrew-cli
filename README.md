# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)

TabBrew CLI, built on Bun and commander.

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

It binds the first free port of `49227`, `49228` (the two the TabBrew extension
may reach), answers `GET /health`, accepts `POST /stop` from local processes
only, and exits on its own after 10 minutes without use. Background output goes
to `~/.tabbrew/session.log`.

Environment overrides, mainly for tests:

| Variable | Meaning |
| --- | --- |
| `TABBREW_SESSION_PORTS` | comma-separated ports to try, in order |
| `TABBREW_SESSION_IDLE_MS` | idle time before the session exits |
| `TABBREW_SESSION_DIR` | where `session.log` is written |

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
one top-level verb.

```
src/index.ts                   root program, registers nouns
src/commands/<noun>/index.ts   new Command("<noun>") + addCommand(each verb)
src/commands/<noun>/<verb>.ts  one verb = one exported Command
src/commands/init/index.ts     the init verb, writes the agent cheat sheet
src/session/config.ts          ports, timeouts, paths, how the CLI re-runs itself
src/session/server.ts          the loopback server (/health, /stop, idle exit)
src/session/client.ts          find, spawn, wait for, and stop a session
src/session/format.ts          one-line description of a session
src/agent-docs/block.ts        find, replace and remove the marker-fenced block
src/agent-docs/targets.ts      which agent doc files exist and which to create
src/agent-docs/cheatsheet.ts   render the block from config + commander metadata
src/agent-docs/install.ts      write and remove the block on disk
```
