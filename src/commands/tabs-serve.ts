import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWrite, readFileOrNull } from "../fsops";
import { config } from "../config";
import { BIN, c } from "../ui";

/** The port is already in use, or the server died on start. */
export class ServeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServeError";
  }
}

/**
 * Wire-protocol version, echoed by `GET /health`. Both ends of this bridge move
 * independently — the extension updates through the Web Store, the CLI through
 * `tabbrew update` — so neither may assume the other is current.
 *
 *   1 = script-only (`POST /tabs` + `GET /script`)
 *   2 = added tab versioning, long-poll watching, the suggestion/decision round trip
 *   3 = dropped the long polls and the legacy `/script` routes; the verdict is
 *       recorded in the state file instead of being waited on over the wire
 *
 * A protocol-2 extension is fully served by a protocol-3 bridge: the four routes
 * it actually calls — `POST /tabs`, `GET /suggestion`, `POST /decision`,
 * `GET /health` — are unchanged. What went is the three long polls only the CLI
 * ever issued (`GET /tabs`, `GET /history`, `GET /decision`) and the protocol-1
 * `/script` pair.
 */
const PROTOCOL = 3;

/**
 * How many suggestions the state file remembers. This is the agent's memory of
 * what it proposed and what the user said — small on purpose: it exists so a
 * loop tick can see "my last suggestion was denied, and why", not to build a
 * history of the user's decisions.
 */
const SUGGESTION_RING = 5;

/**
 * A tab as the extension sends it. Only the fields both extension surfaces
 * agree on — the developer-mode panel POSTs raw `chrome.Tab`, the side panel
 * POSTs the leaner `TabSnapshot`. Everything else rides along untouched inside
 * the state file.
 */
interface StoredTab {
  id?: number;
  title?: string;
  url?: string;
  windowId?: number;
  pinned?: boolean;
  groupId?: number;
}

type DecisionKind = "accepted" | "denied" | "stale" | "failed";

/**
 * One proposal and its fate. `decision: null` means the user hasn't answered
 * yet — the signal a watching agent needs to shut up and wait rather than
 * queueing a second suggestion on top of the first.
 *
 * `failed` is not a user decision: it's "the user said yes and Chrome refused".
 * It exists because the alternative was recording `accepted` for a batch that
 * errored, which tells a watching agent its plan worked when the tabs never
 * moved, and it will happily build the next suggestion on that fiction.
 */
interface SuggestionRecord {
  id: string;
  note: string | null;
  opCount: number | null;
  basedOn: number | null;
  queuedAt: string;
  decision: DecisionKind | null;
  reason: string | null;
  decidedAt: string | null;
}

interface TabState {
  version: number;
  savedAt: string;
  source: string;
  count: number;
  tabs: StoredTab[];
  groups: unknown[];
  windows: unknown[];
  allowCrossWindow: boolean;
  /** The extension's own rendered "Copy AI Prompt" markdown, when it sent one. */
  snapshot?: string;
  /** Newest first, capped at SUGGESTION_RING. */
  suggestions: SuggestionRecord[];
}

/** The queued-but-unclaimed suggestion, as `GET /suggestion` hands it over. */
interface PendingSuggestion {
  id: string;
  script: string;
  note: string | null;
  basedOn: number | null;
  queuedAt: string;
}

const isDecision = (v: unknown): v is DecisionKind =>
  v === "accepted" || v === "denied" || v === "stale" || v === "failed";

/**
 * `tabbrew tabs serve` — the local HTTP bridge the TabBrew Chrome extension
 * talks to. It receives the extension's tab state (saved as JSON on disk), hands
 * out the script queued by `tabs suggest`, and records the user's accept/deny
 * answer back into that same file for `tabs list` to report.
 *
 * Binds 127.0.0.1 only (hardcoded, not overridable) — that's the whole security
 * model, no auth token. The Host/Origin checks add cheap defense-in-depth; they
 * are deliberately one self-contained block so they're easy to rip out.
 *
 * Every route is a plain request/response. Nothing long-polls: the extension
 * polls on its own timer, and the verdict is read from disk on the next
 * `tabs list` rather than waited on over a held-open socket.
 *
 * The state path is deliberately NOT a flag. It used to be `--out`, which moved
 * only the writer: `tabs list` and `tabs suggest` kept reading
 * `config.serve.outPath`, so a served `--out ./here.json` left them silently
 * reporting a stale default file. That is the same reader/writer split `--port`
 * was removed for. `TABBREW_TABS_PATH` moves all three at once, so it is the
 * only override.
 */
