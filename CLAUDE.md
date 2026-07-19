# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
answer is invisible in review — currently `src/table.test.ts` for display-width
measurement. Everything that touches the network, the filesystem, or a real terminal is
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
`UpdateError` (`update.ts`), `TabsInputError` (`commands/tabs.ts`), `ServeError`
(`commands/tabs-serve.ts`), `TabsPushError` (`commands/tabs-push.ts`), and `UsageError`
(`registry.ts`). Throw one of these for any user-facing failure, and **register a new
class in the boundary's `known` list** — anything unlisted surfaces a generic message
unless `TABBREW_DEBUG` is set. Because `parseArgs` runs in `strict` mode, **every
accepted flag must be declared in `index.ts`** — even flags only used by one subcommand
(all the `init` flags are declared there).

`src/config.ts` is the seam that makes the same binary target prod/staging/local:
all configuration comes from `TABBREW_*` env vars with sensible defaults, resolved
once into the exported `config` object. Endpoints derive from `TABBREW_BASE_URL`
unless individually overridden. Route new config through here — the only deliberate
exceptions are the non-`TABBREW_*` presentation/agent knobs read at their point of use
(`NO_COLOR` in `ui.ts`, `TABBREW_DEBUG` in `index.ts`, `CLAUDE_CONFIG_DIR` in
`agents.ts`, which belongs to the agent target, not to TabBrew).

The codebase is four loosely-coupled subsystems that share only `config`, `ui`, and `util`
(the fourth, `tabs`, never talks to the TabBrew server — its only `config` use is
`config.serve`, the loopback port/output path):

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
`CLAUDE.md` that `@import`s it, **and** installs the `tabbrew-tabs` skill (the interactive
NL→TabBrew-Script prompt) into the agent's skills dir — `resolveSkillsDir` on the
`AgentTarget` (`.claude/skills/tabbrew-tabs/` locally, `<config>/skills/…` global). The
skill content is bundled from `tabbrew-script/skills.ts`; `--variant` picks
compact/standard/full (default full) and `--no-skill` skips it (`--uninstall` removes it).
`--variant` is deliberately the same flag name `tabs prompt` uses — it selects from the
same three prompts, and `--no-skill` is the separate install-or-not switch.
Design constraints worth preserving:
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

