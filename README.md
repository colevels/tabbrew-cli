<p align="center">
  <img src="docs/logo.svg" alt="TabBrew" width="128">
</p>

# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/colevels/tabbrew-cli)](https://github.com/colevels/tabbrew-cli/releases/latest)
[![npm](https://img.shields.io/npm/v/tabbrew-cli)](https://www.npmjs.com/package/tabbrew-cli)

**A Chrome tab manager for the terminal.**

Manage Chrome tabs, windows and tab groups from the terminal: list them, open,
focus, move, group, ungroup, discard, reload and close tabs, fold and close groups. Every verb
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
| `tabbrew tabs ungroup` | Take tabs out of their group |
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
| `tabbrew uninstall` | Stop the session, remove `~/.tabbrew` and the binary it installed |

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
connection page by id, and if that page never answers it prints the Store
link to install from.

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
tabbrew uninstall --dry-run    # show what would go, change nothing
tabbrew uninstall              # stop the session, remove ~/.tabbrew and the binary
npm uninstall -g tabbrew-cli   # if installed from npm; from source: bun unlink
```

`uninstall` removes the binary only when it is the one `install.sh` or
`tabbrew update` put there; npm and source installs keep theirs. Before you
run it, `tabbrew init --remove` in any repo that carries the cheat sheet.
Then remove the extension in `chrome://extensions`.

## Commands

> Every verb takes `--json` and is silent on success. Ids are the TAB, WINDOW
> and GROUP columns printed by the `list` verbs.

### Session

```bash
tabbrew session start            # spawn in the background, open the connection page
tabbrew session start --no-open  # spawn only
tabbrew session open             # (re)open the connection page
tabbrew session status           # address, pid, version, uptime (exit 1 if none)
tabbrew session stop             # ask it to exit, wait for the port
tabbrew session run              # foreground, Ctrl-C to stop
```

The session exits after 10 idle minutes. `TABBREW_EXTENSION_ID`, or
`extensionId` in the nearest `.tabbrew.json`, opens another extension build.

### Tabs

```bash
tabbrew tabs list                            # one row per tab, every window
tabbrew tabs create https://example.com      # open in the background, end of current window
tabbrew tabs create example.com --after 1901 # right after tab 1901
tabbrew tabs create --window 1843 --group 7  # new tab page, inside group 7
tabbrew tabs focus 1901                      # select it and raise its window
tabbrew tabs move 1950 --after 1901          # next to 1901, across windows if needed
tabbrew tabs move 1950 1952 --before 1903    # several, in the order given
tabbrew tabs group 1901 1903 --title Work    # new group, --color / --collapse optional
tabbrew tabs group 1950 --to 7               # join an existing group
tabbrew tabs ungroup 1903                    # take it out of its group
tabbrew tabs discard 1950                    # unload from memory, keep on the tab strip
tabbrew tabs reload 1950                     # reload in place
tabbrew tabs reload 1950 --hard              # bypass the cache
tabbrew tabs close 1950 1952                 # close, no undo
```

`focus` is the one verb that steals OS focus. `discard` may give a tab a new
id; `--json` reports it with `previousTabId`.

### Windows

```bash
tabbrew windows list                             # one row per window, tab and group counts
tabbrew windows create                           # empty window
tabbrew windows create a.com b.com --focus       # with tabs, brought to the front
```

### Groups

```bash
tabbrew groups list           # one row per group: colour, collapsed, tab count
tabbrew groups collapse 7 9   # fold, in order
tabbrew groups uncollapse 7   # expand again
tabbrew groups close 7        # close its tabs, keep the group among Chrome's saved groups
```

### Init

```bash
tabbrew init                       # write the cheat sheet into CLAUDE.md / AGENTS.md / .cursorrules
tabbrew init --agent codex         # one tool's file: claude, cursor, codex, all
tabbrew init --path docs/AI.md     # explicit file, inside the current directory
tabbrew init --print               # show the block, write nothing
tabbrew init --remove              # strip the block everywhere
tabbrew init --extension harness   # record which extension build to open: store, harness, or an id
```

The block sits between `<!-- TABBREW:START -->` and `<!-- TABBREW:END -->`
and is replaced on every run, so re-run `init` after upgrading.

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

Commands live in `src/commands/<noun>/<verb>.ts`, one verb per file; `init`
and `update` are top-level verbs. `src/core/` holds the logic behind them and
never imports from `src/commands/`, so it can be tested without going through
the CLI.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the branch flow and how a release
is cut.

## Harness extension

`extension/` is the development harness for the CLI's browser side, not the
TabBrew product extension. Browser-facing features land here paired with their
CLI command (the session handshake, the three `list` verbs,
`tabbrew groups collapse`/`uncollapse`/`close`, `tabbrew tabs create`,
`tabbrew tabs focus`, `tabbrew tabs move`, `tabbrew tabs discard`,
`tabbrew tabs reload`, `tabbrew tabs close` and `tabbrew tabs ungroup` today)
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
