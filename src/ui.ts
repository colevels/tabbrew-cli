import pkg from "../package.json";

export const NAME = pkg.name;
/** The command users type. Repo/package name is `tabbrew-cli`; the binary is `tabbrew`. */
export const BIN = "tabbrew";
export const VERSION = pkg.version;

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const wrap =
  (open: number) =>
  (s: string): string =>
    useColor ? `\x1b[${open}m${s}\x1b[0m` : s;

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
};

/**
 * Wrap text in an OSC 8 terminal hyperlink so a supporting terminal (iTerm2,
 * Terminal.app, VS Code, WezTerm, …) makes it ⌘/Ctrl-clickable. Degrades to plain
 * text when colors are off (non-TTY or NO_COLOR), so piped/CI output and `--json`
 * carry no escape bytes. The visible text is returned unchanged in width, so
 * callers can measure/pad on the plain string and link afterwards.
 */
export function link(url: string, text: string): string {
  if (!useColor) return text;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`; // OSC 8 <url> BEL <text> OSC 8 BEL
}

export function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

/**
 * Print CLI help. The default (`full = false`) is a lean, user-facing summary:
 * commands + the two global options, nothing else. Developer mode
 * (`tabbrew help --all` / `--help --all`) appends the demo command, every
 * per-command flag, the full ENVIRONMENT override table, and the credentials
 * path — the reference surface a maintainer or scripter needs. The env
 * overrides only matter to someone pointing the binary at staging/local or
 * wiring CI, so keeping them out of the default help matches how they're used.
 */
export function printHelp(full = false): void {
  const lines = [
    `${c.bold(BIN)} ${c.dim("v" + VERSION)} — command-line companion to TabBrew (sign in · push HTML docs · check tab scripts · export tabs · run tab scripts · agent init)`,
    "",
    c.bold("USAGE"),
    `  ${BIN} <command> [options]`,
    "",
    c.bold("COMMANDS"),
    "  login              Sign in via OAuth device flow and store the token",
    "  logout             Delete the stored token",
    "  whoami             Verify the token works and print the user profile",
  ];
  if (full) {
    lines.push(
      "  tools repo-info    Demo: orchestrate git (via Bun shell) to report repo stats",
    );
  }
  lines.push(
    "  docs push <file>   Send an HTML file to the TabBrew sidepanel Docs view",
    "  docs list          List the HTML docs you've pushed (titles are click-to-open)",
    "  docs open <id>     Open a pushed HTML doc in your browser",
    "  tabs check <file>  Validate a generated TabBrew Script (add --snapshot for a preview)",
    "  tabs prompt        Print the interactive TabBrew Script skill prompt",
    "  serve              Start a local server so the TabBrew extension can export tabs as JSON",
    "  run <file>         Queue a validated TabBrew Script for the extension to preview & run",
    "  init               Install tabbrew-cli awareness + the tabbrew-tabs skill into an AI agent",
    "  update             Update the installed binary to the latest release",
    "  help               Show this help",
    "",
    c.bold("OPTIONS"),
    "  -h, --help         Show this help",
    "  -v, --version      Print the version",
  );
  if (full) {
    lines.push(
      `  ${c.dim("init:")}`,
      "  -g, --global       Write to the agent's global dir (~/.claude) instead of the cwd",
      "      --dry-run      Print what would change; write nothing",
      "      --uninstall    Remove the awareness doc, managed block, and the tabbrew-tabs skill",
      "  -y, --yes          Skip the confirmation prompt when modifying an existing file",
      "      --agent <id>   Target agent (default claude)",
      "      --skill <v>    Skill variant to install: full|standard|compact (default full)",
      "      --no-skill     Don't install the tabbrew-tabs skill",
      `  ${c.dim("docs push:")}`,
      "      --cloud        Upload the content to cloud storage (≤ 2 MB) instead of registering the local path",
      "      --title <t>    Title shown in the Docs list (default: the doc's <title>, else the filename)",
      `  ${c.dim("docs list:")}`,
      "      --json         Print the raw JSON array instead of a table",
      `  ${c.dim("tabs check:")}`,
      "      --snapshot <f> Snapshot for the before/after preview (Copy-AI-Prompt .md, or a .json payload)",
      "      --json         Print structured JSON (ok/ops/errors/stats/preview) instead of text",
      `  ${c.dim("tabs prompt:")}`,
      "      --variant <v>  Skill prompt variant: full|standard|compact (default full)",
      `  ${c.dim("serve:")}`,
      "      --port <n>     Port to listen on (default 49227) — also serves /script for `run`",
      "      --out <path>   Where to save the tabs JSON (default ~/.config/tabbrew/tabs.json)",
      `  ${c.dim("update:")}`,
      "      --check        Report whether a newer version exists; change nothing (--json for scripting)",
      "",
      c.bold("ENVIRONMENT"),
      "  TABBREW_BASE_URL          Auth server base URL (default https://www.tabbrew.com)",
      "  TABBREW_CLIENT_ID         OAuth client id (default tabbrew-cli)",
      "  TABBREW_SCOPE             Optional OAuth scope",
      "  TABBREW_DEVICE_CODE_URL   Override the device-code endpoint",
      "  TABBREW_TOKEN_URL         Override the token endpoint",
      "  TABBREW_USERINFO_URL      Override the userinfo (whoami) endpoint",
      "  TABBREW_HTML_LOCAL_URL    Override the docs-push local-register endpoint",
      "  TABBREW_HTML_UPLOAD_URL   Override the docs-push cloud-upload endpoint",
      "  TABBREW_HTML_LIST_URL     Override the docs-list endpoint",
      "  TABBREW_TOKEN             Use this token directly (for CI/CD); wins over stored file",
      "  TABBREW_NO_BROWSER        Set to skip auto-opening the browser during login",
      "  TABBREW_TIMEOUT_MS        Per-request timeout in ms (default 15000)",
      "  TABBREW_REPO              GitHub owner/name for `update` (default colevels/tabbrew-cli)",
      "  TABBREW_RELEASE_URL       Override the releases/latest URL used by `update`",
      "  TABBREW_DOWNLOAD_BASE_URL Override the release-asset download base URL used by `update`",
      "  TABBREW_DOWNLOAD_TIMEOUT_MS  Binary-download timeout in ms for `update` (default 120000)",
      "  TABBREW_SERVE_PORT        Override the default port for `serve` (default 49227)",
      "  TABBREW_TABS_PATH         Override the default output path for `serve` (default ~/.config/tabbrew/tabs.json)",
      "  CLAUDE_CONFIG_DIR         Global agent dir used by init --global (default ~/.claude)",
      "  TABBREW_DEBUG             Set to print stack traces on unexpected errors",
      "  NO_COLOR                  Disable ANSI colors",
      "",
      c.bold("CREDENTIALS"),
      "  Stored at ~/.config/tabbrew/credentials.json (chmod 600).",
    );
  } else {
    lines.push(
      "",
      `Run ${c.bold(BIN + " help --all")} for per-command flags and environment overrides.`,
    );
  }
  console.log(lines.join("\n"));
}
