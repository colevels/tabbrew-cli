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
}

export type CommandGroup = "account" | "docs" | "tabs" | "setup";

export interface CommandSpec {
  /** The command exactly as typed, e.g. "tabs push". Also the lookup key. */
  name: string;
  /** Positional placeholder shown in help, e.g. "<file>". */
  args?: string;
  group: CommandGroup;
  summary: string;
  flags: readonly FlagSpec[];
  /** Kept out of the default help; listed only under `help --all`. */
  hidden?: boolean;
}

/** Heading each group prints under in `help`, in display order. */
export const GROUPS: ReadonlyArray<{ id: CommandGroup; title: string }> = [
  { id: "account", title: "ACCOUNT" },
  { id: "docs", title: "DOCS" },
  { id: "tabs", title: "TABS" },
  { id: "setup", title: "SETUP" },
];

/** Accepted everywhere, so never counted as a stray flag. */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: "help", short: "h", summary: "Show this help" },
  { name: "version", short: "v", summary: "Print the version" },
  {
    name: "all",
    summary: "With `help`: add per-command flags and environment overrides",
  },
];

const VARIANT_FLAG: FlagSpec = {
  name: "variant",
  value: "<v>",
  summary: "Skill prompt variant: full|standard|compact (default full)",
};

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "login",
    group: "account",
    summary: "Sign in via OAuth device flow and store the token",
    flags: [],
  },
  {
    name: "logout",
    group: "account",
    summary: "Delete the stored token",
    flags: [],
  },
  {
    name: "whoami",
    group: "account",
    summary: "Verify the token works and print the user profile",
    flags: [],
  },

  {
    name: "docs push",
    args: "<file>",
    group: "docs",
    summary: "Send an HTML file to the TabBrew sidepanel Docs view",
    flags: [
      {
        name: "cloud",
        summary:
          "Upload the content to cloud storage (≤ 2 MB) instead of registering the local path",
      },
      {
        name: "title",
        value: "<t>",
        summary:
          "Title shown in the Docs list (default: the doc's <title>, else the filename)",
      },
    ],
  },
  {
    name: "docs list",
    group: "docs",
    summary: "List the HTML docs you've pushed (titles are click-to-open)",
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
    name: "tabs check",
    args: "<file>",
    group: "tabs",
    summary: "Validate a generated TabBrew Script (add --snapshot for a preview)",
    flags: [
      {
        name: "snapshot",
        value: "<f>",
        summary:
          "Snapshot for the before/after preview (Copy-AI-Prompt .md, or a .json payload)",
      },
      {
        name: "json",
        summary:
          "Print structured JSON (ok/ops/errors/stats/preview) instead of text",
      },
    ],
  },
  {
    name: "tabs push",
    args: "<file>",
    group: "tabs",
    summary: "Send a validated TabBrew Script to the extension to preview & run",
    flags: [
      {
        name: "port",
        value: "<n>",
        summary: "Port `tabs serve` is listening on (default 49227)",
      },
    ],
  },
  {
    name: "tabs serve",
    group: "tabs",
    summary: "Start the local bridge the extension exports your tabs to",
    flags: [
      { name: "port", value: "<n>", summary: "Port to listen on (default 49227)" },
      {
        name: "out",
        value: "<path>",
        summary: "Where to save the tabs JSON (default ~/.config/tabbrew/tabs.json)",
      },
    ],
  },
  {
    name: "tabs list",
    group: "tabs",
    summary: "Show the tabs the extension last exported",
    flags: [
      { name: "json", summary: "Print the raw saved JSON instead of a table" },
    ],
  },
  {
    name: "tabs prompt",
    group: "tabs",
    summary: "Print the interactive TabBrew Script skill prompt",
    flags: [VARIANT_FLAG],
  },

  {
    name: "init",
    group: "setup",
    summary: "Install tabbrew-cli awareness + the tabbrew-tabs skill into an AI agent",
    flags: [
      {
        name: "global",
        short: "g",
        summary: "Write to the agent's global dir (~/.claude) instead of the cwd",
      },
      { name: "dry-run", summary: "Print what would change; write nothing" },
      {
        name: "uninstall",
        summary: "Remove the awareness doc, managed block, and the tabbrew-tabs skill",
      },
      {
        name: "yes",
        short: "y",
        summary: "Skip the confirmation prompt when modifying an existing file",
      },
      { name: "agent", value: "<id>", summary: "Target agent (default claude)" },
      VARIANT_FLAG,
      { name: "no-skill", summary: "Don't install the tabbrew-tabs skill" },
    ],
  },
  {
    name: "update",
    group: "setup",
    summary: "Update the installed binary to the latest release",
    flags: [
      {
        name: "check",
        summary:
          "Report whether a newer version exists; change nothing (--json for scripting)",
      },
      { name: "json", summary: "Machine-readable output for --check" },
    ],
  },
  {
    name: "tools repo-info",
    group: "setup",
    hidden: true,
    summary: "Demo: orchestrate git (via Bun shell) to report repo stats",
    flags: [],
  },
  {
    name: "help",
    group: "setup",
    summary: "Show this help",
    flags: [],
  },
];

/** Environment overrides a normal user might reach for. */
export const COMMON_ENV: ReadonlyArray<[string, string]> = [
  ["TABBREW_TOKEN", "Use this token directly (for CI/CD); wins over stored file"],
  ["TABBREW_SERVE_PORT", "Default port for `tabs serve`/`tabs push` (default 49227)"],
  ["TABBREW_TABS_PATH", "Where `tabs serve` saves tabs (default ~/.config/tabbrew/tabs.json)"],
  ["TABBREW_NO_BROWSER", "Set to skip auto-opening the browser during login"],
  ["TABBREW_DEBUG", "Set to print stack traces on unexpected errors"],
  ["NO_COLOR", "Disable ANSI colors"],
];

/** Endpoint/plumbing overrides — only useful pointing the binary at staging or local. */
export const DEV_ENV: ReadonlyArray<[string, string]> = [
  ["TABBREW_BASE_URL", "Auth server base URL (default https://www.tabbrew.com)"],
  ["TABBREW_CLIENT_ID", "OAuth client id (default tabbrew-cli)"],
  ["TABBREW_SCOPE", "Optional OAuth scope"],
  ["TABBREW_DEVICE_CODE_URL", "Override the device-code endpoint"],
  ["TABBREW_TOKEN_URL", "Override the token endpoint"],
  ["TABBREW_USERINFO_URL", "Override the userinfo (whoami) endpoint"],
  ["TABBREW_HTML_LOCAL_URL", "Override the docs-push local-register endpoint"],
  ["TABBREW_HTML_UPLOAD_URL", "Override the docs-push cloud-upload endpoint"],
  ["TABBREW_HTML_LIST_URL", "Override the docs-list endpoint"],
  ["TABBREW_TIMEOUT_MS", "Per-request timeout in ms (default 15000)"],
  ["TABBREW_REPO", "GitHub owner/name for `update` (default colevels/tabbrew-cli)"],
  ["TABBREW_RELEASE_URL", "Override the releases/latest URL used by `update`"],
  ["TABBREW_DOWNLOAD_BASE_URL", "Override the release-asset download base URL"],
  ["TABBREW_DOWNLOAD_TIMEOUT_MS", "Binary-download timeout in ms (default 120000)"],
  ["CLAUDE_CONFIG_DIR", "Global agent dir used by init --global (default ~/.claude)"],
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
