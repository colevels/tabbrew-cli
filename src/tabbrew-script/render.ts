// CLI-native — NOT a vendored mirror. Everything here is owned by tabbrew-cli:
//   - compactUrl / stripCountPrefix: the two pure title/url helpers (copied from
//     tabbrew-skill/runtime/src/snapshot.ts so nothing pulls in chrome.*)
//   - extractFencedTabbrewScript: mirror of tabbrew-api/src/lib/extract.ts (minus
//     the Anthropic dependency) so `check` tolerates a whole ```tabbrew message
//   - parseSnapshotMarkdown: the reverse of the extension's buildAiPrompt markdown
//     (# Windows / # Groups / # Tabs JSONL) → a typed SnapshotPayload the simulator
//     consumes. No such reverse parser exists upstream; it's the preview enabler.
//   - the op-summary and before/after preview renderers.

import { c } from "../ui";
import { truncate } from "../table";
import type {
  GroupSnapshot,
  Op,
  ParseError,
  SnapshotPayload,
  TabSnapshot,
  WindowSnapshot,
} from "./types";
import type { SimChange, SimResult, SimTab } from "./simulate";

// ── pure title/url helpers (copied from snapshot.ts) ────────────────────────

const MAX_URL_LEN = 80;

export const compactUrl = (raw: string): string => {
  if (!raw) return "";
  const stripped = raw.replace(/^https?:\/\/(www\.)?/i, "");
  const normalized = stripped === raw ? raw : stripped;
  return normalized.length > MAX_URL_LEN ? normalized.slice(0, MAX_URL_LEN - 1) + "…" : normalized;
};

export const stripCountPrefix = (raw: string): string => raw.replace(/^\(\d+\+?\)\s+/, "");

// ── fenced-block extraction (mirror of extract.ts) ──────────────────────────

const FENCE_LINE = /^\s*```/;

export const extractFencedTabbrewScript = (text: string): string => {
  const fenced = text.match(/```(?:tabbrew|dsl)?\s*\n([\s\S]*?)\n?```/i);
  if (fenced) return fenced[1]!.trim();
  return text
    .split(/\r?\n/)
    .filter((line) => !FENCE_LINE.test(line))
    .join("\n")
    .trim();
};

// ── snapshot markdown → payload (the reverse of buildAiPrompt) ───────────────

/** Collect the lines under a `# <name>` header, up to the next `# ` header. */
const collectSection = (md: string, name: string): string[] => {
  const out: string[] = [];
  let inSection = false;
  const headerRe = /^#\s+(\S+)/;
  for (const line of md.split(/\r?\n/)) {
    const h = headerRe.exec(line);
    if (h) {
      inSection = h[1]!.toLowerCase() === name.toLowerCase();
      continue;
    }
    if (inSection) out.push(line);
  }
  return out;
};

const jsonlObjects = (lines: string[]): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      // Skip a malformed JSONL line rather than failing the whole snapshot.
    }
  }
  return out;
};

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/**
 * Parse the extension's "Copy AI Prompt" output (or just its snapshot portion)
 * back into a SnapshotPayload. Leading prompt/prose is ignored — sections are
 * located by their `# <Name>` headers. Throws if no `# Tabs` entries are found.
 */
export const parseSnapshotMarkdown = (md: string): SnapshotPayload => {
  const allowCrossWindow = /^#\s*Cross-window:\s*yes\b/im.test(md);

  const windows: WindowSnapshot[] = jsonlObjects(collectSection(md, "Windows")).map((w) => ({
    id: num(w.id),
    focused: w.focused === true,
    tabCount: num(w.tabCount),
  }));

  const groups: GroupSnapshot[] = jsonlObjects(collectSection(md, "Groups")).map((g) => ({
    id: num(g.id),
    windowId: num(g.winId),
    title: str(g.title),
    ...(typeof g.color === "string" ? { color: g.color } : {}),
    tabCount: num(g.tabCount),
  }));

  const tabs: TabSnapshot[] = jsonlObjects(collectSection(md, "Tabs")).map((t) => ({
    id: num(t.id),
    index: num(t.idx),
    pinned: t.pinned === true,
    title: str(t.title),
    url: str(t.url),
    windowId: num(t.winId),
    ...(typeof t.groupId === "number" ? { groupId: t.groupId } : {}),
    ...(t.active === true ? { active: true } : {}),
  }));

  if (tabs.length === 0) {
    throw new Error(
      'No "# Tabs" entries found in the snapshot. Paste the output of the extension\'s ' +
        '"Copy AI Prompt" button — it contains the # Windows / # Groups / # Tabs sections.',
    );
  }

  // If # Windows was omitted but tabs reference windows, synthesize rows so the
  // simulator has windows to recount.
  if (windows.length === 0) {
    const winIds = Array.from(new Set(tabs.map((t) => t.windowId)));
    for (const id of winIds) windows.push({ id, focused: winIds.length === 1, tabCount: 0 });
  }

  return { tabs, groups, windows, allowCrossWindow };
};

// ── op summary ──────────────────────────────────────────────────────────────

export type OpStats = {
  total: number;
  byVerb: Record<string, number>;
  delCount: number;
  affectedCount: number;
};

const VERB_ORDER = ["DEL", "UNPIN", "UNGROUP", "GROUP", "PIN", "MOVE"];

