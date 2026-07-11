import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { config } from "./config";

export interface StoredCredentials {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  /** Epoch ms when the access token expires, if the server told us. */
  expires_at?: number;
  /** Epoch ms when we obtained the token. */
  obtained_at: number;
}

const CONFIG_DIR = join(homedir(), ".config", "tabbrew");
export const CRED_PATH = join(CONFIG_DIR, "credentials.json");
/** Legacy per-feature token for the html_files (Docs) endpoints. */
export const UPLOAD_TOKEN_PATH = join(CONFIG_DIR, "upload-token");

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === code
  );
}

/** Persist credentials and always tighten the file mode to 600. */
export async function saveCredentials(
  creds: StoredCredentials,
): Promise<string> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CRED_PATH, JSON.stringify(creds, null, 2) + "\n", {
    mode: 0o600,
  });
  // writeFile's mode only applies on create; re-assert 600 for pre-existing files.
  await chmod(CRED_PATH, 0o600);
  return CRED_PATH;
}

export async function loadStoredCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(CRED_PATH, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    if (err instanceof SyntaxError) return null; // corrupt file → treat as logged out
    throw err;
  }
}

/** Returns true if a file was removed, false if there was nothing to remove. */
export async function clearCredentials(): Promise<boolean> {
  try {
    await unlink(CRED_PATH);
    return true;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
}

export interface ResolvedToken {
  token: string;
  source: "env" | "file";
}

/**
 * Resolve the active token. The env var (TABBREW_TOKEN) always wins so CI/CD
 * can inject a token without touching the filesystem.
 */
export async function resolveToken(): Promise<ResolvedToken | null> {
  const envToken = process.env[config.tokenEnvVar]?.trim();
  if (envToken) return { token: envToken, source: "env" };

  const stored = await loadStoredCredentials();
  if (stored?.access_token) return { token: stored.access_token, source: "file" };

  return null;
}

/**
 * Resolve the html_files upload token. Mirrors resolveToken's precedence: the
 * env var (TABBREW_UPLOAD_TOKEN) wins over the stored ~/.config/tabbrew/upload-token
 * file. This is a separate credential from the OAuth login token — see the
 * html_files client in api.ts for how the two are tried.
 */
export async function resolveUploadToken(): Promise<ResolvedToken | null> {
  const envToken = process.env[config.uploadTokenEnvVar]?.trim();
  if (envToken) return { token: envToken, source: "env" };

  try {
    const raw = await readFile(UPLOAD_TOKEN_PATH, "utf8");
    const trimmed = raw.trim();
    return trimmed ? { token: trimmed, source: "file" } : null;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
}
