// Safe filesystem helpers for `init`. Mirrors the credentials.ts idiom (node:os
// homedir + node:fs/promises), but writes are ATOMIC (temp file + rename) and
// carry no chmod — the awareness doc and CLAUDE.md are non-secret.

import {
  copyFile,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === code
  );
}

/** Read a UTF-8 file, or null if it doesn't exist. */
export async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
}

/**
 * If `path` is a symlink, follow it so the rename lands on the real file and the
 * symlink is preserved (common in dotfiles repos). ENOENT → the file isn't
 * created yet, so use the literal path.
 */
async function resolveWriteTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * Atomic write: temp file in the target's own directory, then rename over it.
 * Same-directory rename is atomic on POSIX; a failed write leaves no temp litter.
 * The parent directory must already exist.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const target = await resolveWriteTarget(path);
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    await writeFile(tmp, content);
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Idempotent atomic write. Returns what happened, so callers can report it. */
export async function writeIfChanged(
  path: string,
  content: string,
): Promise<"created" | "updated" | "unchanged"> {
  const existing = await readFileOrNull(path);
  if (existing === null) {
    await atomicWrite(path, content);
    return "created";
  }
  if (existing === content) return "unchanged";
  await atomicWrite(path, content);
  return "updated";
}

/** Copy `path` → `path + ".bak"`. Returns false (no-op) if the source is absent. */
export async function backupFile(path: string): Promise<boolean> {
  try {
    await copyFile(path, path + ".bak");
    return true;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
}

/** Delete `path`. Returns false if it was already absent. */
export async function removeFileIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
}
