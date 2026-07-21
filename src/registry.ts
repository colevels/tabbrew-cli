// The command surface, as data: what commands exist, how they group in `help`,
// and which flags each one accepts.
//
// Both the help renderer (ui.ts) and the argument validator (index.ts) read this
// one table, so a command can't drift out of its own documentation and can't
// silently swallow a flag that belongs to a different command. Before this
// existed the help text was hand-written strings that had already drifted —
// `serve`'s help advertised a `--port` that `run` was documented to share but
// could not actually read, so a script queued with `--port` went to the default
// port instead, reporting success.
//
// Adding a command means adding a row here, a `case` in index.ts, and nothing
// else — help output and flag validation follow automatically.

/** A user-facing failure in how the command was invoked (unknown flag for it). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface FlagSpec {
  /** Long name as typed, minus the leading `--`. Matches the parseArgs key. */
  name: string;
  /** Single-letter alias, if the flag has one. */
  short?: string;
  /** Value placeholder shown in help; omitted for booleans. */
  value?: string;
  summary: string;
  /** Accepted, but kept out of the default help; shown under `help --all`. */
  hidden?: boolean;
}

export type CommandGroup = "tabs" | "docs" | "account" | "setup";

export interface CommandSpec {
  /** The command exactly as typed, e.g. "tabs push". Also the lookup key. */
  name: string;
  /** Positional placeholder shown in help, e.g. "<file>". */
  args?: string;
  group: CommandGroup;
  /** One line, ≤ SUMMARY_MAX chars so the help row fits an 80-column terminal. */
  summary: string;
  /**
   * The caveat a summary has no room for — shown only by `tabbrew <cmd> --help`,
   * so the one-line view stays scannable without losing what a user needs to
   * know before running the thing. Written as prose; the renderer wraps it.
   */
  details?: string;
  flags: readonly FlagSpec[];
  /** Kept out of the default help; listed only under `help --all`. */
  hidden?: boolean;
}

/**
 * Heading each group prints under in `help`, in display order.
 *
 * Ordered by what the CLI is *for*, not by the order a new user meets it: tabs
 * are the product, so they lead. Onboarding (`init`, `login`) is served by the
 * GETTING STARTED block at the foot of the help instead — the same split `gh`
 * and `docker` use, and it keeps the top of the screen useful for the returning
 * user who just wants the name of a command.
 */
export const GROUPS: ReadonlyArray<{
  id: CommandGroup;
  title: string;
  blurb?: string;
}> = [
  { id: "tabs", title: "TABS", blurb: "organize your Chrome tabs" },
  { id: "docs", title: "DOCS", blurb: "send HTML into the sidepanel" },
  { id: "account", title: "ACCOUNT" },
  { id: "setup", title: "SETUP" },
];

/** Accepted everywhere, so never counted as a stray flag. */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: "help", short: "h", summary: "Show this help" },
  { name: "version", short: "v", summary: "Print the version" },
  {
    name: "all",
    // Hidden by default: the footer line already points at `help --all`, and a
    // flag whose summary has to say "with `help`:" is noise in a global list.
    hidden: true,
    summary: "With `help`: add per-command flags and env overrides",
  },
];

/**
 * Longest a `summary` may be. The help row is 2 spaces + the label column +
 * 2 spaces + the summary, and the longest label is `tabs suggest <file>` (19),
 * so anything past this wraps on an 80-column terminal — which reads as broken
 * output, not as a long sentence. Pinned by registry.test.ts.
 */
export const SUMMARY_MAX = 57;

