import pkg from "../package.json";
import {
  COMMANDS,
  COMMON_ENV,
  DEV_ENV,
  FILES,
  GETTING_STARTED,
  GLOBAL_FLAGS,
  GROUPS,
  commandLabel,
  flagLabel,
  type CommandSpec,
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

/** Terminal width every help view is laid out against. */
const HELP_WIDTH = 80;

/** Greedy word wrap. Long enough for prose paragraphs; no dependency needed. */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** `  label      summary` rows, aligned on a shared label column. */
function twoCol(
  rows: ReadonlyArray<readonly [string, string]>,
  width: number,
  indent = 2,
): string[] {
  const pad = " ".repeat(indent);
  return rows.map(([label, summary]) => `${pad}${label.padEnd(width)}  ${summary}`);
}

const colWidth = (rows: ReadonlyArray<readonly [string, string]>): number =>
  Math.max(...rows.map(([label]) => label.length));

/**
 * Print CLI help, rendered from the command registry rather than hand-written
 * strings — so a command's flags in help are, by construction, the flags it
 * actually accepts.
 *
 * Help is three views over the same registry:
 *   - the default here (`full = false`) — commands grouped by what they're for,
 *     the global options, and the GETTING STARTED path a first-run user needs;
 *   - `printCommandHelp` below — one command in depth, for `tabbrew <cmd> --help`;
 *   - `tabbrew help --all` (`full = true`) — the reference surface: hidden
 *     commands, every per-command flag, the ENVIRONMENT tables, and FILES.
 * Endpoint overrides only matter to someone pointing the binary at staging/local
 * or wiring CI, so they're split out from the handful a normal user might set.
 */
export function printHelp(full = false): void {
  const lines: string[] = [
    `${c.bold(BIN)} ${c.dim("v" + VERSION)} — the command-line companion to TabBrew`,
    "",
    c.bold("USAGE"),
    `  ${BIN} <command> [options]`,
  ];

  const visible = COMMANDS.filter((cmd) => full || !cmd.hidden);
  const globals = GLOBAL_FLAGS.filter((flag) => full || !flag.hidden);
  // One column across both tables, so the commands and the global options below
  // them read as a single list rather than two ragged ones.
  const labelWidth = Math.max(
    ...visible.map((cmd) => commandLabel(cmd).length),
    ...globals.map((flag) => flagLabel(flag).length),
  );

  for (const group of GROUPS) {
    const inGroup = visible.filter((cmd) => cmd.group === group.id);
    if (inGroup.length === 0) continue;
    lines.push(
      "",
      c.bold(group.title) + (group.blurb ? c.dim(`  ${group.blurb}`) : ""),
      ...twoCol(
        inGroup.map((cmd) => [commandLabel(cmd), cmd.summary] as const),
        labelWidth,
      ),
    );
  }

  lines.push(
    "",
    c.bold("OPTIONS"),
    ...twoCol(
      globals.map((flag) => [flagLabel(flag), flag.summary] as const),
      labelWidth,
    ),
  );

  if (!full) {
    lines.push(
      "",
      c.bold("GETTING STARTED"),
      ...twoCol(GETTING_STARTED, colWidth(GETTING_STARTED)),
      "",
      `Run ${c.bold(BIN + " <cmd> --help")} for one command, ${c.bold(
        BIN + " help --all",
      )} for everything.`,
    );
    console.log(lines.join("\n"));
    return;
  }

  const withFlags = visible.filter((cmd) => cmd.flags.length > 0);
  if (withFlags.length > 0) {
    // Flags sit one level deeper than the command they belong to — at the same
    // indent (as they were) the command name doesn't read as a heading.
    const flagWidth = Math.max(
      ...withFlags.flatMap((cmd) => cmd.flags.map((f) => flagLabel(f).length)),
    );
    lines.push("", c.bold("COMMAND OPTIONS"));
    for (const cmd of withFlags) {
      lines.push(
        `  ${c.bold(cmd.name)}`,
        ...twoCol(
          cmd.flags.map((flag) => [flagLabel(flag), flag.summary] as const),
          flagWidth,
          4,
        ),
      );
    }
  }

  const envWidth = colWidth([...COMMON_ENV, ...DEV_ENV]);
  lines.push("", c.bold("ENVIRONMENT"), ...twoCol(COMMON_ENV, envWidth));
  lines.push(
    "",
    c.bold("ENVIRONMENT") + c.dim(" (pointing the binary at staging or local)"),
    ...twoCol(DEV_ENV, envWidth),
  );
  lines.push("", c.bold("FILES"), ...twoCol(FILES, colWidth(FILES)));

  console.log(lines.join("\n"));
}

/**
 * Print help for one command — what `tabbrew tabs push --help` shows. The
 * summary is the same line the command list carries; `details` is the caveat
 * that had no room there (see `CommandSpec.details`).
 */
export function printCommandHelp(cmd: CommandSpec): void {
  const lines: string[] = [
    cmd.summary,
    "",
    c.bold("USAGE"),
    `  ${BIN} ${commandLabel(cmd)}${cmd.flags.length > 0 ? " [options]" : ""}`,
  ];

  if (cmd.flags.length > 0) {
    lines.push(
      "",
      c.bold("OPTIONS"),
      ...twoCol(
        cmd.flags.map((flag) => [flagLabel(flag), flag.summary] as const),
        colWidth(cmd.flags.map((flag) => [flagLabel(flag), flag.summary] as const)),
      ),
    );
  }

  if (cmd.details) lines.push("", ...wrapText(cmd.details, HELP_WIDTH));

  console.log(lines.join("\n"));
}

