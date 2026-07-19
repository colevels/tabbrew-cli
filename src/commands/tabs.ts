import { resolve } from "node:path";
import { BIN, c } from "../ui";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import { simulateBatch, type SimResult } from "../tabbrew-script/simulate";
import type { SnapshotPayload } from "../tabbrew-script/types";
import { SKILL_VARIANTS, DEFAULT_SKILL_VARIANT, isSkillVariant } from "../tabbrew-script/skills";
import {
  extractFencedTabbrewScript,
  parseSnapshotMarkdown,
  previewToJson,
  renderParseErrors,
  renderPreview,
  renderSummary,
  summarizeOps,
} from "../tabbrew-script/render";

/** User-facing input problem (missing file, unreadable snapshot, bad variant). */
export class TabsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabsInputError";
  }
}

// ── tabbrew tabs prompt ──────────────────────────────────────────────────────

export interface TabsPromptOptions {
  variant?: string;
}

/**
 * Print the interactive TabBrew Script skill prompt to stdout — for piping into
 * `pbcopy`, another chat agent, or to read it. Plain text (no ANSI) so it copies
 * clean. `tabbrew init` installs this same prompt as a skill.
 */
export function tabsPrompt(opts: TabsPromptOptions): void {
  const variant = (opts.variant ?? DEFAULT_SKILL_VARIANT).toLowerCase();
  if (!isSkillVariant(variant)) {
    throw new TabsInputError(
      `Unknown --variant "${opts.variant}". Choose one of: compact, standard, full.`,
    );
  }
  const md = SKILL_VARIANTS[variant];
  process.stdout.write(md.endsWith("\n") ? md : md + "\n");
}

// ── tabbrew tabs check ───────────────────────────────────────────────────────

export interface TabsCheckOptions {
  snapshot?: string;
  json?: boolean;
}

/**
 * Validate a generated TabBrew Script before you run it in the extension.
 * Parses the DSL (line-numbered errors, exit 1 on any) and, when a --snapshot is
 * given, simulates a before/after preview. Reads the script from a file arg or
 * from stdin (`-` or no arg). Runs entirely locally — no server, no Chrome.
 */
export async function tabsCheck(
  fileArg: string | undefined,
  opts: TabsCheckOptions,
): Promise<void> {
  const raw = await readScriptInput(fileArg);
  const script = extractFencedTabbrewScript(raw);
  const { ops, errors } = parseTabbrewScript(script);
  const stats = summarizeOps(ops);

  let preview: SimResult | undefined;
  if (opts.snapshot) {
    const payload = await readSnapshot(opts.snapshot);
    preview = simulateBatch(payload, ops);
  }

  const ok = errors.length === 0;

  if (opts.json) {
    console.log(
      JSON.stringify(
        { ok, ops, errors, stats, preview: preview ? previewToJson(preview) : undefined },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
    return;
  }

  if (errors.length > 0) {
    console.error(renderParseErrors(errors));
    // Still show what did parse, so a mostly-good script is useful.
    if (ops.length > 0) console.log("\n" + renderSummary(stats));
    process.exitCode = 1;
    return;
  }

  console.log(renderSummary(stats));
  if (preview) console.log("\n" + renderPreview(preview));
  if (!opts.snapshot && ops.length > 0) {
    console.log(
      c.dim(
        `\nTip: add --snapshot <file> (the extension's "Copy AI Prompt" output) for a before/after preview.`,
      ),
    );
  }
}

// ── input helpers ─────────────────────────────────────────────────────────────

/** Exported for `tabbrew run`, which needs the same file/stdin reading rules. */
export async function readScriptInput(fileArg: string | undefined): Promise<string> {
  if (fileArg && fileArg !== "-") {
    const abs = resolve(process.cwd(), fileArg);
    const f = Bun.file(abs);
    if (!(await f.exists())) throw new TabsInputError(`Script file not found: ${abs}`);
    return await f.text();
  }
  if (process.stdin.isTTY) {
    throw new TabsInputError(
      `No script given. Pass a file (${BIN} tabs check script.tbrew) or pipe one (… | ${BIN} tabs check -).`,
    );
  }
  return await Bun.stdin.text();
}

async function readSnapshot(file: string): Promise<SnapshotPayload> {
  const abs = resolve(process.cwd(), file);
  const f = Bun.file(abs);
  if (!(await f.exists())) throw new TabsInputError(`Snapshot file not found: ${abs}`);
  const text = await f.text();

  // A `.json` file is a raw SnapshotPayload; anything else is treated as the
  // extension's "Copy AI Prompt" markdown and reverse-parsed.
  if (abs.toLowerCase().endsWith(".json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new TabsInputError(`Couldn't parse ${abs} as JSON: ${(e as Error).message}`);
    }
    return coercePayload(parsed);
  }

  try {
    return parseSnapshotMarkdown(text);
  } catch (e) {
    throw new TabsInputError((e as Error).message);
  }
}

/** Tolerant reader for a raw SnapshotPayload JSON (only `tabs` is required). */
function coercePayload(v: unknown): SnapshotPayload {
  if (!v || typeof v !== "object") throw new TabsInputError("Snapshot JSON is not an object.");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.tabs)) {
    throw new TabsInputError('Snapshot JSON is missing a "tabs" array.');
  }
  return {
    tabs: o.tabs as SnapshotPayload["tabs"],
    groups: Array.isArray(o.groups) ? (o.groups as SnapshotPayload["groups"]) : [],
    windows: Array.isArray(o.windows) ? (o.windows as SnapshotPayload["windows"]) : [],
    allowCrossWindow: o.allowCrossWindow === true,
  };
}
