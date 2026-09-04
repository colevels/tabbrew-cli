import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../../package.json";

const root = `${import.meta.dir}/../../..`;
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000);
let stateDir = "";

function tabbrew(...args: string[]) {
  const result = Bun.spawnSync(["bun", "run", "src/index.ts", "session", ...args], {
    cwd: root,
    env: {
      ...process.env,
      TABBREW_SESSION_PORTS: String(port),
      TABBREW_SESSION_DIR: stateDir,
    },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "tabbrew-session-"));
});

afterAll(() => {
  tabbrew("stop");
  rmSync(stateDir, { recursive: true, force: true });
});

describe("tabbrew session", () => {
  test("status reports nothing running", () => {
    const { exitCode, stdout } = tabbrew("status");
    expect(exitCode).toBe(1);
    expect(stdout).toContain("no session running");
  });

  test("start launches a background session", () => {
    const { exitCode, stdout } = tabbrew("start");
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`session started on 127.0.0.1:${port}`);
  });

  test("status sees it, as text and as json", () => {
    const text = tabbrew("status");
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("session running");

    const { exitCode, stdout } = tabbrew("status", "--json");
    expect(exitCode).toBe(0);
    const body = JSON.parse(stdout);
    expect(body).toMatchObject({ running: true, port, version: pkg.version, cli: pkg.version });
    expect(body.pid).toBeGreaterThan(0);
    expect(body.pid).not.toBe(process.pid);
  });

  test("start again is a no-op", () => {
    const { exitCode, stdout } = tabbrew("start");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("already running");
  });

  test("run refuses to start a second one", () => {
    const { exitCode, stderr } = tabbrew("run");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already running");
  });

  test("stop ends it", () => {
    const { exitCode, stdout } = tabbrew("stop");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("session stopped");
    expect(tabbrew("status").exitCode).toBe(1);
  });

  test("stop with nothing running is fine", () => {
    const { exitCode, stdout } = tabbrew("stop");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no session running");
  });
});
