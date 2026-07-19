import pkg from "../package.json";
import {
  COMMANDS,
  COMMON_ENV,
  DEV_ENV,
  GLOBAL_FLAGS,
  GROUPS,
  commandLabel,
  flagLabel,
} from "./registry";

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
 * Print CLI help, rendered from the command registry rather than hand-written
 * strings — so a command's flags in help are, by construction, the flags it
 * actually accepts.
 *
 * The default (`full = false`) is a lean, user-facing summary: commands grouped
 * by what they're for, plus the two global options. Developer mode
 * (`tabbrew help --all` / `--help --all`) adds hidden commands, every
 * per-command flag, the ENVIRONMENT override tables, and the credentials path —
 * the reference surface a maintainer or scripter needs. Endpoint overrides only
 * matter to someone pointing the binary at staging/local or wiring CI, so
 * they're split out from the handful a normal user might set.
 */
export function printHelp(full = false): void {
  const lines: string[] = [
    `${c.bold(BIN)} ${c.dim("v" + VERSION)} — the command-line companion to TabBrew`,
    "",
    c.bold("USAGE"),
    `  ${BIN} <command> [options]`,
  ];

  const visible = COMMANDS.filter((cmd) => full || !cmd.hidden);
  const labelWidth = Math.max(...visible.map((cmd) => commandLabel(cmd).length));

  for (const group of GROUPS) {
    const inGroup = visible.filter((cmd) => cmd.group === group.id);
    if (inGroup.length === 0) continue;
    lines.push("", c.bold(group.title));
    for (const cmd of inGroup) {
      lines.push(`  ${commandLabel(cmd).padEnd(labelWidth)}  ${cmd.summary}`);
    }
  }

  lines.push("", c.bold("OPTIONS"));
  for (const flag of GLOBAL_FLAGS) {
    lines.push(`  ${flagLabel(flag).padEnd(labelWidth)}  ${flag.summary}`);
  }

  if (!full) {
    lines.push(
      "",
      `Run ${c.bold(BIN + " help --all")} for per-command flags and environment overrides.`,
    );
    console.log(lines.join("\n"));
    return;
  }

  const withFlags = visible.filter((cmd) => cmd.flags.length > 0);
  if (withFlags.length > 0) {
    const flagWidth = Math.max(
      ...withFlags.flatMap((cmd) => cmd.flags.map((f) => flagLabel(f).length)),
    );
    lines.push("", c.bold("COMMAND OPTIONS"));
    for (const cmd of withFlags) {
      lines.push(`  ${c.dim(cmd.name + ":")}`);
      for (const flag of cmd.flags) {
        lines.push(`  ${flagLabel(flag).padEnd(flagWidth)}  ${flag.summary}`);
      }
    }
  }

  const envWidth = Math.max(
    ...[...COMMON_ENV, ...DEV_ENV].map(([name]) => name.length),
  );
  const envBlock = (rows: ReadonlyArray<readonly [string, string]>): string[] =>
    rows.map(([name, summary]) => `  ${name.padEnd(envWidth)}  ${summary}`);

  lines.push("", c.bold("ENVIRONMENT"), ...envBlock(COMMON_ENV));
  lines.push(
    "",
    c.bold("ENVIRONMENT") + c.dim(" (pointing the binary at staging or local)"),
    ...envBlock(DEV_ENV),
  );
  lines.push(
    "",
    c.bold("CREDENTIALS"),
    "  Stored at ~/.config/tabbrew/credentials.json (chmod 600).",
  );

  console.log(lines.join("\n"));
}