export async function tabsServe(): Promise<void> {
  const port = config.serve.port;
  const outPath = config.serve.outPath;

  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });

  let tabState: TabState | null = await seedTabState(outPath);
  // The suggestion ring outlives any single tab state — it's what the agent
  // reads to know it was denied, so it must survive both a tab change (which
  // rebuilds tabState wholesale) and a restart of this process.
  let suggestions: SuggestionRecord[] = tabState?.suggestions ?? [];

  // Single unclaimed script at a time — `tabs suggest` overwrites, the
  // extension's poll pops (claims + clears) it. Lives only for this process's
  // lifetime; it's meant to be picked up within seconds.
  let pending: PendingSuggestion | null = null;

  // Writes are serialized through one chain. Three handlers persist, and two of
  // them belong to different clients — the extension POSTs /tabs while the CLI
  // POSTs /suggestion — so two writes really can be in flight at once. Without
  // this, each one serializes the state it saw on entry and the *later* rename
  // wins, which can silently roll back a version bump or drop a suggestion that
  // was added while an earlier write was still landing. Chaining also means each
  // write reads the state at its own turn, not at the caller's.
  let writes: Promise<void> = Promise.resolve();

  /**
   * 0600, like credentials.json. This is the URL and title of every open tab —
   * browsing state, which is arguably worse to leak than the token: a token is
   * revocable, a history isn't, and full URLs carry more than hostnames
   * (account paths, doc links, share links with tokens in the query string).
   * The default umask would leave it 0644, and the config dir is not reliably
   * 0700, so the file mode is the only thing actually protecting it.
   */
  function persist(): Promise<void> {
    const next = writes.then(async () => {
      // Nothing to write until the extension has sent tabs at least once. A
      // suggestion queued before then still lives in memory and still reaches
      // the extension; it just isn't on disk for `tabs list` to report yet.
      if (!tabState) return;
      tabState = { ...tabState, suggestions };
      await atomicWrite(outPath, JSON.stringify(tabState, null, 2) + "\n", 0o600);
    });
    // The chain must survive a failed write. Without swallowing the rejection
    // here, one transient ENOSPC would leave `writes` permanently rejected and
    // every later persist would be skipped without ever being attempted. The
    // caller still sees the real error through `next`.
    writes = next.catch(() => {});
    return next;
  }

  async function handlePostTabs(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return json({ error: "invalid_json" }, 400);
    }
    const b = body as Record<string, unknown>;
    const tabs = b.tabs;
    if (!Array.isArray(tabs)) {
      return json(
        { error: "invalid_payload", detail: "expected { tabs: [...] }" },
        400,
      );
    }

    tabState = {
      version: (tabState?.version ?? 0) + 1,
      savedAt: new Date().toISOString(),
      // 'panel' | 'devtools' | 'auto' — free-form, only used for display.
      source: typeof b.source === "string" ? b.source : "panel",
      count: tabs.length,
      tabs: tabs as StoredTab[],
      groups: Array.isArray(b.groups) ? b.groups : [],
      windows: Array.isArray(b.windows) ? b.windows : [],
      allowCrossWindow: b.allowCrossWindow === true,
      ...(typeof b.snapshot === "string" ? { snapshot: b.snapshot } : {}),
      // Carried by persist() — a tab change must not erase what the user
      // answered about the last suggestion.
      suggestions,
    };

    await persist();

    return json({
      ok: true,
      path: outPath,
      count: tabs.length,
      version: tabState.version,
    });
  }

  async function handlePostSuggestion(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return json({ error: "invalid_json" }, 400);
    }
    const b = body as Record<string, unknown>;
    const script = b.script;
    if (typeof script !== "string" || !script.trim()) {
      return json(
        { error: "invalid_payload", detail: "expected { script: string }" },
        400,
      );
    }

    const id = `s_${randomUUID().slice(0, 8)}`;
    const queuedAt = new Date().toISOString();
    pending = {
      id,
      script,
      note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
      basedOn: typeof b.basedOn === "number" ? b.basedOn : null,
      queuedAt,
    };
    suggestions = [
      {
        id,
        note: pending.note,
        opCount: typeof b.opCount === "number" ? b.opCount : null,
        basedOn: pending.basedOn,
        queuedAt,
        decision: null,
        reason: null,
        decidedAt: null,
      },
      ...suggestions,
    ].slice(0, SUGGESTION_RING);
    await persist();

    return json({ ok: true, id, queuedAt });
  }

  /** Pop the queued suggestion. Claiming it clears it. */
  function handleGetSuggestion(): Response {
    if (!pending) return new Response(null, { status: 204 });
    const item = pending;
    pending = null;
    return json(item);
  }

  async function handlePostDecision(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return json({ error: "invalid_json" }, 400);
    }
    const b = body as Record<string, unknown>;
    if (!isDecision(b.decision)) {
      return json(
        {
          error: "invalid_payload",
          detail: "expected { decision: 'accepted'|'denied'|'stale'|'failed' }",
        },
        400,
      );
    }

    const id = typeof b.id === "string" && b.id ? b.id : "";
    // Match by id when the extension sent one; otherwise answer the newest
    // suggestion nobody has answered yet. An older extension POSTs no id, and
    // dropping its verdict on the floor would leave the agent waiting forever.
    const target = id
      ? suggestions.find((s) => s.id === id)
      : suggestions.find((s) => s.decision === null);
    if (target) {
      target.decision = b.decision;
      target.reason =
        typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
      if (typeof b.opCount === "number") target.opCount = b.opCount;
      target.decidedAt = new Date().toISOString();
      await persist();
    }

    return json({ ok: true });
  }

  async function handleRequest(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);

      // --- BEGIN origin/host hardening (optional, delete this block to disable) ---
      // Host pinning is what stops DNS rebinding. A page on http://evil.com
      // whose DNS is flipped to 127.0.0.1 reaches this server while keeping its
      // own origin, so its requests are *same-origin* — and the Fetch spec omits
      // `Origin` on same-origin GET/HEAD, which would sail past the check below
      // and let the page read the response (no CORS between same origins). The
      // browser sets `Host` from the URL it asked for (`evil.com:<port>`) and
      // page JS cannot forge it — `Host` is a forbidden header name. Real
      // extension traffic is addressed to 127.0.0.1 and passes untouched.
      const host = req.headers.get("host");
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        return json({ error: "forbidden_host" }, 403);
      }

      // Origin still carries its own weight: browsers always attach it to
      // non-GET/HEAD requests, so this is what blocks a drive-by `POST /tabs`
      // from a random page writing to the user's disk. It's a no-op for
      // curl/scripts, which send no Origin at all.
      const origin = req.headers.get("origin");
      if (origin && !origin.startsWith("chrome-extension://")) {
        return json({ error: "forbidden_origin" }, 403);
      }
      // --- END origin/host hardening ---

      if (req.method === "POST" && url.pathname === "/tabs") {
        return await handlePostTabs(req);
      }
      if (req.method === "POST" && url.pathname === "/suggestion") {
        return await handlePostSuggestion(req);
      }
      if (req.method === "GET" && url.pathname === "/suggestion") {
        return handleGetSuggestion();
      }
      if (req.method === "POST" && url.pathname === "/decision") {
        return await handlePostDecision(req);
      }
      // Cheap, non-destructive reachability check — the extension pings this to
      // show a connected/disconnected status, separate from claiming a pending
      // script. `ok` must stay, older extensions test it.
      if (req.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          protocol: PROTOCOL,
          tabsVersion: tabState?.version ?? 0,
          hasPending: pending !== null,
        });
      }
      return json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "internal_error" }, 500);
    }
  }

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port, fetch: handleRequest });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ServeError(`Couldn't start the server on port ${port}: ${detail}`);
  }

  // What the user needs is "am I up, and what do I do next in the browser" —
  // not the route table. `TABBREW_DEBUG` still gets the wire detail.
  console.log(
    `${c.bold("TabBrew bridge")} ${c.dim("· ready on")} ${c.cyan(`127.0.0.1:${port}`)}`,
  );
  console.log(`  ${c.dim("Exported tabs are saved to")} ${outPath}`);
  console.log("");
  console.log(
    `  ${c.bold("Next, in Chrome:")} open the TabBrew sidepanel, click ${c.bold("Send to Claude Code")},`,
  );
  console.log(
    `  ${c.dim("and switch")} ${c.bold("Auto mode")} ${c.dim("on. Then read the tabs with")} \`${BIN} tabs list\`.`,
  );
  console.log("");
  console.log(c.dim("Press Ctrl+C to stop."));
  if (process.env.TABBREW_DEBUG) {
    console.log(
      c.dim(
        "  routes: POST /tabs · POST /suggestion · GET /suggestion (pop) · " +
          "POST /decision · GET /health",
      ),
    );
  }

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.stop();
      console.log(c.dim("Stopped."));
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/**
 * Restore enough state from the last run that a restart isn't a cliff: the
 * version keeps counting up (so a suggestion's `basedOn` staleness check stays
 * meaningful) and the suggestion ring survives, which is the only record of
 * what the user already said no to.
 */
async function seedTabState(outPath: string): Promise<TabState | null> {
  const text = await readFileOrNull(outPath);
  if (text === null) return null;
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(p.tabs)) return null;
    return {
      version: typeof p.version === "number" ? p.version : 0,
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date(0).toISOString(),
      source: typeof p.source === "string" ? p.source : "panel",
      count: p.tabs.length,
      tabs: p.tabs as StoredTab[],
      groups: Array.isArray(p.groups) ? p.groups : [],
      windows: Array.isArray(p.windows) ? p.windows : [],
      allowCrossWindow: p.allowCrossWindow === true,
      ...(typeof p.snapshot === "string" ? { snapshot: p.snapshot } : {}),
      // A file written before the ring existed simply has none.
      suggestions: Array.isArray(p.suggestions)
        ? (p.suggestions as SuggestionRecord[])
        : [],
    };
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
