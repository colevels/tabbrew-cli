import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWrite, readFileOrNull } from "../fsops";
import { config } from "../config";
import {
  appendDelta,
  countHistoryLines,
  diffTabs,
  isEmptyDelta,
  readHistory,
  type HistoryTab,
  type TabDelta,
} from "../tabs-history";
import { BIN, c } from "../ui";

/** Bad `--port` (non-numeric/non-positive) or the port is already in use. */
export class ServeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServeError";
  }
}

export interface ServeOptions {
  port?: number;
  out?: string;
  /** Skip the delta log entirely (see tabs-history.ts's privacy note). */
  noHistory?: boolean;
}

/**
 * The one place a serve port is decided: an explicit `--port`, else
 * TABBREW_SERVE_PORT, else the default. `tabs push` calls this too — the two
 * commands have to agree on the port or a pushed script silently lands on a
 * different server (or nowhere), which is exactly what used to happen.
 */
export function resolveServePort(port?: number): number {
  if (port === undefined) return config.serve.port;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ServeError(`Invalid --port: ${port}. Expected 1-65535.`);
  }
  return port;
}

/**
 * Wire-protocol version, echoed by `GET /health`. Both ends of this bridge move
 * independently — the extension updates through the Web Store, the CLI through
 * `tabbrew update` — so neither may assume the other is current. 1 = script-only
 * (`POST /tabs` + `GET /script`), 2 = adds tab versioning, long-poll watching,
 * and the suggestion/decision round trip.
 */
const PROTOCOL = 2;

/** Ceiling for any `?wait=` long-poll, so a client can't park a socket forever. */
const MAX_WAIT_MS = 300_000;
/** In-memory delta ring, enough for a watcher that missed a few versions. */
const DELTA_TAIL = 50;

interface TabState {
  version: number;
  savedAt: string;
  source: string;
  count: number;
  tabs: HistoryTab[];
  groups: unknown[];
  windows: unknown[];
  allowCrossWindow: boolean;
  /** The extension's own rendered "Copy AI Prompt" markdown, when it sent one. */
  snapshot?: string;
}

interface PendingSuggestion {
  id: string;
  script: string;
  note: string | null;
  basedOn: number | null;
  queuedAt: string;
}

type DecisionKind = "accepted" | "denied" | "stale";

interface Verdict {
  id: string;
  decision: DecisionKind;
  reason: string | null;
  opCount: number | null;
  at: string;
}

const isDecision = (v: unknown): v is DecisionKind =>
  v === "accepted" || v === "denied" || v === "stale";

/**
 * `tabbrew tabs serve` — a local HTTP server the TabBrew Chrome extension talks
 * to. It receives the extension's tab state (saved as JSON on disk, plus a
 * delta log), hands out scripts queued by `tabs push` / `tabs suggest`, and
 * carries the user's accept/deny answer back to the CLI. Binds 127.0.0.1 only
 * (hardcoded, not overridable) — that's the whole security model, no auth
 * token. An `Origin` check adds cheap defense-in-depth against a random
 * webpage's JS hitting the port; it's intentionally a single self-contained
 * block so it's easy to rip out if it ever gets in the way.
 */
