import { afterEach, describe, expect, test } from "bun:test";
import { SERVICE, VERSION } from "./config";
import { createServer, type SessionServer } from "./server";

const servers: SessionServer[] = [];
const up = (idleMs?: number, onStop?: (reason: string) => void) => {
  const server = createServer(0, { idleMs, onStop });
  servers.push(server);
  return server;
};
const url = (server: SessionServer, path: string) => `http://127.0.0.1:${server.port}${path}`;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop("test teardown")));
});

describe("session server", () => {
  test("GET /health identifies the session", async () => {
    const server = up();
    const res = await fetch(url(server, "/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-tabbrew-version")).toBe(VERSION);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ service: SERVICE, version: VERSION, pid: process.pid, port: server.port });
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test("unknown routes are 404", async () => {
    const server = up();
    const res = await fetch(url(server, "/nope"));
    expect(res.status).toBe(404);
  });

  test("POST /stop from a browser is refused", async () => {
    const server = up();
    const res = await fetch(url(server, "/stop"), {
      method: "POST",
      headers: { "sec-fetch-site": "none", "sec-fetch-mode": "cors" },
    });
    expect(res.status).toBe(403);
    expect((await fetch(url(server, "/health"))).status).toBe(200);
  });

  test("POST /stop from a local process stops the server", async () => {
    let reason = "";
    const stopped = new Promise<void>((resolve) => {
      up(undefined, (why) => {
        reason = why;
        resolve();
      });
    });
    const server = servers[0]!;
    const res = await fetch(url(server, "/stop"), { method: "POST" });
    expect(res.status).toBe(200);
    await stopped;
    expect(reason).toBe("stop requested");
    await expect(fetch(url(server, "/health"))).rejects.toThrow();
  });

  test("an idle server stops itself", async () => {
    const stopped = new Promise<string>((resolve) => up(60, resolve));
    expect(await stopped).toContain("idle");
  });
});
