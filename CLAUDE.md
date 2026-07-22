# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: past the POC, deliberately small

`v0.6.0` was the POC snapshot — the widest the command surface ever got, with eight
`tabs` subcommands around a long-polling bridge. **v0.8.0 is the subtraction** (breaking):
`tabs watch`, `tabs push`, `tabs check`, `tabs history` and `tabs prompt` are gone, and so
are the vendored simulator, the delta-log subsystem, the three skill variants, and every
long poll.

`0.7.0` is a version that only exists in the git history: the bump landed on `main` but
was never tagged, so no user ever received it. Everything it did ships as part of 0.8.0 —
which is why the jump users see is 0.6.0 → 0.8.0. Don't "restore" a v0.7.0 release; there
is nothing it would contain that 0.8.0 doesn't.

What's left is the loop those commands existed to serve, in three steps: the extension
pushes tabs to the bridge (`tabs serve`), the agent reads them (`tabs list`), the agent
proposes a script the user accepts or denies (`tabs suggest`). Claude Code's `/loop`
already owns the pacing `tabs watch` was built for, so the CLI doesn't.

The bias stays subtractive: prefer deleting a subsystem's docs along with its code over
leaving prose describing something that's gone, and treat `registry.ts` (plus `git log`)
as the authority on what exists — not this file.

## What this is

`tabbrew-cli` is a Bun + TypeScript CLI (`tabbrew` binary) that authenticates to a
TabBrew server via the OAuth 2.0 Device Authorization Grant (RFC 8628) and exposes
a few agent-facing tools. It has **zero external runtime dependencies**: arg parsing
is `parseArgs` from `node:util`, HTTP is the global `fetch`, and shelling out uses
Bun's shell (`Bun.$` / `Bun.which`).

## Commands

```bash
bun install                        # requires Bun ≥ 1.1
bun run src/index.ts <cmd>         # run in dev, e.g. `... whoami`
bun start -- <cmd>                 # same, via the start script
bun run typecheck                  # tsc --noEmit
bun run test                       # bun test — pure-logic unit tests (src/*.test.ts)
bun run build                      # → dist/tabbrew (self-contained compiled binary)
```