// Display order *is* array order (ui.ts filters by group, it never sorts), so
// these are grouped and sequenced deliberately. Within `tabs` that means
// workflow order — serve the bridge, read what arrived, propose a change — which
// is also the whole loop, in three commands.
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "tabs serve",
    group: "tabs",
    summary: "Start the local bridge the extension exports your tabs to",
    details:
      "Long-running: it binds 127.0.0.1 only and blocks until Ctrl+C, so start it " +
      "in a second shell. The extension POSTs your open tabs to it, and it saves " +
      "them (mode 0600 — they're browsing history) for `tabs list` to read. It also " +
      "hands your queued suggestion to the extension and records what you decided.",
    flags: [
      {
        name: "out",
        value: "<path>",
        summary: "Where to save the received tabs JSON",
      },
    ],
  },
  {
    name: "tabs list",
    group: "tabs",
    summary: "Show the tabs the extension last sent, and recent answers",
    details:
      "Reads the file `tabs serve` wrote — a snapshot on disk, not a live query, so " +
      "check the age it prints before trusting the tab ids. Prints the extension's " +
      "own snapshot format, preceded by what became of your recent suggestions " +
      "(accepted, denied and why, or still waiting).",
    flags: [
      { name: "json", summary: "Print the raw saved JSON instead" },
    ],
  },
  {
    name: "tabs suggest",
    args: "<file>",
    group: "tabs",
    summary: "Propose a script, with a note they read before deciding",
    details:
      "Validates the script, then puts it in front of the user in the TabBrew " +
      "sidepanel. --note is required: it's the plain sentence they read before " +
      "deciding, so say what changes and lead with anything that closes tabs. " +
      "Returns as soon as it's queued — the answer shows up in `tabs list`. Nothing " +
      "the CLI does can change your tabs.",
    flags: [
      {
        name: "note",
        value: "<text>",
        summary: "Required. What this does, in the user's language",
      },
      { name: "json", summary: "Print structured JSON instead of text" },
    ],
  },

  {
    name: "docs push",
    args: "<file>",
    group: "docs",
    summary: "Send an HTML file to the TabBrew sidepanel Docs view",
    details:
      "Local by default: it registers the file's absolute path, so the doc opens as " +
      "a file:// URL on this machine only. Use --cloud to upload the content " +
      "(≤ 2 MB) when you want to read it from another machine.",
    flags: [
      {
        name: "cloud",
        summary:
          "Upload the content (≤ 2 MB) instead of the local path",
      },
      {
        name: "title",
        value: "<t>",
        summary:
          "Title in the Docs list (default: the doc's <title>)",
      },
    ],
  },
  {
    name: "docs list",
    group: "docs",
    summary: "List your pushed docs (titles are click-to-open)",
    flags: [
      { name: "json", summary: "Print the raw JSON array instead of a table" },
    ],
  },
  {
    name: "docs open",
    args: "<id>",
    group: "docs",
    summary: "Open a pushed HTML doc in your browser",
    flags: [],
  },

  {
    name: "login",
    group: "account",
    summary: "Sign in via OAuth device flow and store the token",
    details:
      "Opens a browser and prints a code to enter there. The token is stored at " +
      "~/.config/tabbrew/credentials.json (chmod 600). Set TABBREW_TOKEN instead to " +
      "authenticate without an interactive login, e.g. in CI.",
    flags: [],
  },
  {
    name: "whoami",
    group: "account",
    summary: "Print the signed-in user (exit 1 if signed out)",
    flags: [],
  },
  {
    name: "logout",
    group: "account",
    summary: "Delete the stored token",
    flags: [],
  },

  {
    name: "init",
    group: "setup",
    summary: "Set up an AI agent to use tabbrew (+ the tabs skill)",
    details:
      "Writes a TABBREW-CLI.md awareness doc plus a managed block in the agent's " +
      "CLAUDE.md that imports it, and installs the tabbrew-tabs skill: read the " +
      "tabs, propose a change, let you accept or deny it. Idempotent — a re-run " +
      "reports `unchanged`. --uninstall removes all of it.",
    flags: [
      {
        name: "global",
        short: "g",
        summary: "Write to the agent's global dir instead of the cwd",
      },
      { name: "dry-run", summary: "Print what would change; write nothing" },
      {
        name: "uninstall",
        summary: "Remove the awareness doc, managed block, and skills",
      },
      {
        name: "yes",
        short: "y",
        summary: "Skip the confirmation prompt on an existing file",
      },
      { name: "agent", value: "<id>", summary: "Target agent (default claude)" },
      { name: "no-skill", summary: "Don't install the tabbrew-tabs skill" },
    ],
  },
  {
    name: "update",
    group: "setup",
    summary: "Update the installed binary to the latest release",
    details:
      "Downloads the newest GitHub release, verifies its SHA-256, and swaps it over " +
      "the running binary. Refuses to run from `bun run src/index.ts` so it never " +
      "overwrites bun itself. --check only reports, and always exits 0.",
    flags: [
      {
        name: "check",
        summary:
          "Report whether a newer version exists; change nothing",
      },
      { name: "json", summary: "Machine-readable output for --check" },
    ],
  },
  {
    name: "tools repo-info",
    group: "setup",
    hidden: true,
    summary: "Demo: orchestrate git via Bun shell for repo stats",
    flags: [],
  },
  {
    name: "help",
    group: "setup",
    summary: "Show this help",
    flags: [],
  },
];

/**
 * The first-run path, shown at the foot of the default help. This is where
 * onboarding lives now that the groups are ordered by value rather than by
 * journey — one block a new user can follow top to bottom.
 */
export const GETTING_STARTED: ReadonlyArray<[string, string]> = [
  ["tabbrew init", "teach your AI agent that this CLI exists"],
  ["tabbrew login", "sign in to your TabBrew account"],
  ["tabbrew tabs serve", "run in a 2nd shell; the extension sends your tabs over"],
  ["tabbrew tabs list", "check they arrived, then ask your agent to tidy them"],
];

