// The "what changed" half of the tabs bridge.
//
// `tabs.json` (config.serve.outPath) keeps its original contract — the LATEST
// tab state, overwritten on every POST. That answers "what is open", which is
// all a one-shot handoff ever needed. An agent watching a browser in a loop
// needs the other question, "what just changed", and re-reading 200 tabs per
// tick to diff them by hand is both slow and enormous.
//
// So each accepted POST also appends one line here: a *delta*, not a snapshot.
// A 200-tab snapshot is ~40 KB; 500 of those would be a 20 MB file. A delta is
// normally a few hundred bytes and is exactly what the loop wants to read.
//
// This file is also the one genuinely new privacy surface in the auto-mode
// work: `tabs.json` only ever holds what is currently open, while this log
// accumulates the titles and full URLs of tabs the user has since CLOSED —
// browsing history at rest. Hence, all four of: mode 0600, `historyMax`,
// `tabs serve --no-history`, and `tabs history --clear`.

import { appendFile, stat } from "node:fs/promises";
import { atomicWrite, readFileOrNull } from "./fsops";

/** The fields both extension surfaces send; everything else is ignored. */
export interface HistoryTab {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  windowId?: unknown;
  pinned?: unknown;
  groupId?: unknown;
}

/** One tab in an `added`/`removed` list. Titles are truncated, not full. */
export interface DeltaTab {
  id: number;
  title: string;
  url: string;
  windowId?: number;
}

/** A field that flipped, as `[before, after]`. */
export interface DeltaChange {
  id: number;
  pinned?: [boolean, boolean];
  groupId?: [number | null, number | null];
  windowId?: [number, number];
  url?: [string, string];
}

export interface TabDelta {
  /** The tab-state version this delta produced. */
  v: number;
  at: string;
  source: string;
  counts: { tabs: number; groups: number };
  added: DeltaTab[];
  removed: DeltaTab[];
  changed: DeltaChange[];
  /** Set when a bucket was capped, so a reader never mistakes it for the total. */
  more?: { added?: number; removed?: number; changed?: number };
}

/**
 * Per-bucket cap. Closing a 150-tab window shouldn't produce a 30 KB line —
 * the full state is always in tabs.json, this log only has to convey the shape
 * of the change. `more` carries the count that was dropped so a reader can tell
 * "3 tabs closed" from "3 of 150 tabs closed".
 */
const BUCKET_CAP = 40;
/** Long titles are the main size driver and nothing reads past this. */
const TITLE_CAP = 120;
/** Second ceiling behind historyMax, in case lines are unusually fat. */
const MAX_BYTES = 2 * 1024 * 1024;
/**
 * Trim only once the file is this far past `max`, so a steady stream of posts
 * rewrites the file every SLACK appends rather than on every single one.
 */
const TRIM_SLACK = 50;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const truncate = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, n - 1) + "…";

/** chrome.Tab uses -1 for "ungrouped"; TabSnapshot just omits the key. */
const groupOf = (t: HistoryTab): number | null => {
  const g = num(t.groupId);
  return g !== undefined && g > 0 ? g : null;
};

const toDeltaTab = (t: HistoryTab): DeltaTab => ({
  id: num(t.id) ?? -1,
  title: truncate(str(t.title), TITLE_CAP),
  url: truncate(str(t.url), 300),
  ...(num(t.windowId) === undefined ? {} : { windowId: num(t.windowId) }),
});

function cap<T>(items: T[]): { kept: T[]; dropped: number } {
  if (items.length <= BUCKET_CAP) return { kept: items, dropped: 0 };
  return { kept: items.slice(0, BUCKET_CAP), dropped: items.length - BUCKET_CAP };
}

/**
 * Diff two tab lists into a delta. Pure — the caller owns the clock, the
 * version counter, and the file.
 *
 * Deliberately does NOT track `index`: it shifts for every tab to the right of
 * any close, so a single DEL would report 40 "changed" tabs and drown the real
 * signal. Position lives in the full snapshot, which is always one read away.
 */
