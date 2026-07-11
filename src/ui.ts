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

export function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

export function printHelp(): void {
  const lines = [
    `${c.bold(BIN)} ${c.dim("v" + VERSION)} — test connectivity to a TabBrew server (OAuth device flow)`,
    "",
    c.bold("USAGE"),
    `  ${BIN} <command> [options]`,
    "",
    c.bold("COMMANDS"),
    "  login              Sign in via OAuth device flow and store the token",
    "  logout             Delete the stored token",
    "  whoami             Verify the token works and print the user profile",
    "  tools repo-info    Demo: orchestrate git (via Bun shell) to report repo stats",
    "  init               Install tabbrew-cli awareness into an AI agent (Claude Code)",
    "  help               Show this help",
    "",
    c.bold("OPTIONS"),
    "  -h, --help         Show this help",
    "  -v, --version      Print the version",
    `  ${c.dim("init:")}`,
    "  -g, --global       Write to the agent's global dir (~/.claude) instead of the cwd",
    "      --dry-run      Print what would change; write nothing",
    "      --uninstall    Remove the awareness doc and managed block",
    "  -y, --yes          Skip the confirmation prompt when modifying an existing file",
    "      --agent <id>   Target agent (default claude)",
    "",
    c.bold("ENVIRONMENT"),
    "  TABBREW_BASE_URL          Auth server base URL (default https://www.tabbrew.com)",
    "  TABBREW_CLIENT_ID         OAuth client id (default tabbrew-cli)",
    "  TABBREW_SCOPE             Optional OAuth scope",
    "  TABBREW_DEVICE_CODE_URL   Override the device-code endpoint",
    "  TABBREW_TOKEN_URL         Override the token endpoint",
    "  TABBREW_USERINFO_URL      Override the userinfo (whoami) endpoint",
    "  TABBREW_TOKEN             Use this token directly (for CI/CD); wins over stored file",
    "  TABBREW_NO_BROWSER        Set to skip auto-opening the browser during login",
    "  TABBREW_TIMEOUT_MS        Per-request timeout in ms (default 15000)",
    "  CLAUDE_CONFIG_DIR         Global agent dir used by init --global (default ~/.claude)",
    "  TABBREW_DEBUG             Set to print stack traces on unexpected errors",
    "  NO_COLOR                  Disable ANSI colors",
    "",
    c.bold("CREDENTIALS"),
    "  Stored at ~/.config/tabbrew/credentials.json (chmod 600).",
  ];
  console.log(lines.join("\n"));
}
