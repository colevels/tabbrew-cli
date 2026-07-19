// Pins the help layout, the way table.test.ts pins display width: what breaks
// here is invisible in a diff. A summary two characters too long doesn't look
// wrong in registry.ts — it looks wrong in a user's 80-column terminal, where
// the row wraps and the whole screen reads as broken output.
import { expect, test } from "bun:test";
import { printCommandHelp, printHelp } from "./ui";
import {
  COMMANDS,
  GROUPS,
  SUMMARY_MAX,
  commandLabel,
  findCommand,
} from "./registry";

const TERM_WIDTH = 80;

/** Colors are decided at import time from `isTTY`, so measure on stripped text. */
const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;.*?\x07/g, "");

function capture(render: () => void): string[] {
  const original = console.log;
  const chunks: string[] = [];
  console.log = (...args: unknown[]) => void chunks.push(args.join(" "));
  try {
    render();
  } finally {
    console.log = original;
  }
  return stripAnsi(chunks.join("\n")).split("\n");
}

const tooWide = (lines: string[]): string[] =>
  lines.filter((line) => line.length > TERM_WIDTH);

test("the default help fits an 80-column terminal", () => {
  expect(tooWide(capture(() => printHelp()))).toEqual([]);
});

test("`help --all` fits an 80-column terminal", () => {
  expect(tooWide(capture(() => printHelp(true)))).toEqual([]);
});

test("every command's own help fits an 80-column terminal", () => {
  for (const cmd of COMMANDS) {
    expect({
      cmd: cmd.name,
      wide: tooWide(capture(() => printCommandHelp(cmd))),
    }).toEqual({ cmd: cmd.name, wide: [] });
  }
});

test("summaries stay inside the width the label column leaves them", () => {
  // SUMMARY_MAX is derived from the longest label; if a longer command lands
  // here, the constant is stale and the rows above will start wrapping.
  const widest = Math.max(...COMMANDS.map((cmd) => commandLabel(cmd).length));
  expect(2 + widest + 2 + SUMMARY_MAX).toBeLessThanOrEqual(TERM_WIDTH);
  for (const cmd of COMMANDS) {
    expect({ cmd: cmd.name, len: cmd.summary.length > SUMMARY_MAX }).toEqual({
      cmd: cmd.name,
      len: false,
    });
  }
});

test("every command lands in a group, and no group is left empty", () => {
  const ids = new Set(GROUPS.map((group) => group.id));
  for (const cmd of COMMANDS) expect(ids.has(cmd.group)).toBe(true);
  for (const group of GROUPS) {
    expect({
      group: group.id,
      any: COMMANDS.some((cmd) => cmd.group === group.id),
    }).toEqual({ group: group.id, any: true });
  }
});

test("a two-word command beats a one-word match", () => {
  // `index.ts` resolves `--help` against this before dispatching, so a
  // regression here would send `tabs push --help` to the wrong command.
  expect(findCommand(["tabs", "push"])?.name).toBe("tabs push");
  expect(findCommand(["docs", "open", "42"])?.name).toBe("docs open");
  expect(findCommand(["tabs"])).toBeUndefined();
  expect(findCommand(["bogus"])).toBeUndefined();
});