export function diffTabs(
  prev: HistoryTab[],
  next: HistoryTab[],
  meta: { v: number; at: string; source: string; groups: number },
): TabDelta {
  const before = new Map<number, HistoryTab>();
  for (const t of prev) {
    const id = num(t.id);
    if (id !== undefined) before.set(id, t);
  }

  const added: DeltaTab[] = [];
  const changed: DeltaChange[] = [];
  const seen = new Set<number>();

  for (const t of next) {
    const id = num(t.id);
    if (id === undefined) continue;
    seen.add(id);
    const was = before.get(id);
    if (!was) {
      added.push(toDeltaTab(t));
      continue;
    }

    const c: DeltaChange = { id };
    let dirty = false;

    const wasPinned = was.pinned === true;
    const isPinned = t.pinned === true;
    if (wasPinned !== isPinned) {
      c.pinned = [wasPinned, isPinned];
      dirty = true;
    }

    const wasGroup = groupOf(was);
    const isGroup = groupOf(t);
    if (wasGroup !== isGroup) {
      c.groupId = [wasGroup, isGroup];
      dirty = true;
    }

    const wasWin = num(was.windowId);
    const isWin = num(t.windowId);
    if (wasWin !== undefined && isWin !== undefined && wasWin !== isWin) {
      c.windowId = [wasWin, isWin];
      dirty = true;
    }

    const wasUrl = str(was.url);
    const isUrl = str(t.url);
    if (wasUrl !== isUrl) {
      c.url = [truncate(wasUrl, 300), truncate(isUrl, 300)];
      dirty = true;
    }

    if (dirty) changed.push(c);
  }

  const removed: DeltaTab[] = [];
  for (const [id, t] of before) {
    if (!seen.has(id)) removed.push(toDeltaTab(t));
  }

  const a = cap(added);
  const r = cap(removed);
  const ch = cap(changed);
  const more: NonNullable<TabDelta["more"]> = {};
  if (a.dropped) more.added = a.dropped;
  if (r.dropped) more.removed = r.dropped;
  if (ch.dropped) more.changed = ch.dropped;

  return {
    v: meta.v,
    at: meta.at,
    source: meta.source,
    counts: { tabs: next.length, groups: meta.groups },
    added: a.kept,
    removed: r.kept,
    changed: ch.kept,
    ...(Object.keys(more).length > 0 ? { more } : {}),
  };
}

/** True when nothing actually moved — the caller skips writing a delta line. */
export const isEmptyDelta = (d: TabDelta): boolean =>
  d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;

/**
 * Read the log, newest last. Tolerant: a truncated or hand-edited line is
 * skipped rather than fatal — this is a convenience log, never a source of
 * truth, and losing the whole file to one bad byte would be worse.
 */
export async function readHistory(path: string): Promise<TabDelta[]> {
  const text = await readFileOrNull(path);
  if (text === null) return [];
  const out: TabDelta[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as TabDelta;
      if (typeof parsed?.v === "number") out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Append one delta, trimming to `max` newest lines when the file has drifted
 * TRIM_SLACK past it (or blown the byte ceiling). `lineCount` is threaded
 * through by the caller so the steady-state path is a single append with no
 * read — pass the returned count back on the next call.
 */
export async function appendDelta(
  path: string,
  delta: TabDelta,
  max: number,
  lineCount: number,
): Promise<number> {
  // mode only applies when appendFile creates the file, which is exactly when
  // it matters — an existing file keeps whatever mode it already had.
  await appendFile(path, JSON.stringify(delta) + "\n", { mode: 0o600 });
  const next = lineCount + 1;
  if (next <= max + TRIM_SLACK) {
    const size = await stat(path).then((s) => s.size).catch(() => 0);
    if (size <= MAX_BYTES) return next;
  }
  return await trimHistory(path, max);
}

/** Rewrite the file with only the newest `max` lines. Returns the new count. */
export async function trimHistory(path: string, max: number): Promise<number> {
  const all = await readHistory(path);
  let kept = all.slice(-max);
  // Second pass for the byte ceiling: drop from the front until it fits, so a
  // run of unusually fat lines can't sit at 2 MB forever.
  let body = kept.map((d) => JSON.stringify(d)).join("\n");
  while (kept.length > 1 && Buffer.byteLength(body) > MAX_BYTES) {
    kept = kept.slice(Math.ceil(kept.length / 4));
    body = kept.map((d) => JSON.stringify(d)).join("\n");
  }
  await atomicWrite(path, body + "\n", 0o600);
  return kept.length;
}

/** Line count without parsing — used once at `tabs serve` startup. */
export async function countHistoryLines(path: string): Promise<number> {
  const text = await readFileOrNull(path);
  if (text === null) return 0;
  return text.split("\n").filter((l) => l.trim()).length;
}