export const summarizeOps = (ops: Op[]): OpStats => {
  const byVerb: Record<string, number> = {};
  const affected = new Set<number>();
  let delCount = 0;
  for (const op of ops) {
    byVerb[op.verb] = (byVerb[op.verb] ?? 0) + 1;
    if (op.verb === "MOVE") {
      affected.add(op.id);
    } else {
      for (const id of op.ids) affected.add(id);
      if (op.verb === "DEL") delCount += op.ids.length;
    }
  }
  return { total: ops.length, byVerb, delCount, affectedCount: affected.size };
};

// ── renderers (colored strings; caller console.logs) ────────────────────────

export const renderParseErrors = (errors: ParseError[]): string => {
  const head = c.red(`✗ ${errors.length} parse error${errors.length === 1 ? "" : "s"}:`);
  const body = errors.map((e) => {
    const src = e.raw.trim() || "(blank line)";
    return `  ${c.dim(`line ${e.line}:`)} ${src}\n            ${c.yellow("→ " + e.reason)}`;
  });
  return [head, ...body].join("\n");
};

export const renderSummary = (stats: OpStats): string => {
  if (stats.total === 0) {
    return c.green("✓ No-op") + c.dim(" — the script has no operations (comments/blank only).");
  }
  const parts = VERB_ORDER.filter((v) => stats.byVerb[v]).map((v) => `${v} ${stats.byVerb[v] ?? 0}`);
  const head = `${c.green("✓ Parsed")} ${c.bold(String(stats.total))} op${
    stats.total === 1 ? "" : "s"
  }  ${c.dim("· " + parts.join(", "))}`;
  const affects = `  affects ${stats.affectedCount} tab${stats.affectedCount === 1 ? "" : "s"}`;
  const del = stats.delCount > 0 ? c.yellow(`  ·  ${stats.delCount} to close (DEL — destructive)`) : "";
  return [head, c.dim(affects) + del].join("\n");
};

const fmtTab = (t: TabSnapshot): string => {
  const title = stripCountPrefix(t.title).trim() || compactUrl(t.url) || "(untitled)";
  // truncate(), not slice() — a code-unit cut splits an emoji's surrogate pair
  // into mojibake and orphans a Thai vowel from its consonant.
  return `#${t.id} ${truncate(title, 34)}`;
};

const joinCapped = (items: string[], cap = 6): string =>
  items.length <= cap
    ? items.join(" · ")
    : items.slice(0, cap).join(" · ") + c.dim(` · +${items.length - cap} more`);

export const renderPreview = (sim: SimResult): string => {
  const lines: string[] = [c.bold("Preview") + c.dim("  (simulated · directional, not exact)")];
  const withChange = (change: SimChange): SimTab[] => sim.tabs.filter((t) => t.changes.includes(change));

  const row = (label: string, tabs: TabSnapshot[], color: (s: string) => string): void => {
    if (tabs.length === 0) return;
    lines.push(
      `  ${color(label.padEnd(8))} ${c.dim(String(tabs.length).padStart(2))}  ${joinCapped(tabs.map(fmtTab))}`,
    );
  };

  row("close", sim.deleted, c.red);
  row("pin", withChange("pinned"), c.green);
  row("unpin", withChange("unpinned"), c.cyan);
  row("ungroup", withChange("ungrouped"), c.cyan);

  const grouped = withChange("grouped");
  if (grouped.length > 0) {
    const byGroup = new Map<number, SimTab[]>();
    for (const t of grouped) {
      if (t.groupId === undefined) continue;
      const arr = byGroup.get(t.groupId) ?? [];
      arr.push(t);
      byGroup.set(t.groupId, arr);
    }
    const groupTitle = (gid: number): string => {
      const grp = sim.groups.find((g) => g.id === gid);
      if (!grp) return `@${gid}`;
      return `"${grp.title}"${grp.isNew ? c.dim(" (new)") : ""}`;
    };
    const segs = Array.from(byGroup.entries()).map(
      ([gid, tabs]) => `→ ${groupTitle(gid)}: ${joinCapped(tabs.map((t) => "#" + t.id), 8)}`,
    );
    lines.push(`  ${c.green("group".padEnd(8))} ${c.dim(String(grouped.length).padStart(2))}  ${segs.join("  ")}`);
  }

  row("move", withChange("moved"), c.cyan);

  if (sim.droppedStaleIds.length > 0) {
    const n = sim.droppedStaleIds.length;
    lines.push(
      c.yellow(`  ⚠ ${n} stale id${n === 1 ? "" : "s"} dropped`) +
        c.dim(` (not in snapshot): ${sim.droppedStaleIds.join(", ")}`),
    );
  }

  if (lines.length === 1) lines.push(c.dim("  (no visible changes against this snapshot)"));
  return lines.join("\n");
};

/** Compact preview for `--json` (mirrors renderPreview's buckets). */
export const previewToJson = (sim: SimResult) => ({
  deleted: sim.deleted.map((t) => t.id),
  pinned: sim.tabs.filter((t) => t.changes.includes("pinned")).map((t) => t.id),
  unpinned: sim.tabs.filter((t) => t.changes.includes("unpinned")).map((t) => t.id),
  grouped: sim.tabs
    .filter((t) => t.changes.includes("grouped"))
    .map((t) => ({ id: t.id, groupId: t.groupId })),
  ungrouped: sim.tabs.filter((t) => t.changes.includes("ungrouped")).map((t) => t.id),
  moved: sim.tabs
    .filter((t) => t.changes.includes("moved"))
    .map((t) => ({ id: t.id, index: t.index, windowId: t.windowId })),
  groups: sim.groups.map((g) => ({ id: g.id, title: g.title, isNew: !!g.isNew, tabCount: g.tabCount })),
  droppedStaleIds: sim.droppedStaleIds,
});