/**
 * Where the CLI keeps state, listed under `help --all`. Hardcoded defaults, like
 * the env tables below — they're documentation of the shipped behaviour, not a
 * readout of the resolved config, which keeps ui.ts from importing config.ts.
 * Keep in sync with credentials.ts (CRED_PATH) and config.ts (`serve.out`).
 */
export const FILES: ReadonlyArray<[string, string]> = [
  ["~/.config/tabbrew/credentials.json", "Stored login token (chmod 600)"],
  ["~/.config/tabbrew/tabs.json", "Tabs `tabs serve` received (mode 0600)"],
];

/** Environment overrides a normal user might reach for. */
export const COMMON_ENV: ReadonlyArray<[string, string]> = [
  ["TABBREW_TOKEN", "Use this token; wins over the stored file"],
  ["TABBREW_TABS_PATH", "Where `tabs serve` saves the tabs it receives"],
  ["TABBREW_NO_BROWSER", "Set to skip auto-opening the browser during login"],
  ["TABBREW_DEBUG", "Set to print stack traces on unexpected errors"],
  ["NO_COLOR", "Disable ANSI colors"],
];

/** Endpoint/plumbing overrides — only useful pointing the binary at staging or local. */
export const DEV_ENV: ReadonlyArray<[string, string]> = [
  ["TABBREW_BASE_URL", "Auth server base URL (default www.tabbrew.com)"],
  ["TABBREW_CLIENT_ID", "OAuth client id (default tabbrew-cli)"],
  ["TABBREW_SCOPE", "Optional OAuth scope"],
  ["TABBREW_DEVICE_CODE_URL", "Override the device-code endpoint"],
  ["TABBREW_TOKEN_URL", "Override the token endpoint"],
  ["TABBREW_USERINFO_URL", "Override the userinfo (whoami) endpoint"],
  ["TABBREW_HTML_LOCAL_URL", "Override the docs-push local-register endpoint"],
  ["TABBREW_HTML_UPLOAD_URL", "Override the docs-push cloud-upload endpoint"],
  ["TABBREW_HTML_LIST_URL", "Override the docs-list endpoint"],
  ["TABBREW_TIMEOUT_MS", "Per-request timeout in ms (default 15000)"],
  ["TABBREW_REPO", "GitHub owner/name `update` pulls releases from"],
  ["TABBREW_RELEASE_URL", "Override the releases/latest URL used by `update`"],
  ["TABBREW_DOWNLOAD_BASE_URL", "Override the release-asset download base URL"],
  ["TABBREW_DOWNLOAD_TIMEOUT_MS", "Binary-download timeout in ms (default 120000)"],
  ["TABBREW_SERVE_PORT", "Bridge port; the extension hard-codes 49227"],
  ["CLAUDE_CONFIG_DIR", "Global agent dir used by `init --global`"],
];

/** The label shown in help: the command plus its positional placeholder. */
export const commandLabel = (cmd: CommandSpec): string =>
  cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;

/** How a flag is written in help: `-g, --global <v>`. */
export const flagLabel = (flag: FlagSpec): string => {
  const head = flag.short ? `-${flag.short}, --${flag.name}` : `    --${flag.name}`;
  return flag.value ? `${head} ${flag.value}` : head;
};

/**
 * Match argv's positionals to a command. Every command is one or two words, and
 * a two-word match wins — so `tabs push` resolves to itself, never to a bare
 * `tabs`. Returns undefined for an unknown command; the caller reports that.
 */
export function findCommand(positionals: readonly string[]): CommandSpec | undefined {
  const two = positionals.slice(0, 2).join(" ");
  const one = positionals[0] ?? "";
  return (
    COMMANDS.find((cmd) => cmd.name === two) ?? COMMANDS.find((cmd) => cmd.name === one)
  );
}

/**
 * Reject flags that exist in the CLI but not on *this* command. `parseArgs` runs
 * one flat option table (Node requires every accepted flag declared up front),
 * which on its own lets `docs push --port 99` through silently. This is the
 * second gate that makes the flat table safe.
 */
export function assertFlagsAllowed(
  cmd: CommandSpec | undefined,
  values: Record<string, unknown>,
): void {
  if (!cmd) return; // unknown command — the router reports that instead
  const allowed = new Set<string>([
    ...GLOBAL_FLAGS.map((f) => f.name),
    ...cmd.flags.map((f) => f.name),
  ]);
  const stray = Object.keys(values).filter(
    (name) => values[name] !== undefined && !allowed.has(name),
  );
  if (stray.length === 0) return;

  const offenders = stray.map((name) => `--${name}`).join(", ");
  const accepted = cmd.flags.length
    ? `\`${cmd.name}\` accepts: ${cmd.flags.map((f) => `--${f.name}`).join(", ")}`
    : `\`${cmd.name}\` takes no options.`;
  throw new UsageError(
    `${offenders} ${stray.length === 1 ? "is not an option" : "are not options"} for \`${cmd.name}\`.\n  ${accepted}`,
  );
}
