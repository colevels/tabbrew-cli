// Self-update: replace the running compiled binary with the newest GitHub
// Release for this OS/arch. This is a third, self-contained subsystem — it talks
// to GitHub Releases, NOT the TabBrew web API, so it shares only `config`/`ui`/
// `util` with the rest of the CLI. IO/protocol lives here; presentation lives in
// commands/update.ts. Zero runtime deps: global fetch + Bun.CryptoHasher + node
// built-ins. Mirrors install.sh's platform detection + checksum verification.

import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { fetchWithTimeout } from "./util";
import { VERSION } from "./ui";

/** Any user-facing self-update failure. Registered in index.ts's error boundary. */
export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateError";
  }
}

function isErrno(err: unknown, ...codes: string[]): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    codes.includes((err as { code?: string }).code ?? "")
  );
}

/** GitHub rejects requests without a User-Agent; identify ourselves on every call. */
function ghHeaders(): Record<string, string> {
  return { "User-Agent": `tabbrew-cli/${VERSION}` };
}

/**
 * True when running as a `bun build --compile` standalone: its entry executes
 * from Bun's virtual filesystem, so `import.meta.url` is `file:///$bunfs/…`. In
 * dev (`bun run src/index.ts`) it's a real `file://` path — the gate that stops
 * us from ever overwriting the `bun` binary itself.
 */
export function isCompiledBinary(): boolean {
  return import.meta.url.includes("/$bunfs/");
}

/** The on-disk executable to replace (symlinks resolved to the real file). */
export function currentBinaryPath(): string {
  return realpathSync(process.execPath);
}

/** Release asset name for this platform, e.g. `tabbrew-darwin-arm64`. */
export function assetName(): string {
  const os =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "linux"
        ? "linux"
        : null;
  const arch =
    process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!os || !arch) {
    throw new UpdateError(
      `No prebuilt binary for ${process.platform}-${process.arch}. ` +
        `Prebuilt releases exist for macOS/Linux on arm64/x64 only — ` +
        `download from https://github.com/${config.update.repo}/releases/latest ` +
        `or build from source.`,
    );
  }
  return `tabbrew-${os}-${arch}`;
}

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/, "");
}

function parseTriple(v: string): [number, number, number] | null {
  const core = normalizeVersion(v).split(/[-+]/)[0] ?? "";
  const parts = core.split(".").map((p) => Number(p));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Compare two versions. Returns -1 / 0 / 1, or NaN when either side isn't a
 * numeric `major.minor.patch` (pre-release/build suffixes are ignored). NaN keeps
 * callers from ever claiming "newer" on something we couldn't parse.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseTriple(a);
  const pb = parseTriple(b);
  if (pa && pb) {
    for (let i = 0; i < 3; i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  return normalizeVersion(a) === normalizeVersion(b) ? 0 : NaN;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/**
 * Resolve the latest published version from the `releases/latest` 302 redirect
 * (→ `…/releases/tag/vX.Y.Z`). No API call, so no rate limit — the same trick
 * install.sh relies on.
 */
export async function resolveLatest(): Promise<string> {
  const url = config.update.releaseLatestUrl;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      { redirect: "manual", headers: ghHeaders() },
      config.timeoutMs,
    );
  } catch (err) {
    throw new UpdateError(
      `Could not reach ${url}: ${(err as Error).message}`,
    );
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new UpdateError(
      `Could not determine the latest version (HTTP ${res.status} from ${url}, no redirect).`,
    );
  }
  const match = location.match(/\/tag\/([^/?#]+)/);
  if (!match) {
    throw new UpdateError(`Could not parse a version from redirect: ${location}`);
  }
  return normalizeVersion(match[1]!);
}

/** Compare the running version against the latest release. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = normalizeVersion(VERSION);
  const latest = await resolveLatest();
  return {
    current,
    latest,
    updateAvailable: compareSemver(latest, current) > 0,
  };
}

/** Download the asset + checksums.txt, verify the SHA-256, return the bytes. */
export async function downloadAndVerify(asset: string): Promise<Uint8Array> {
  const binaryUrl = `${config.update.downloadBaseUrl}/${asset}`;
  const checksumsUrl = `${config.update.downloadBaseUrl}/checksums.txt`;

  // The binary is tens of MB — its own generous timeout.
  let binRes: Response;
  try {
    binRes = await fetchWithTimeout(
      binaryUrl,
      { headers: ghHeaders() },
      config.update.downloadTimeoutMs,
    );
  } catch (err) {
    throw new UpdateError(`Download failed (${binaryUrl}): ${(err as Error).message}`);
  }
  if (!binRes.ok) {
    throw new UpdateError(`Download failed (HTTP ${binRes.status}): ${binaryUrl}`);
  }
  const bytes = new Uint8Array(await binRes.arrayBuffer());

  let sumsRes: Response;
  try {
    sumsRes = await fetchWithTimeout(
      checksumsUrl,
      { headers: ghHeaders() },
      config.timeoutMs,
    );
  } catch (err) {
    throw new UpdateError(
      `Could not fetch checksums (${checksumsUrl}): ${(err as Error).message}`,
    );
  }
  if (!sumsRes.ok) {
    throw new UpdateError(
      `Could not fetch checksums (HTTP ${sumsRes.status}): ${checksumsUrl}`,
    );
  }
  const sums = await sumsRes.text();

  // checksums.txt lines: "<sha256>  <asset>" (matches install.sh's ` <asset>$`).
  const line = sums
    .split("\n")
    .find((l) => l.trimEnd().endsWith(` ${asset}`));
  const expected = line?.trim().split(/\s+/)[0];
  if (!expected) {
    throw new UpdateError(`No checksum for ${asset} in checksums.txt.`);
  }
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new UpdateError(
      `Checksum mismatch for ${asset} (expected ${expected}, got ${actual}). ` +
        `The download was not applied.`,
    );
  }
  return bytes;
}

/**
 * Atomically swap the running binary: write a temp file in the target's own
 * directory (so the rename is atomic and never crosses filesystems), mark it
 * executable, then rename over the target. rename(2) is safe while the process
 * runs — it keeps the old inode; we never write in place (which would ETXTBSY).
 */
export async function replaceBinary(
  target: string,
  bytes: Uint8Array,
): Promise<void> {
  let real = target;
  try {
    real = realpathSync(target);
  } catch {
    /* target is the literal path */
  }
  const tmp = join(
    dirname(real),
    `.${basename(real)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    await writeFile(tmp, bytes);
    await chmod(tmp, 0o755);
    await rename(tmp, real);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    if (isErrno(err, "EACCES", "EPERM", "EROFS")) {
      throw new UpdateError(
        `Cannot write ${real}: permission denied. ` +
          `Re-run with the right permissions (e.g. \`sudo tabbrew update\`) ` +
          `or reinstall with the install script.`,
      );
    }
    throw err;
  }
}

/**
 * The full flow: refuse in dev, check, no-op when current, else download →
 * verify → swap. `replaced` is false when already up to date.
 */
export async function performUpdate(): Promise<{
  info: UpdateInfo;
  replaced: boolean;
}> {
  if (!isCompiledBinary()) {
    throw new UpdateError(
      "`tabbrew update` only updates the installed binary, but you're running " +
        "from source. Use `git pull && bun run build`, or reinstall with the " +
        "install script.",
    );
  }
  const info = await checkForUpdate();
  if (!info.updateAvailable) return { info, replaced: false };

  const bytes = await downloadAndVerify(assetName());
  await replaceBinary(currentBinaryPath(), bytes);
  return { info, replaced: true };
}
