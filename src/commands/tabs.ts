import { resolve } from "node:path";
import { BIN, c } from "../ui";
import { config } from "../config";
import { colWidth, formatAge, padEnd, truncate } from "../table";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import { simulateBatch, type SimResult } from "../tabbrew-script/simulate";
import type { SnapshotPayload } from "../tabbrew-script/types";
import { SKILL_VARIANTS, DEFAULT_SKILL_VARIANT, isSkillVariant } from "../tabbrew-script/skills";
import {
  compactUrl,
  extractFencedTabbrewScript,
  parseSnapshotMarkdown,
  previewToJson,
  renderParseErrors,
  renderPreview,
  renderSummary,
  stripCountPrefix,
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

// ── tabbrew tabs list ────────────────────────────────────────────────────────

export interface TabsListOptions {
  json?: boolean;
}

/**
 * Two different extension surfaces POST to `tabs serve`, and they send different
 * shapes: the developer-mode Tab List panel sends raw `chrome.Tab` objects,
 * while the side panel's "Send to Claude Code" card sends the leaner
 * `TabSnapshot`. Only these fields are common to both, so only these are read —
 * anything else in the file is ignored rather than treated as a format error.
 */
interface SavedTab {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  windowId?: unknown;
  pinned?: unknown;
  groupId?: unknown;
}

interface SavedTabsFile {
  savedAt?: unknown;
  tabs?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Show what the extension last exported to `tabs serve`. The counterpart to
 * `docs list`: `tabs serve` writes a file and says nothing more about it, so
 * without this the only way to see the result is `cat | jq`.
 */
export async function tabsList(opts: TabsListOptions): Promise<void> {
  const path = config.serve.outPath;
  const file = Bun.file(path);

  if (!(await file.exists())) {
    console.log(
      c.dim("No tabs exported yet.") +
        ` Start the bridge with ${c.bold(`${BIN} tabs serve`)}, then click ${c.bold("Send to Claude Code")} in the TabBrew sidepanel.`,
    );
    return;
  }

  let parsed: SavedTabsFile;
  try {
    parsed = (await file.json()) as SavedTabsFile;
  } catch (e) {
    throw new TabsInputError(
      `Couldn't parse ${path} as JSON: ${(e as Error).message}`,
    );
  }

  if (opts.json) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  const tabs = Array.isArray(parsed.tabs) ? (parsed.tabs as SavedTab[]) : [];
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";

  // The file is a point-in-time snapshot that can be arbitrarily stale, so lead
  // with its age — the ids below are only useful against the browser state it
  // was taken from.
  const when = savedAt ? ` ${c.dim("·")} exported ${c.bold(formatAge(savedAt))}` : "";
  console.log(
    `${c.bold(String(tabs.length))} tab${tabs.length === 1 ? "" : "s"}${when}`,
  );
  console.log(c.dim(`  ${path}`));

  if (tabs.length === 0) return;
  console.log("");

  const view = tabs.map((t) => {
    const title = stripCountPrefix(str(t.title)).trim();
    const url = str(t.url);
    // chrome.Tab uses -1 (TAB_GROUP_ID_NONE) for "ungrouped"; TabSnapshot just
    // omits the field. Both mean the same thing here.
    const gid = typeof t.groupId === "number" && t.groupId > 0 ? t.groupId : null;
    const marks = [t.pinned === true ? "pin" : "", gid ? `@${gid}` : ""]
      .filter(Boolean)
      .join(" ");
    return {
      id: typeof t.id === "number" ? String(t.id) : "—",
      title: truncate(title || compactUrl(url) || "(untitled)", 44),
      url: truncate(compactUrl(url), 46),
      win: typeof t.windowId === "number" ? String(t.windowId) : "—",
      marks,
    };
  });

  const w = {
    id: colWidth("ID", view, "id"),
    title: colWidth("TITLE", view, "title"),
    url: colWidth("URL", view, "url"),
    win: colWidth("WIN", view, "win"),
  };

  console.log(
    c.dim(
      [
        padEnd("ID", w.id),
        padEnd("TITLE", w.title),
        padEnd("URL", w.url),
        padEnd("WIN", w.win),
        "FLAGS",
      ].join("  "),
    ),
  );
  for (const v of view) {
    console.log(
      [
        padEnd(v.id, w.id),
        padEnd(v.title, w.title),
        c.dim(padEnd(v.url, w.url)),
        padEnd(v.win, w.win),
        c.dim(v.marks),
      ].join("  "),
    );
  }
}

// ── input helpers ─────────────────────────────────────────────────────────────

/** Exported for `tabs push`, which needs the same file/stdin reading rules. */
export async function readScriptInput(fileArg: string | undefined): Promise<string> {
  if (fileArg && fileArg !== "-") {
    const abs = resolve(process.cwd(), fileArg);
    const f = Bun.file(abs);
    if (!(await f.exists())) throw new TabsInputError(`Script file not found: ${abs}`);
    return await f.text();
  }
  if (process.stdin.isTTY) {
    throw new TabsInputError(
      `No script given. Pass a file (${BIN} tabs check script.txt) or pipe one (… | ${BIN} tabs check -).`,
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
