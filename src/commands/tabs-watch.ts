import { config } from "../config";
import { readFileOrNull } from "../fsops";
import { formatAge } from "../table";
import { compactUrl, stripCountPrefix } from "../tabbrew-script/render";
import type { TabDelta } from "../tabs-history";
import { resolveServePort } from "./tabs-serve";
import { TabsPushError } from "./tabs-push";
import { BIN, c } from "../ui";

export interface TabsWatchOptions {
  port?: number;
  since?: number;
  /** Seconds to wait for a change before giving up. */
  timeout?: number;
  changesOnly?: boolean;
  json?: boolean;
}

interface WatchResponse {
  version?: number;
  savedAt?: string;
  source?: string;
  count?: number;
  tabs?: unknown[];
  snapshot?: string;
  changes?: TabDelta[];
  changesTruncated?: boolean;
}

/** Ceiling matching the server's; anything longer is silently clamped there. */
const MAX_TIMEOUT_S = 300;

/**
 * `tabbrew tabs watch` — block until the extension reports a *new* tab state,
 * then print what changed plus the current snapshot.
 *
 * This is the eye of the auto-mode loop, and the reason it long-polls rather
 * than sleeping in a shell loop: an agent tick costs tokens, so waking up only
 * when something actually moved is the difference between a loop that watches a
 * browser and one that burns a context window doing it.
 *
 * A timeout is NOT an error — it prints nothing to stdout and exits 0, so the
 * caller branches on empty output instead of on an exit code.
 */
export async function tabsWatch(opts: TabsWatchOptions): Promise<void> {
  const port = resolveServePort(opts.port);
  const since = opts.since ?? (await lastSeenVersion());
  const timeoutS = Math.min(
    Math.max(opts.timeout ?? 60, 0),
    MAX_TIMEOUT_S,
  );
  const waitMs = timeoutS * 1000;

  const url = `http://127.0.0.1:${port}/tabs?since=${since}&wait=${waitMs}`;

  let res: Response;
  try {
    // No AbortSignal.timeout here: the server holds the request open on
    // purpose, and it already caps `wait` at its own ceiling. A client-side
    // timer would just race that and report a false failure.
    res = await fetch(url);
  } catch {
    throw new TabsPushError(
      `Nothing is listening on 127.0.0.1:${port} — start the bridge with \`${BIN} tabs serve\` first` +
        (opts.port === undefined ? "." : ", or pass a matching --port."),
    );
  }

  if (res.status === 204) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, changed: false, since }, null, 2));
      return;
    }
    // stderr, so a caller piping stdout sees genuinely nothing.
    console.error(
      c.dim(
        `No tab changes in ${timeoutS}s (since v${since}). ` +
          `Is Auto mode on in the TabBrew sidepanel?`,
      ),
    );
    return;
  }

  if (!res.ok) {
    throw new TabsPushError(`The bridge returned HTTP ${res.status}.`);
  }

  const body = (await res.json().catch(() => null)) as WatchResponse | null;
  if (!body || typeof body.version !== "number") {
    throw new TabsPushError("The bridge returned an unreadable tab state.");
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, changed: true, ...body }, null, 2));
    return;
  }

  const tabCount = body.count ?? body.tabs?.length ?? 0;
  const age = body.savedAt ? ` ${c.dim("·")} ${formatAge(body.savedAt)}` : "";
  console.log(
    `${c.bold(`version ${body.version}`)} ${c.dim("·")} ${tabCount} tab${tabCount === 1 ? "" : "s"}${age}`,
  );

  const changes = body.changes ?? [];
  if (changes.length > 0) {
    console.log("");
    console.log(renderChanges(changes, since, body.changesTruncated === true));
  }

  if (opts.changesOnly) return;

  console.log("");
  if (typeof body.snapshot === "string" && body.snapshot.trim()) {
    // The extension's own "Copy AI Prompt" markdown — the exact format the
    // TabBrew Script skill is written against, so it goes through untouched.
    console.log(body.snapshot.trimEnd());
  } else {
    // Pre-auto-mode extension: it only sent bare tabs, no rendered snapshot.
    console.log(
      c.dim(
        `(this extension build didn't send a snapshot — run \`${BIN} tabs list\` for the tab table)`,
      ),
    );
  }
}

/** `+3 opened / −1 closed / ~2 changed`, then the tabs behind those numbers. */
export function renderChanges(
  changes: TabDelta[],
  since: number,
  truncated: boolean,
): string {
  const added = changes.flatMap((d) => d.added);
  const removed = changes.flatMap((d) => d.removed);
  const changed = changes.flatMap((d) => d.changed);
  const extra = changes.reduce(
    (n, d) => n + (d.more?.added ?? 0) + (d.more?.removed ?? 0) + (d.more?.changed ?? 0),
    0,
  );

  const lines: string[] = [];
  const head = [
    added.length > 0 ? c.green(`+${added.length} opened`) : "",
    removed.length > 0 ? c.red(`-${removed.length} closed`) : "",
    changed.length > 0 ? c.dim(`~${changed.length} changed`) : "",
  ].filter(Boolean);
  lines.push(
    `${c.bold(`## Changed since v${since}`)}${head.length ? " " + c.dim("·") + " " + head.join(c.dim(" / ")) : ""}`,
  );

  const LIST_CAP = 12;
  for (const t of added.slice(0, LIST_CAP)) {
    lines.push(`  ${c.green("+")} ${label(t.title, t.url)}`);
  }
  for (const t of removed.slice(0, LIST_CAP)) {
    lines.push(`  ${c.red("-")} ${label(t.title, t.url)}`);
  }
  for (const ch of changed.slice(0, LIST_CAP)) {
    lines.push(`  ${c.dim("~")} ${c.dim(`#${ch.id}`)} ${describeChange(ch)}`);
  }

  const hidden =
    Math.max(0, added.length - LIST_CAP) +
    Math.max(0, removed.length - LIST_CAP) +
    Math.max(0, changed.length - LIST_CAP) +
    extra;
  if (hidden > 0) lines.push(c.dim(`  … and ${hidden} more`));
  if (truncated) {
    lines.push(
      c.dim("  (older changes rolled off — this is a partial list of what moved)"),
    );
  }
  return lines.join("\n");
}

const label = (title: string, url: string): string => {
  const t = stripCountPrefix(title).trim();
  const u = compactUrl(url);
  if (!t) return u || "(untitled)";
  return `${t}${u ? " " + c.dim(u) : ""}`;
};

function describeChange(ch: TabDelta["changed"][number]): string {
  const bits: string[] = [];
  if (ch.pinned) bits.push(ch.pinned[1] ? "pinned" : "unpinned");
  if (ch.groupId) {
    const [from, to] = ch.groupId;
    bits.push(to === null ? "ungrouped" : from === null ? `grouped @${to}` : `regrouped @${to}`);
  }
  if (ch.windowId) bits.push(`moved to window ${ch.windowId[1]}`);
  if (ch.url) bits.push(`navigated → ${compactUrl(ch.url[1])}`);
  return bits.join(", ") || "changed";
}

/**
 * Default `--since`: the version already on disk. `tabs serve` writes it there
 * on every post, so a bare `tabs watch` blocks until something genuinely newer
 * than what the caller could already read shows up.
 */
async function lastSeenVersion(): Promise<number> {
  const text = await readFileOrNull(config.serve.outPath);
  if (text === null) return 0;
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return typeof v === "number" && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}
