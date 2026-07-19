import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../fsops";
import { config } from "../config";
import { c } from "../ui";

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

interface PendingScript {
  script: string;
  queuedAt: string;
}

/**
 * `tabbrew serve` — a local HTTP server the TabBrew Chrome extension talks to:
 * it POSTs its open tabs (saved as JSON on disk), and polls for a TabBrew
 * Script queued by `tabbrew run`. Binds 127.0.0.1 only (hardcoded, not
 * overridable) — that's the whole security model, no auth token. An `Origin`
 * check adds cheap defense-in-depth against a random webpage's JS hitting the
 * port; it's intentionally a single self-contained block so it's easy to rip
 * out if it ever gets in the way.
 */
export async function serve(opts: ServeOptions): Promise<void> {
  if (opts.port !== undefined && (!Number.isInteger(opts.port) || opts.port <= 0)) {
    throw new ServeError(`Invalid --port: ${opts.port}`);
  }

  const port = opts.port ?? config.serve.port;
  const outPath = opts.out ?? config.serve.outPath;

  await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });

  // Single unclaimed script at a time — `tabbrew run` overwrites, the
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
    await atomicWrite(outPath, JSON.stringify(payload, null, 2) + "\n");

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

      // --- BEGIN origin hardening (optional, delete this block to disable) ---
      const origin = req.headers.get("origin");
      if (origin && !origin.startsWith("chrome-extension://")) {
        return json({ error: "forbidden_origin" }, 403);
      }
      // --- END origin hardening ---

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

  console.log(
    `${c.bold("tabbrew serve")} — listening on ${c.cyan(`http://127.0.0.1:${port}`)}`,
  );
  console.log(`  POST /tabs   ${c.dim("→")} saved to ${outPath}`);
  console.log(`  POST /script ${c.dim("→")} queue a script (via \`tabbrew run\`)`);
  console.log(`  GET  /script ${c.dim("→")} claimed by the extension's poll`);
  console.log(`  GET  /health ${c.dim("→")} used by the extension's Connect toggle`);
  console.log(c.dim("Press Ctrl+C to stop."));

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