**4. `tabs` — DSL toolbox + the local bridge**
`tabbrew tabs` is the validator/teacher for the "agent generates a TabBrew Script"
workflow, plus the loopback bridge to the extension. It never touches `chrome.*` —
execution and live snapshots stay in the extension, and **no `tabs` command can change a
user's tabs**. `check`/`prompt`/`list` are fully offline; `serve`/`push` only ever talk to
`127.0.0.1`.
- `commands/tabs.ts` — `tabsCheck` parses a generated script (`parseTabbrewScript`), prints
  line-numbered errors (**exit 1** on any), and — when `--snapshot` is given — runs
  `simulateBatch` for a before/after preview. `tabsPrompt` prints the interactive skill
  prompt. `tabsList` renders the file `tabs serve` wrote. Script input is a file arg or
  stdin (`-`, accepts a whole ` ```tabbrew ` block); `TabsInputError` (registered in the
  `index.ts` boundary) carries file/snapshot problems.
- `commands/tabs-serve.ts` — the bridge. `resolveServePort()` lives here and is the **one**
  place a port is decided; `tabs-push.ts` calls it too, so the listener and the client can't
  disagree (they used to: `push` ignored `--port` and silently queued onto the default).
  Security model: loopback-only bind, **no token**, plus two header gates — `Host` must be
  `127.0.0.1|localhost:<port>` (this is the anti-DNS-rebinding one: a rebound page's GETs are
  *same-origin*, so they carry no `Origin` and the check below can't see them), and `Origin`,
  when present, must be `chrome-extension://` (blocks a drive-by `POST /tabs`). Keep both —
  they cover different halves. `tabs.json` is written `0o600` via `atomicWrite`'s `mode` arg:
  it's browsing history, the config dir is not reliably `0700`, and umask alone gives `0644`.
- `commands/tabs-push.ts` — validates, then POSTs to the bridge. Deliberately **not** named
  `run`: it cannot execute anything, and the old name had users believing their tabs had
  already changed. Rejects a zero-op script locally rather than letting the server's
  empty-body guard answer with a misleading `invalid_payload`.
- `tabs list` is a **tolerant reader** — two extension surfaces POST different shapes (raw
  `chrome.Tab` from the developer-mode panel, leaner `TabSnapshot` from the side panel), so
  it reads only the fields common to both and ignores the rest. Note `chrome.Tab.groupId`
  is `-1` for ungrouped while `TabSnapshot` omits the key.
- `tabbrew-script/` — a **curated, Chrome-free vendor** of the DSL runtime. `parser.ts` +
  `simulate.ts` + `types.ts` are copied from `tabbrew-skill/runtime/src`; the snapshot
  *types* are pulled into `types.ts` so nothing imports the `chrome.*`-using `snapshot.ts`.
  The only edits vs. upstream are the retargeted import and `!` assertions forced by
  `noUncheckedIndexedAccess` (see each file's header). `render.ts` is **CLI-native, not a
  mirror**: the `parseSnapshotMarkdown` reverse-parser (Copy-AI-Prompt markdown →
  `SnapshotPayload`), a copy of `extract.ts`'s fenced-block extractor, and the summary /
  preview renderers.
- `SKILL.{compact,standard,full}.md` are verbatim copies of the `tabbrew-api` portable skill
  variants, embedded via `import … with { type: "text" }` — a compile-time inline (no
  runtime FS read, survives `--compile`; `assets.d.ts` types the import). `skills.ts` is the
  bundling module `init` and `tabs prompt` both read.

> **Cross-repo (this is a 4th copy):** the vendored `parser.ts`/`simulate.ts`/`types.ts` and
> the `SKILL.*.md` prompts have their **source of truth in the `tabbrew` monorepo**
> (`tabbrew-api/src/tabbrew-script` + `tabbrew-skill/runtime/src`, and
> `tabbrew-api/src/skill/portable/*`). Never edit them here as the primary copy — re-sync on
> any DSL grammar / phase-order change. `simulate.ts` MUST mirror the extension executor's
> phase order (`DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE`), and a new verb touches every
> copy (see the monorepo `CLAUDE.md`'s "four-place change" note).

`registry.ts` is **the command surface as data** — every command's name, help group,
summary, and the flags it accepts. Both `ui.ts`'s `printHelp` and `index.ts`'s
`assertFlagsAllowed` read it, which is what keeps help honest and stops one command's flag
leaking into another. `parseArgs` still needs one flat option table (Node's API), so the
registry is the *second* gate: declare a new flag in `index.ts` **and** attach it to its
command in `registry.ts`, or it will be rejected at runtime. Adding a command = a row here
+ a `case` in `index.ts`; help follows automatically. Help is **two-tier**: the default
prints grouped commands (`GROUPS`) + `GLOBAL_FLAGS` only, while `help --all` adds
per-command flags and the two env tables (`COMMON_ENV` = what a normal user reaches for,
`DEV_ENV` = endpoint/plumbing overrides) and reveals `hidden: true` rows (currently
`tools repo-info`). Keep the env tables in sync with `config.ts` and with the
**Configuration** table below — three places, no generator.

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
  ui.ts               # colors, OSC 8 links, version, help (two-tier) rendered from registry.ts
  table.ts            # display-width column padding shared by docs list / tabs list
  table.test.ts       # bun test — pins down width() (CJK, emoji, marks, escapes)
  agents.ts           # init: AgentTarget registry (Claude Code; extensible) + skills dir
  awareness.ts        # init: bundled awareness doc + managed-block string ops
  fsops.ts            # init: atomic write, writeIfChanged, backup, safe read/remove
  assets.d.ts         # ambient `declare module "*.md"` for the text-import skill assets
  tabbrew-script/     # tabs: offline DSL toolbox
    types.ts            #   vendored DSL + snapshot types (Chrome-free)
    parser.ts           #   vendored parseTabbrewScript
    simulate.ts         #   vendored simulateBatch (mirrors executor phase order)
    render.ts           #   CLI-native: snapshot reverse-parser, fenced extractor, renderers
    skills.ts           #   bundled interactive skill prompts (text imports)
    SKILL.{compact,standard,full}.md  # verbatim tabbrew-api portable variants (source of truth upstream)
  commands/
    login.ts logout.ts whoami.ts tools.ts init.ts update.ts
    docs.ts             # docs push / list / open
    tabs.ts             # tabs check / prompt / list  (offline)
    tabs-serve.ts       # tabs serve — the 127.0.0.1 bridge; owns resolveServePort()
    tabs-push.ts        # tabs push  — validate, then queue on the bridge
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
| `TABBREW_SERVE_PORT` | `49227` | Loopback port shared by `tabs serve` (listens) and `tabs push` (connects) |
| `TABBREW_TABS_PATH` | `~/.config/tabbrew/tabs.json` | Where `tabs serve` saves the exported tabs (read by `tabs list`) |
| `TABBREW_TOKEN` | *(unset)* | Use this token directly; **wins over the stored file** (for CI/CD) |
| `TABBREW_NO_BROWSER` | *(unset)* | Set to skip auto-opening the browser during `login` |
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