There is **no linter configured**, and the test suite is deliberately narrow: `bun test`
(Bun's built-in runner, so still zero deps) covers only the pure functions where a wrong
answer is invisible in review — `src/table.test.ts` for display-width measurement, and
`src/registry.test.ts` for the help layout (an over-long summary looks fine in the source
and wraps in the terminal). Everything that touches the network, the filesystem, or a real terminal is
still verified by hand. `typecheck` + `test` + `build` (in `.github/workflows/ci.yml`) is
the whole *check* CI surface — releases are cut by the separate
`.github/workflows/release.yml` (see **Releasing**). "Testing" a subcommand
means running it against a real/staging server by
pointing `TABBREW_BASE_URL` at it (see README "Testing each subcommand"). Set
`TABBREW_TOKEN` to exercise authed commands without an interactive `login`.

## Architecture

`src/index.ts` is the command router: it parses `Bun.argv`, dispatches on the first
positional, and wraps everything in a **single error boundary**. That boundary only
prints a clean message (no stack trace) for the CLI's typed error classes — `AuthError`
(`auth.ts`), `ApiError` / `NotAuthenticatedError` / `TokenExpiredError` (`api.ts`),
`UpdateError` (`update.ts`), `TabsInputError` / `TabsBridgeError`
(`commands/tabs-errors.ts`), `ServeError` (`commands/tabs-serve.ts`), and `UsageError`
(`registry.ts`). The two `Tabs*` classes live in their own module rather than in the
command that throws them: they used to be defined inside `tabs.ts`/`tabs-push.ts`, which
broke the moment those files were deleted — `TabsBridgeError` (then `TabsPushError`) was
declared in `tabs-push.ts` but is thrown by `tabs suggest`. `ServeError` stays in
`tabs-serve.ts` because only that file can raise it (the port is taken / the server
died on start). Throw one of these for any user-facing failure, and **register a new
class in the boundary's `known` list** — anything unlisted surfaces a generic message
unless `TABBREW_DEBUG` is set. Because `parseArgs` runs in `strict` mode, **every
accepted flag must be declared in `index.ts`** — even flags only used by one subcommand
(all the `init` flags are declared there).

`src/config.ts` is the seam that makes the same binary target prod/staging/local:
all configuration comes from `TABBREW_*` env vars with sensible defaults, resolved
once into the exported `config` object. Endpoints derive from `TABBREW_BASE_URL`
unless individually overridden. Route new config through here — the deliberate exceptions
are four knobs read at their point of use: `NO_COLOR` (`ui.ts`), `TABBREW_DEBUG`
(`index.ts`), `CLAUDE_CONFIG_DIR` (`agents.ts` — it belongs to the agent target, not to
TabBrew), and `TABBREW_NO_BROWSER` (`util.ts`, inside `openBrowser`, so it gates every
caller: `login` *and* `docs open`).

The codebase is four loosely-coupled subsystems. They share the leaf modules — `config`,
`ui`, `util`, plus `fsops` (atomic writes) and `table` (display-width padding) — and
nothing else; no subsystem imports another's command files. The fourth, `tabs`, never talks
to the TabBrew server at all: its only `config` use is `config.serve`, the loopback port
and the state-file path.

**1. Auth / API (the original purpose)**
- `auth.ts` — device-flow protocol: request a device code, then `pollForToken`
  handles the RFC 8628 `authorization_pending` / `slow_down` / `access_denied` /
  `expired_token` states.
- `credentials.ts` — token storage at `~/.config/tabbrew/credentials.json` (chmod
  600, re-asserted on every save). `resolveToken()` is the single source of truth
  for the active token: **`TABBREW_TOKEN` env var always wins over the stored file**
  (so CI never runs `login`).
- `api.ts` — `authedFetch` attaches the bearer token and converts any `401` into a
  `TokenExpiredError` whose wording differs for env-var vs stored tokens. It also
  holds `htmlFilesPost` (see `docs push` below).
- Commands: `commands/login.ts`, `logout.ts`, `whoami.ts`, `tools.ts` (the
  `repo-info` demo — guards every external call with `which()` before shelling to git),
  `docs.ts`.

`commands/docs.ts` (`tabbrew docs push <file>`) sends an HTML file to TabBrew's
`/api/v1/html_files/*` endpoints so it shows up in the sidepanel **Docs** view —
`local` mode (default) registers the absolute path as JSON; `--cloud` uploads the
content as multipart (≤ 2 MB, checked client-side before sending). These endpoints
authenticate with the OAuth **login token** like the rest of the CLI, so
`htmlFilesPost` delegates to `authedFetch` (`Authorization: Bearer`) and only layers
on `handleHtmlFilesResponse` for the Docs-specific 413 / `success:false` cases.
(They once also accepted a legacy per-feature `x-upload-token`; the server dropped
that route, so the CLI's fallback — and `resolveUploadToken`/`TABBREW_UPLOAD_TOKEN` —
were removed. See issue #19.)

`commands/docs.ts` also has `tabbrew docs list` (`GET /api/v1/html_files`), which
prints the account's docs as a hand-padded table (`--json` for the raw array).
`htmlFilesList()` in `api.ts` authenticates the same way — `authedFetch` with the
OAuth login token (like `fetchUserInfo`). Its `HtmlFileRow` mirrors the server's `HtmlFileDTO`
(`tabbrew-web/lib/html-files.ts`) and stays a tolerant reader — extra server
fields are ignored, not fatal.

`tabbrew docs open <id>` completes the loop: it reuses `htmlFilesList()` to find the row
(no per-id endpoint), resolves it with the same `viewUrl()` the list uses — `file://` for
`kind: "local"`, `htmlFileViewUrl()`'s `/api/v1/html_files/<id>/view` for cloud — and hands
it to `openBrowser`. `docs list` makes the same URLs clickable in place by wrapping each
title in an **OSC 8 hyperlink** (`link()` in `ui.ts`, applied via `padEndLink` in
`table.ts`), so `docs open` is the fallback for terminals that don't support them. The
escape bytes are why `table.ts` measures width on escape-stripped text — see below.

> **Cross-repo:** the server routes + wire contract for every `docs`/API-backed
> command live in the `tabbrew` monorepo (`tabbrew-web`), which is their source of
> truth. When adding such a command, follow the *"Adding a `tabbrew-cli` command
> backed by a web API route"* checklist in that repo's root `CLAUDE.md`: contract
> first → server (+ `curl` verify) → CLI here (against local web via
> `TABBREW_BASE_URL`/`TABBREW_TOKEN`) → ship the server before the binary.

**2. `init` — agent-awareness installer**
`tabbrew init` teaches an AI agent (currently only Claude Code) that this CLI exists.
It writes a slim `TABBREW-CLI.md` doc plus a version-tagged managed block in
`CLAUDE.md` that `@import`s it, **and** installs **one skill** into the agent's skills dir
— `resolveSkillsDir(scope, name)` on the `AgentTarget`, iterating `skillNames`
(`.claude/skills/<name>/` locally, `<config>/skills/…` global): `tabbrew-tabs`, the
read→propose→listen prompt bundled from `tabbrew-script/skills.ts`. `--no-skill` skips it;
`--uninstall` removes everything. There is no `--variant`: the three token-budget variants
existed for a chat-shaped prompt pasted into someone's browser, and an agent with a
terminal doesn't need the cheap one.
Design constraints worth preserving:
- **Legacy skills are deleted, not just left behind.** `agents.ts` carries
  `legacySkillNames` (`tabbrew-auto`) alongside `skillNames`, and `init` removes those
  dirs on **install as well as uninstall**. A stale `tabbrew-auto` is worse than clutter:
  it tells the agent to run `tabbrew tabs watch`, which no longer exists, so upgrading
  can't be left to the user noticing an orphaned directory.
- `awareness.ts` is **filesystem-free** — the awareness doc and all block-manipulation
  are pure string constants/functions so they survive `bun build --compile` (no
  runtime file reads). Disk I/O lives in `fsops.ts`; orchestration in `commands/init.ts`.
- The managed block is located by a **version-less marker** (`<!-- tabbrew-cli-instructions`)
  so a future v2 replaces v1 in place instead of duplicating. A block with an opening
  marker but no close is treated as malformed → `init` **refuses** rather than guessing.
- `fsops.ts` writes are **atomic** (temp file in the same dir + rename) and follow
  symlinks; an existing `CLAUDE.md` is copied to `.bak` before editing.
- `agents.ts` holds the `AgentTarget` registry — this is the extension seam for adding
  Cursor/Codex/Gemini. Note the comment there: Claude resolves `@` imports relative to
  the importing file, but Codex resolves relative to CWD, so a new target will need an
  absolute `importRef`.
- Behavior is idempotent (re-runs report `unchanged`) and safe non-interactively:
  `confirm()` defaults to No and auto-declines on a non-TTY unless `--yes` is passed.

**3. `update` — self-updating binary**
`tabbrew update` replaces the running compiled binary with the newest GitHub Release.
It is **not** part of the web-API auth path — it talks only to GitHub Releases,
so its config lives in `config.update` (`TABBREW_REPO` / `TABBREW_RELEASE_URL` /
`TABBREW_DOWNLOAD_BASE_URL` / `TABBREW_DOWNLOAD_TIMEOUT_MS`), separate from the auth
endpoints. `update.ts` is the IO/protocol module (like `api.ts`); `commands/update.ts`
is the thin presentation layer. Design constraints worth preserving:
- **Version discovery uses the `releases/latest` 302 redirect**, not the REST API — no
  token, no 60/hr rate limit, and no coupling to API JSON. Same trick `install.sh` uses.
  (The producer side — how those releases are built, signed, and published — is
  **Releasing** below.)
- **Compiled-vs-dev is gated on `import.meta.url` containing `/$bunfs/`** (a compiled
  standalone runs its entry from Bun's virtual FS; `bun run src/…` is a real `file://`).
  `update` refuses in dev so it never overwrites the `bun` binary. `process.execpath`
  (realpath'd) is the file to replace.
- **The swap is an atomic rename over self**: temp file in the target's own dir (no
  `EXDEV`), `chmod 0o755`, then `rename` — safe while running (keeps the old inode; we
  never write in place, which would `ETXTBSY`). Mirrors `fsops.ts`'s temp+rename idiom.
  Permission failures (`EACCES`/`EPERM`/`EROFS`) become an actionable `UpdateError`.
- **SHA-256 is verified client-side** against `checksums.txt` (`Bun.CryptoHasher`, zero
  dep) before the swap — a mismatch aborts and leaves the original binary untouched.
- `--check` reports current-vs-latest and **always exits 0** (`--json` for scripting);
  the full form has **no confirmation prompt** (the command *is* the intent) and is a
  no-op when already current. Throw `UpdateError` for any user-facing failure.

**4. `tabs` — the local bridge and the three-step loop**
`tabbrew tabs` is three commands, which are the whole loop: `serve` runs the loopback
bridge the extension pushes its tabs to, `list` reads what arrived, `suggest` puts a script
in front of the user. It never touches `chrome.*` — execution, simulation and snapshot
rendering all stay in the extension, so **no `tabs` command can change a user's tabs**, and
none of them talks to the TabBrew server: `list` is offline, `serve`/`suggest` only ever
speak to `127.0.0.1`.

The bridge speaks **protocol 3** (`PROTOCOL` in `tabs-serve.ts`, echoed by `GET /health`),
with exactly five routes: `POST /tabs`, `POST /suggestion`, `GET /suggestion` (pops the
queued one), `POST /decision`, `GET /health`. Both ends move independently — the extension
updates via the Web Store, the CLI via `tabbrew update` — so **neither may assume the other
is current**, and this is the one place in the repo where compatibility runs in *both*
directions. Protocol 3 is backwards-safe for a shipped protocol-2 extension: the four
routes it actually calls are unchanged, byte for byte. What went away is what nothing in
the browser ever called (`GET /tabs`, `GET /history`, `GET /decision`) plus the protocol-1
`/script` fallback, which a current extension only reached after a 404 on `/suggestion`.
Never repurpose an existing route's shape — add a new one.

**Nothing long-polls any more.** Every route is a plain request/response: the extension
polls `GET /suggestion` on its own timer, and the verdict is read from disk by the next
`tabs list` rather than waited on over a held-open socket. That deleted `park()`/`wake()`,
their abort-on-`req.signal` bookkeeping, and the `idleTimeout: 0` workaround that existed
only because Bun kills a 10s-idle request.
- `commands/tabs-serve.ts` — the bridge, and the only writer of `tabs.json`. Security
  model: loopback-only bind (hardcoded, not overridable), **no token**, plus two header
  gates — `Host` must be `127.0.0.1|localhost:<port>` (this is the anti-DNS-rebinding one:
  a rebound page's GETs are *same-origin*, so they carry no `Origin` and the check below
  can't see them), and `Origin`, when present, must be `chrome-extension://` (blocks a
  drive-by `POST /tabs`). Keep both — they cover different halves, and they're one
  self-contained block so they're easy to rip out. `tabs.json` is written `0o600` via
  `atomicWrite`'s `mode` arg: it's the URL and title of every open tab, the config dir is
  not reliably `0700`, and umask alone gives `0644`.
- **The suggestion ring** is the piece of state worth understanding. `tabs.json` carries a
  `suggestions` array — newest first, capped at `SUGGESTION_RING` (5) — of
  `{ id, note, opCount, basedOn, queuedAt, claimedAt, decision, reason, decidedAt }`. It is the
  agent's memory of what it proposed and what the user said back, so it deliberately
  outlives both a tab change (`POST /tabs` rebuilds the state wholesale but carries the
  ring through `persist()`) and a restart of `serve` (`seedTabState()` reloads it, and
  keeps the version counter climbing so `basedOn` staleness stays meaningful). The one gap
  is cold start: `persist()` no-ops while `tabState` is null, so a suggestion queued before
  the extension has ever posted tabs stays in memory only. That case is degenerate — an
  agent with no tabs to read has nothing to write a script about — but don't describe the
  ring as unconditionally durable.
  `decision: null` prints as `PENDING` and is the "don't pile a second proposal on top of
  the first" signal. `failed` is not a user decision — it's "the user said yes and Chrome
  refused"; recording that as `accepted` would tell a watching agent its plan worked when
  the tabs never moved. `POST /decision` matches by `id` when the extension sends one and
  otherwise answers the newest undecided entry, so an older extension's verdict isn't
  dropped on the floor.
- **Nothing may leave a record `PENDING` forever**, because that is exactly the state the
  skill treats as "wait, don't propose" — a stuck one silently ends the loop for the rest
  of the session. Two mechanisms close that off, and they are deliberately different in
  kind. `reconcileOnRestart()` is a *fact*: the queue is RAM, so an undecided record with
  no `claimedAt` was never delivered and now never can be (the extension's next poll gets
  a 204), and it is marked `stale` at startup. `claimedAt` exists only to make that call
  precise — a record the extension *did* claim may still be on screen with a live Accept
  button, and its decision still arrives with an id that is in the restored ring, so those
  are left alone. The second mechanism is `tabs list`'s `UNANSWERED_AFTER_MS` (15 min),
  which *is* a heuristic and is presentation-only: after the pop, elapsed time is the only
  signal there is about whether anyone is looking.
- `commands/tabs-list.ts` — prints the extension's **own** rendered snapshot markdown
  (`# Cross-window / # Windows / # Groups / # Tabs`) verbatim, preceded by the suggestion
  ring and a freshness line. Two reasons it isn't a hand-built table: that markdown is the
  exact format the skill is written against, so an agent reads it with no translation step,
  and the extension already renders it — a second renderer here would drift from
  `renderSnapshot`. When the payload has no `snapshot` field (developer-mode panel, or an
  older build) it **says so** rather than falling back to a table. It reads the state file
  tolerantly — every field optional, since a file from an older build is a normal thing to
  meet — and warns on stderr, not stdout, when the snapshot is older than 5 minutes, so the
  warning can't land in the middle of what an agent is parsing.
- `commands/tabs-suggest.ts` — validates the script (`parseTabbrewScript`, line-numbered
  errors, **exit 1** on any), then POSTs it to the bridge. Script input is a file arg or
  stdin (`-`, and `extractFencedTabbrewScript` accepts a whole ` ```tabbrew ` block).
  `--note` is **required**: a suggestion the user didn't ask for has to explain itself in
  their language, and only a required flag makes that reliable. It is **fire and forget** —
  it returns as soon as the bridge has the script, with no `--wait`, because an agent that
  blocked here would be holding a socket open across a human decision; the answer surfaces
  in a later `tabs list`. It rejects a zero-op script locally rather than letting the
  bridge's empty-body guard answer `invalid_payload`, which reads as a bridge failure when
  the real problem is that nothing was passed in. It sends `basedOn` (the tab-state version
  it reasoned about) so the extension can warn before the user accepts a plan written
  against tabs that have since moved.
- There is **no `--port` flag** on anything. The extension lists exactly 49227 and 49228 in
  both manifests' `optional_host_permissions`, so a bridge on any other port is unreachable
  from the browser — an option that could only ever be wrong. `config.serve.ports` is the
  single place the list is resolved, so the listener (`tabs serve`) and the client
  (`tabs suggest`) cannot disagree; `TABBREW_SERVE_PORT` pins one port, for tests.
- **Two ports means proving identity, not just reachability** (`src/bridge.ts`). `tabs
  serve` takes the first free port; `tabs suggest` takes the first that *answers as a
  bridge*. `GET /health` carries `service: "tabbrew-bridge"` for exactly this — never
  rename or drop that field. Older bridges predate it, so `looksLikeBridge` also accepts
  `ok: true` plus a numeric `protocol`/`tabsVersion`; the extension's `localServer.ts`
  implements the identical predicate and the two must not drift, or one end will adopt a
  service the other rejects. Probing is sequential in preference order at both ends — with
  two bridges up, "the lowest port" is stable where "first to reply" is a race that could
  point the CLI at one bridge while Chrome talks to the other.
- **A busy port is diagnosed, not just skipped.** On `EADDRINUSE`, `tabs serve` probes who
  holds it: a stranger means step to the fallback, but *another TabBrew bridge* means
  refuse to start. A second bridge would be a silent dead end — Chrome takes the lowest
  port that answers, so the new one would sit there receiving nothing while the user
  waited. This is also what keeps the single `outPath` state file to one writer.
- `tabs serve` is a **tolerant reader** of the tab payload — two extension surfaces POST
  different shapes (raw `chrome.Tab` from the developer-mode panel, leaner `TabSnapshot`
  from the side panel), so `StoredTab` types only the fields common to both and everything
  else rides along untouched into the file. Note `chrome.Tab.groupId` is `-1` for ungrouped
  while `TabSnapshot` omits the key.
- `tabbrew-script/` — what's left of the vendored DSL runtime, now just the **parse side**.
  `parser.ts` + `types.ts` are copied from upstream; `types.ts` holds only `Op` /
  `ParseError` / `ParseResult`, because the snapshot shapes it used to carry existed for a
  simulator this repo no longer has. The only edits vs. upstream are the retargeted import
  and `!` assertions forced by `noUncheckedIndexedAccess` (see each file's header).
  `render.ts` is **CLI-native, not a mirror**: `extractFencedTabbrewScript` (a copy of
  `extract.ts`'s fenced-block extractor, minus the Anthropic dependency), `summarizeOps`,
  and `renderParseErrors`. It deliberately renders no tabs — see `tabs list` above.
- `SKILL.md` is the **exception to the copy rule: this repo is its source of truth**, and it
  must not be re-synced from `tabbrew-api`. It documents `tabs list` / `tabs suggest`, which
  don't exist upstream, and it's written for a single `/loop` pass — read the tabs, decide
  (default: do nothing), write the ops, `tabs suggest --note`. It replaced both the three
  chat-shaped variants and the separate `tabbrew-auto` loop skill: with `push` and `check`
  gone, a one-off request and a standing watch are the same three steps, so the two skills
  had nothing left to disagree about (they used to differ on whether a `DEL` needs
  confirming in chat — it doesn't; the panel's Accept button is the confirmation). It's
  embedded via `import … with { type: "text" }`, a compile-time inline that survives
  `--compile` (`assets.d.ts` types the import); `skills.ts` is the bundling module `init`
  reads.

> **Cross-repo (this is still a 3rd copy, but a smaller one):** `parser.ts` and `types.ts`
> have their **source of truth in the `tabbrew` monorepo** (`tabbrew-api/src/tabbrew-script`
> + `tabbrew-skill/runtime/src`). Never edit them here as the primary copy — re-sync on any
> DSL grammar change, and remember a new verb still touches every copy (see the monorepo
> `CLAUDE.md`'s "four-place change" note; this repo is one of them).
>
> **What this repo no longer owes upstream:** deleting `simulate.ts` ended the obligation to
> mirror the extension executor's phase order (`DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE`).
> Nothing here simulates, previews, or orders operations — the extension does all of it — so
> a phase-order change upstream is not a change here. Only the *grammar* is shared.
>
> **`SKILL.md` is not vendored at all.** The `SKILL.*.md` variants that used to be verbatim
> copies of `tabbrew-api/src/skill/portable/*` are gone; the one skill that remains is
> written against this CLI's commands and is owned here.

`registry.ts` is **the command surface as data** — every command's name, help group,
summary, and the flags it accepts. Both `ui.ts`'s `printHelp` and `index.ts`'s
`assertFlagsAllowed` read it, which is what keeps help honest and stops one command's flag
leaking into another. `parseArgs` still needs one flat option table (Node's API), so the
registry is the *second* gate: declare a new flag in `index.ts` **and** attach it to its
command in `registry.ts`, or it will be rejected at runtime. Adding a command = a row here
+ a `case` in `index.ts`; help follows automatically.

**One thing does *not* follow automatically:** `docs/commands.html`, the visual command map,
is a **hand-written mirror** of this table — a card per command, coloured by how far the
command reaches (offline / loopback / account / GitHub Releases). Nothing generates it and
nothing tests it, so a new command, a *deleted* command, a renamed flag, or a reworded
summary has to be carried over by hand or the page quietly goes stale. It was rewritten
for v0.7.0 (the removed commands survive there only as a struck-through "what changed"
strip, which is the one thing a returning reader most needs). It is the only file in the
repo that duplicates `registry.ts`; keep the duplication small enough to be worth it.

Help is **three views** over that one table:
- the **default** (`printHelp()`) — grouped commands (`GROUPS`, ordered by what the CLI is
  *for*, so `tabs` leads) + non-`hidden` `GLOBAL_FLAGS` + the `GETTING_STARTED` block that
  carries onboarding now that the groups aren't journey-ordered;
- **per-command** (`printCommandHelp()`, reached by `tabbrew <cmd> --help` or
  `tabbrew help <cmd>`) — that command's flags plus its optional `details` prose, the
  caveat a one-line `summary` has no room for;
- **`help --all`** (`printHelp(true)`) — adds per-command flags, the two env tables
  (`COMMON_ENV` = what a normal user reaches for, `DEV_ENV` = endpoint/plumbing overrides),
  `FILES`, and reveals `hidden: true` rows (currently `tools repo-info` and `--all` itself).

`index.ts` resolves `--help` through `findCommand` *before* dispatching, which is what
makes the per-command view reachable — don't move that check back above it.

Every rendered row must fit **80 columns**; `SUMMARY_MAX` encodes the budget a command
summary gets after the label column, and `src/registry.test.ts` renders all three views and
fails on any line over 80. That's why the summaries are terse and the long form lives in
`details`. Keep the env tables in sync with `config.ts` and with the **Configuration**
table below — three places, no generator — and `FILES` with `credentials.ts`/`config.ts`.

`ui.ts` centralizes colors (disabled when non-TTY or `NO_COLOR`), holds `link()` (OSC 8
hyperlinks), renders help from the registry, and reads the version from `package.json`
(bundled at compile time). `table.ts` holds the shared column formatting for `docs
list`/`tabs list` — it measures **terminal display width** (CJK/emoji 2, combining marks 0,
CSI/OSC escapes 0), so never pad on `.length`.
`Bun.stringWidth` is the base, but its mark table is wrong in both directions, so `width()`
walks grapheme clusters and corrects it: a combining mark (`Mn`/`Me`/`Cf`) is always 0
(Bun gives Arabic harakat 1) and a spacing character is never 0 (Bun gives Thai/Lao `า`/`ำ`
and the Indic matras 0 — that bug shifted a Thai tab title's whole row two columns right).
Emoji clusters are still delegated to Bun, which gets ZWJ/flag/skin-tone sequences right;
`src/table.test.ts` pins all of it down. The repo/package name is `tabbrew-cli`; the user-facing binary/command is
`tabbrew` (`BIN` in `ui.ts`).

## Project layout

```
src/
  index.ts            # command router — Bun.argv + parseArgs, single error boundary
  config.ts           # env-driven configuration (base URL, client id, endpoints, update)
  auth.ts             # OAuth device-flow logic (request code, poll, pending/slow_down)
  credentials.ts      # token storage (~/.config, chmod 600) + env-var override
  api.ts              # authed fetch wrapper + 401 handling + userinfo + html_files client
  update.ts           # self-update: release lookup, download+checksum, atomic binary swap
  util.ts             # sleep, which(), safeText, open-browser
  registry.ts         # command surface as data: groups, summaries, per-command flags, env tables
  registry.test.ts    # bun test — help fits 80 cols, groups intact, findCommand precedence
  ui.ts               # colors, OSC 8 links, version, help (3 views) rendered from registry.ts
  table.ts            # display-width column padding shared by docs list / tabs list
  table.test.ts       # bun test — pins down width() (CJK, emoji, marks, escapes)
  agents.ts           # init: AgentTarget registry (Claude Code; extensible) + skills dir
  awareness.ts        # init: bundled awareness doc + managed-block string ops
  fsops.ts            # init: atomic write, writeIfChanged, backup, safe read/remove
  assets.d.ts         # ambient `declare module "*.md"` for the text-import skill asset
  tabbrew-script/     # tabs: the parse side of the DSL, plus the skill
    types.ts            #   vendored parse-side types (Op / ParseError / ParseResult)
    parser.ts           #   vendored parseTabbrewScript
    render.ts           #   CLI-native: fenced extractor, op summary, parse-error renderer
    skills.ts           #   bundles SKILL.md as a compile-time string
    SKILL.md            #   the tabbrew-tabs skill (CLI-NATIVE: source of truth is here)
  commands/
    login.ts logout.ts whoami.ts tools.ts init.ts update.ts
    docs.ts             # docs push / list / open
    tabs-errors.ts      # TabsInputError / TabsBridgeError (shared by the tabs commands)
    tabs-serve.ts       # tabs serve — the 127.0.0.1 bridge; owns tabs.json + the ring
    tabs-list.ts        # tabs list  — the suggestion ring + the extension's own snapshot
    tabs-suggest.ts     # tabs suggest — validate, queue with a required --note, return
docs/
  commands.html         # visual command map — hand-written mirror of registry.ts
```

## Configuration

Everything is driven by `TABBREW_*` env vars (resolved once in `config.ts`), so the
same binary can point at prod, staging, or a local server. The defaults target the
hosted TabBrew server at `https://www.tabbrew.com`:

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
| `TABBREW_HTML_LIST_URL` | `$BASE/api/v1/html_files` | Override the `docs list` endpoint (GET) |
| `TABBREW_REPO` | `colevels/tabbrew-cli` | GitHub `owner/name` the `update` release URLs derive from |
| `TABBREW_RELEASE_URL` | `github.com/$REPO/releases/latest` | Override the `update` latest-release redirect URL |
| `TABBREW_DOWNLOAD_BASE_URL` | `github.com/$REPO/releases/latest/download` | Override the `update` release-asset download base |
| `TABBREW_DOWNLOAD_TIMEOUT_MS` | `120000` | `update` binary-download timeout (separate from `TABBREW_TIMEOUT_MS`) |
| `TABBREW_SERVE_PORT` | `49227,49228` | Pins a single loopback port for `tabs serve` (listens) and `tabs suggest` (connects), instead of scanning both. **A test override** — there is no `--port`, and Chrome only reaches those two |
| `TABBREW_TABS_PATH` | `~/.config/tabbrew/tabs.json` | Where `tabs serve` saves the exported tabs + suggestion ring (read by `tabs list`) |
| `TABBREW_TOKEN` | *(unset)* | Use this token directly; **wins over the stored file** (for CI/CD) |
| `TABBREW_NO_BROWSER` | *(unset)* | Print URLs instead of launching a browser (`login`, `docs open`) |
| `TABBREW_TIMEOUT_MS` | `15000` | Per-request timeout in milliseconds (device code / poll / whoami) |
| `TABBREW_DEBUG` | *(unset)* | Print stack traces on unexpected errors |
| `NO_COLOR` | *(unset)* | Disable ANSI colors |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Agent-owned, not TabBrew's: the global dir `init --global` writes to (read in `agents.ts`) |

The server is expected to implement RFC 8628:

- `POST {device code endpoint}` with `client_id` → `{ device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval }`
- `POST {token endpoint}` with `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id=…` → `{ access_token, … }`, or an error body of `authorization_pending` / `slow_down` / `access_denied` / `expired_token`
- `GET {userinfo endpoint}` with `Authorization: Bearer <token>` → any user JSON (the CLI surfaces `id`/`sub`, `email`, `name`/`username`/`login` when present, then prints the full body)

## Build

`bun build --compile` bundles the runtime + code into one self-contained executable
(no Bun install needed on the target machine):

```bash
bun run build          # → dist/tabbrew  (Mach-O / ELF for the current platform)
./dist/tabbrew --help
```

Cross-compile for another target with `--target` (see `bun build --help`), e.g.:

```bash
bun build src/index.ts --compile --target=bun-linux-x64 --outfile dist/tabbrew-linux
```

## Releasing

Releases are **automated** — `.github/workflows/release.yml` builds and publishes on a
`v*` tag push; **do not hand-build release binaries** (a laptop build has no provenance
and isn't reproducible). Cutting a release is two steps:

1. Bump `package.json` `version` via PR → squash-merge to `main`. `VERSION` is read from
   `package.json` at compile time (`ui.ts`), so this bump is what makes `tabbrew update`
   see a newer build.
2. Tag `main` and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The workflow then runs on one `ubuntu-latest` runner (Bun cross-compiles all targets —
no OS matrix) and:
- builds the four targets — asset names are `tabbrew-<os>-<arch>` and **must** match
  `assetName()` in `update.ts` and `install.sh` exactly;
- writes `checksums.txt` (`<sha256>  <asset>` lines — the format `update.ts`'s
  `downloadAndVerify` and `install.sh` both parse);
- records a signed **SLSA build-provenance** attestation via
  `actions/attest-build-provenance` (keyless Sigstore over OIDC), so a download can be
  verified with `gh attestation verify <bin> --repo colevels/tabbrew-cli`;
- creates the GitHub Release with `gh release create --generate-notes` + the assets.

Constraints worth preserving:
- The release must publish as the non-draft, non-prerelease **"latest"** so the
  `releases/latest` 302 redirect that `tabbrew update` follows resolves to it (the
  consumer side is the `update` subsystem above).
- **Bun is pinned** (`bun-version: 1.3.5`) in **both** `ci.yml` and `release.yml` for
  reproducible builds — bump the two together.
- The workflow needs `contents: write` (create the release), `id-token: write` (OIDC
  token the attestation signs with), and `attestations: write`.
- Manual fallback (only if Actions is down): build the four targets + `checksums.txt`
  locally and `gh release create vX.Y.Z --target main --generate-notes …` — but the
  result carries **no** provenance attestation, so prefer re-running the workflow.