export async function tabsServe(opts: ServeOptions): Promise<void> {
  const port = resolveServePort(opts.port);
  const outPath = opts.out ?? config.serve.outPath;
  const historyPath = config.serve.historyPath;
  const historyEnabled = config.serve.historyEnabled && opts.noHistory !== true;

  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
  if (historyEnabled) {
    await mkdir(dirname(historyPath), { recursive: true, mode: 0o700 });
  }

  let tabState: TabState | null = await seedTabState(outPath);
  let deltas: TabDelta[] = [];
  let historyLines = historyEnabled ? await countHistoryLines(historyPath) : 0;

  // Single unclaimed script at a time — `tabs push` / `tabs suggest` overwrite,
  // the extension's poll pops (claims + clears) it. Lives only for this
  // process's lifetime; that's fine, it's meant to be picked up within seconds.
  let pending: PendingSuggestion | null = null;
  // The user's answer to the last claimed suggestion, waiting for `--wait` to
  // collect it. One slot: a new suggestion clears it, so a stale "denied" from
  // two rounds ago can never be mistaken for the answer to this one.
  let verdict: Verdict | null = null;

  // Long-poll parking lots. Each entry is a resolver; posting wakes them all
  // and they re-check their own condition (a resolver can't know which waiter
  // wanted what, so the loop is on the caller's side).
  const tabWaiters = new Set<() => void>();
  const verdictWaiters = new Set<() => void>();

  const wake = (set: Set<() => void>): void => {
    for (const resolve of [...set]) resolve();
  };

  function park(set: Set<() => void>, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        set.delete(finish);
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      set.add(finish);
      // A client that hangs up (Ctrl+C on `tabs watch`) must not leave a
      // resolver behind — otherwise a long-lived serve slowly leaks them.
      signal.addEventListener("abort", finish, { once: true });
    });
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

    const groups = Array.isArray(b.groups) ? b.groups : [];
    const next: TabState = {
      version: (tabState?.version ?? 0) + 1,
      savedAt: new Date().toISOString(),
      // 'panel' | 'devtools' | 'auto' — free-form, only used for display.
      source: typeof b.source === "string" ? b.source : "panel",
      count: tabs.length,
      tabs: tabs as HistoryTab[],
      groups,
      windows: Array.isArray(b.windows) ? b.windows : [],
      allowCrossWindow: b.allowCrossWindow === true,
      ...(typeof b.snapshot === "string" ? { snapshot: b.snapshot } : {}),
    };

    const delta = diffTabs(tabState?.tabs ?? [], next.tabs, {
      v: next.version,
      at: next.savedAt,
      source: next.source,
      groups: groups.length,
    });

    tabState = next;

    // 0600, like credentials.json. This is the URL and title of every open tab —
    // browsing state, which is arguably worse to leak than the token: a token is
    // revocable, a history isn't, and full URLs carry more than hostnames
    // (account paths, doc links, share links with tokens in the query string).
    // The default umask would leave it 0644, and the config dir is not reliably
    // 0700, so the file mode is the only thing actually protecting it.
    await atomicWrite(outPath, JSON.stringify(next, null, 2) + "\n", 0o600);

    // A no-op delta still bumps the version (the extension asked us to record
    // this moment), but writing "nothing happened" lines would fill the log
    // with noise and push real changes out of the window.
    if (!isEmptyDelta(delta)) {
      deltas = [...deltas, delta].slice(-DELTA_TAIL);
      if (historyEnabled) {
        historyLines = await appendDelta(
          historyPath,
          delta,
          config.serve.historyMax,
          historyLines,
        );
      }
    }

    wake(tabWaiters);
    return json({ ok: true, path: outPath, count: tabs.length, version: next.version });
  }

  /**
   * Long-poll the tab state. Never pops — unlike `/script`, this is a read a
   * watcher repeats forever, and `since` (not consumption) is what stops it
   * seeing the same version twice.
   */
  async function handleGetTabs(req: Request, url: URL): Promise<Response> {
    const since = intParam(url, "since") ?? 0;
    const wait = Math.min(intParam(url, "wait") ?? 0, MAX_WAIT_MS);
    const deadline = Date.now() + wait;

    for (;;) {
      if (tabState && tabState.version > since) {
        const changes = deltas.filter((d) => d.v > since);
        // The ring only holds the last DELTA_TAIL versions. Say so rather than
        // implying "these are all the changes" — a caller that has fallen
        // behind should re-read the full state instead.
        const oldest = deltas.length > 0 ? deltas[0]!.v : tabState.version;
        return json({
          ...tabState,
          changes,
          changesTruncated: since > 0 && oldest > since + 1,
        });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return new Response(null, { status: 204 });
      await park(tabWaiters, remaining, req.signal);
      if (req.signal.aborted) return new Response(null, { status: 499 });
    }
  }

  async function handleGetHistory(url: URL): Promise<Response> {
    const limit = Math.max(1, Math.min(intParam(url, "limit") ?? 20, 1000));
    // The file is the durable copy; the ring is the fallback when the log is
    // switched off (in which case the tail is all that has ever existed).
    const all = historyEnabled ? await readHistory(historyPath) : deltas;
    return json({ ok: true, enabled: historyEnabled, deltas: all.slice(-limit) });
  }

  async function handlePostScript(req: Request): Promise<Response> {
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
    pending = {
      id: `s_${randomUUID().slice(0, 8)}`,
      script,
      note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
      basedOn: typeof b.basedOn === "number" ? b.basedOn : null,
      queuedAt: new Date().toISOString(),
    };
    // Whatever the user said about the *previous* suggestion is now history —
    // dropping it here is what keeps `GET /decision?id=…` unambiguous.
    verdict = null;
    return json({ ok: true, id: pending.id, queuedAt: pending.queuedAt });
  }

  /**
   * Pop the queued suggestion. Two routes claim the same single slot:
   * `/suggestion` (protocol 2, carries the note and an id to answer with) and
   * `/script` (what extension builds predating auto mode poll). Whichever asks
   * first gets it.
   */
  function handleGetSuggestion(): Response {
    if (!pending) return new Response(null, { status: 204 });
    const item = pending;
    pending = null;
    return json(item);
  }

  function handleGetScript(): Response {
    if (!pending) return new Response(null, { status: 204 });
    const item = pending;
    pending = null;
    // Old shape exactly — an old extension parses `script` and ignores the rest.
    return json({ script: item.script, queuedAt: item.queuedAt });
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
          detail: "expected { decision: 'accepted'|'denied'|'stale' }",
        },
        400,
      );
    }
    verdict = {
      id: typeof b.id === "string" && b.id ? b.id : "",
      decision: b.decision,
      reason: typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null,
      opCount: typeof b.opCount === "number" ? b.opCount : null,
      at: new Date().toISOString(),
    };
    wake(verdictWaiters);
    return json({ ok: true });
  }

  /**
   * Long-poll for the answer to one suggestion. Does not clear the verdict: a
   * `--wait` that timed out and retried has to be able to read it again, and
   * the next `POST /suggestion` clears it anyway.
   */
  async function handleGetDecision(req: Request, url: URL): Promise<Response> {
    const id = url.searchParams.get("id") ?? "";
    const wait = Math.min(intParam(url, "wait") ?? 0, MAX_WAIT_MS);
    const deadline = Date.now() + wait;

    const matches = (): boolean =>
      verdict !== null && (id === "" || verdict.id === "" || verdict.id === id);

    for (;;) {
      if (matches()) return json(verdict);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return new Response(null, { status: 204 });
      await park(verdictWaiters, remaining, req.signal);
      if (req.signal.aborted) return new Response(null, { status: 499 });
    }
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
      if (req.method === "GET" && url.pathname === "/tabs") {
        return await handleGetTabs(req, url);
      }
      if (req.method === "GET" && url.pathname === "/history") {
        return await handleGetHistory(url);
      }
      // `/script` and `/suggestion` POST the same thing; the two names exist so
      // an old CLI's `tabs push` still reaches a new serve.
      if (req.method === "POST" && (url.pathname === "/script" || url.pathname === "/suggestion")) {
        return await handlePostScript(req);
      }
      if (req.method === "GET" && url.pathname === "/suggestion") {
        return handleGetSuggestion();
      }
      if (req.method === "GET" && url.pathname === "/script") {
        return handleGetScript();
      }
      if (req.method === "POST" && url.pathname === "/decision") {
        return await handlePostDecision(req);
      }
      if (req.method === "GET" && url.pathname === "/decision") {
        return await handleGetDecision(req, url);
      }
      // Cheap, non-destructive reachability check — the extension's "Connect"
      // toggle pings this to show a connected/disconnected status, separate
      // from claiming a pending script. `ok` must stay, older extensions test it.
      if (req.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          protocol: PROTOCOL,
          tabsVersion: tabState?.version ?? 0,
          hasPending: pending !== null,
          history: historyEnabled,
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
  console.log(
    historyEnabled
      ? `  ${c.dim("Changes are logged to")} ${historyPath} ${c.dim(`(newest ${config.serve.historyMax})`)}`
      : `  ${c.dim("Change log off — no browsing history is kept on disk.")}`,
  );
  console.log("");
  console.log(`  ${c.bold("Next, in Chrome:")} open the TabBrew sidepanel and click ${c.bold("Send to Claude Code")},`);
  console.log(`  ${c.dim("or in Developer mode → TabBrew Script, click")} ${c.bold("Connect")}${c.dim(" to receive a")} \`${BIN} tabs push\`.`);
  console.log("");
  console.log(c.dim("Press Ctrl+C to stop."));
  if (process.env.TABBREW_DEBUG) {
    console.log(
      c.dim(
        "  routes: POST /tabs · GET /tabs (long-poll) · GET /history · " +
          "POST /suggestion · GET /suggestion (pop) · GET /script (pop) · " +
          "POST /decision · GET /decision (long-poll) · GET /health",
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
 * version keeps counting up (so a watcher's `--since 13` doesn't go unanswered
 * forever) and the first delta after the restart diffs against real tabs
 * instead of reporting all 187 as brand new.
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
      tabs: p.tabs as HistoryTab[],
      groups: Array.isArray(p.groups) ? p.groups : [],
      windows: Array.isArray(p.windows) ? p.windows : [],
      allowCrossWindow: p.allowCrossWindow === true,
      ...(typeof p.snapshot === "string" ? { snapshot: p.snapshot } : {}),
    };
  } catch {
    return null;
  }
}

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
