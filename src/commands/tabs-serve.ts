import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../fsops";
import { config } from "../config";
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

interface PendingScript {
  script: string;
  queuedAt: string;
}

/**
 * `tabbrew tabs serve` — a local HTTP server the TabBrew Chrome extension talks
 * to: it POSTs its open tabs (saved as JSON on disk), and polls for a TabBrew
 * Script queued by `tabbrew tabs push`. Binds 127.0.0.1 only (hardcoded, not
 * overridable) — that's the whole security model, no auth token. An `Origin`
 * check adds cheap defense-in-depth against a random webpage's JS hitting the
 * port; it's intentionally a single self-contained block so it's easy to rip
 * out if it ever gets in the way.
 */
export async function tabsServe(opts: ServeOptions): Promise<void> {
  const port = resolveServePort(opts.port);
  const outPath = opts.out ?? config.serve.outPath;

  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });

  // Single unclaimed script at a time — `tabbrew tabs push` overwrites, the
  // extension's poll pops (claims + clears) it. Lives only for this process's
  // lifetime; that's fine, it's meant to be picked up within seconds.
  let pendingScript: PendingScript | null = null;

  async function handlePostTabs(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return json({ error: "invalid_json" }, 400);
    }
    const tabs = (body as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabs)) {
      return json(
        { error: "invalid_payload", detail: "expected { tabs: [...] }" },
        400,
      );
    }

    const payload = { savedAt: new Date().toISOString(), count: tabs.length, tabs };
    // 0600, like credentials.json. This is the URL and title of every open tab —
    // browsing state, which is arguably worse to leak than the token: a token is
    // revocable, a history isn't, and full URLs carry more than hostnames
    // (account paths, doc links, share links with tokens in the query string).
    // The default umask would leave it 0644, and the config dir is not reliably
    // 0700, so the file mode is the only thing actually protecting it.
    await atomicWrite(outPath, JSON.stringify(payload, null, 2) + "\n", 0o600);

    return json({ ok: true, path: outPath, count: tabs.length });
  }

  async function handlePostScript(req: Request): Promise<Response> {
    const body = await req.json().catch(() => null);
    const script = (body as { script?: unknown } | null)?.script;
    if (typeof script !== "string" || !script.trim()) {
      return json(
        { error: "invalid_payload", detail: "expected { script: string }" },
        400,
      );
    }
    pendingScript = { script, queuedAt: new Date().toISOString() };
    return json({ ok: true, queuedAt: pendingScript.queuedAt });
  }

  function handleGetScript(): Response {
    if (!pendingScript) return new Response(null, { status: 204 });
    const item = pendingScript;
    pendingScript = null; // pop — claimed by this poll
    return json(item);
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
      if (req.method === "POST" && url.pathname === "/script") {
        return await handlePostScript(req);
      }
      if (req.method === "GET" && url.pathname === "/script") {
        return handleGetScript();
      }
      // Cheap, non-destructive reachability check — the extension's "Connect"
      // toggle pings this to show a connected/disconnected status, separate
      // from claiming a pending script.
      if (req.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
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
  console.log(`  ${c.bold("Next, in Chrome:")} open the TabBrew sidepanel and click ${c.bold("Send to Claude Code")},`);
  console.log(`  ${c.dim("or in Developer mode → TabBrew Script, click")} ${c.bold("Connect")}${c.dim(" to receive a")} \`${BIN} tabs push\`.`);
  console.log("");
  console.log(c.dim("Press Ctrl+C to stop."));
  if (process.env.TABBREW_DEBUG) {
    console.log(
      c.dim("  routes: POST /tabs · POST /script · GET /script (pop) · GET /health"),
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
