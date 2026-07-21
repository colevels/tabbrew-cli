import { config } from "../config";
import { formatAge, padEnd, width } from "../table";
import { BIN, c } from "../ui";
import { TabsInputError } from "./tabs-errors";

export interface TabsListOptions {
  json?: boolean;
}

/**
 * The `tabs serve` state file, read tolerantly — every field is optional, since
 * a file written by an older build is a normal thing to meet, not an error.
 */
interface SavedState {
  version?: unknown;
  savedAt?: unknown;
  count?: unknown;
  tabs?: unknown;
  windows?: unknown;
  snapshot?: unknown;
  suggestions?: unknown;
}

interface SavedSuggestion {
  note?: unknown;
  opCount?: unknown;
  queuedAt?: unknown;
  decision?: unknown;
  reason?: unknown;
  decidedAt?: unknown;
}

/** Past this, the snapshot is old enough that the tab ids are probably fiction. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Show what the extension last sent to `tabs serve`, plus what became of the
 * last few suggestions.
 *
 * The tab list itself is printed as the extension's **own** rendered snapshot
 * markdown (`# Cross-window / # Windows / # Groups / # Tabs`), verbatim. That is
 * deliberate on two counts: it's the exact format the TabBrew Script skill is
 * written against, so an agent reads it without a translation step — and the
 * extension already renders it, so the CLI never reimplements (and drifts from)
 * `renderSnapshot`. When the payload has no snapshot, this says so rather than
 * growing a second renderer to fall back to.
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

  let parsed: SavedState;
  try {
    parsed = (await file.json()) as SavedState;
  } catch (e) {
    throw new TabsInputError(
      `Couldn't parse ${path} as JSON: ${(e as Error).message}`,
    );
  }

  if (opts.json) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
  const version = typeof parsed.version === "number" ? parsed.version : 0;
  const windows = Array.isArray(parsed.windows) ? parsed.windows.length : 0;

  const head = [
    `${c.bold(String(tabs.length))} tab${tabs.length === 1 ? "" : "s"}`,
    windows > 0 ? `${windows} window${windows === 1 ? "" : "s"}` : "",
    version > 0 ? c.dim(`v${version}`) : "",
    savedAt ? c.dim(`exported ${formatAge(savedAt)}`) : "",
  ].filter(Boolean);
  console.log(head.join(c.dim(" · ")));

  // stderr, not stdout: an agent parses stdout, and a warning it didn't ask for
  // shouldn't land in the middle of the snapshot it's reading.
  if (savedAt && Date.now() - new Date(savedAt).getTime() > STALE_AFTER_MS) {
    console.error(
      c.yellow("! This snapshot is stale.") +
        c.dim(
          " The extension stopped sending — check that the TabBrew sidepanel is open and Auto mode is on.",
        ),
    );
  }

  const suggestions = Array.isArray(parsed.suggestions)
    ? (parsed.suggestions as SavedSuggestion[])
    : [];
  if (suggestions.length > 0) {
    console.log("");
    console.log(c.dim("recent suggestions"));
    for (const line of renderSuggestions(suggestions)) console.log(line);
  }

  console.log("");
  const snapshot = typeof parsed.snapshot === "string" ? parsed.snapshot.trim() : "";
  if (snapshot) {
    console.log(snapshot);
    return;
  }

  console.log(
    c.yellow("No rendered snapshot in this export.") +
      ` It came from the developer-mode panel or an older extension build.`,
  );
  console.log(
    c.dim(
      `  Open the TabBrew sidepanel and click ${c.bold("Send to Claude Code")} to get one, ` +
        `or read the raw payload with ${c.bold(`${BIN} tabs list --json`)}.`,
    ),
  );
}

/**
 * The suggestion ring, newest first. This is the agent's memory of what it
 * proposed and what the user said back — an undecided entry is the signal to
 * wait rather than pile a second proposal on top of the first.
 */
function renderSuggestions(suggestions: SavedSuggestion[]): string[] {
  const rows = suggestions.map((s) => {
    const decision = typeof s.decision === "string" ? s.decision : "";
    const at =
      (typeof s.decidedAt === "string" && s.decidedAt) ||
      (typeof s.queuedAt === "string" && s.queuedAt) ||
      "";
    return {
      age: at ? formatAge(at) : "unknown",
      state: decision ? decision.toUpperCase() : "PENDING",
      note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : "(no note)",
      reason: typeof s.reason === "string" && s.reason.trim() ? s.reason.trim() : "",
      ops: typeof s.opCount === "number" ? s.opCount : null,
      decision,
    };
  });

  const ageW = Math.max(...rows.map((r) => width(r.age)));
  const stateW = Math.max(...rows.map((r) => width(r.state)));

  return rows.map((r) => {
    const paint =
      r.decision === "accepted"
        ? c.green
        : r.decision === "denied" || r.decision === "failed"
          ? c.red
          : r.decision === "stale"
            ? c.yellow
            : c.cyan;
    const tail = r.reason
      ? ` ${c.dim("—")} ${c.dim(`"${r.reason}"`)}`
      : r.ops !== null && r.decision === "accepted"
        ? c.dim(` (${r.ops} op${r.ops === 1 ? "" : "s"})`)
        : "";
    return `  ${c.dim(padEnd(r.age, ageW))}  ${paint(padEnd(r.state, stateW))}  ${r.note}${tail}`;
  });
}
