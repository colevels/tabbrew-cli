// Authenticated API calls. Every call attaches the bearer token and turns a 401
// into a friendly "please log in again" message.
import { config } from "./config";
import { resolveToken } from "./credentials";
import { fetchWithTimeout, safeText } from "./util";

export class NotAuthenticatedError extends Error {
  constructor(message = "You are not logged in. Run `tabbrew login` first.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenExpiredError";
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function resolveUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${config.baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** fetch() with the bearer token attached; throws typed errors on auth failure. */
export async function authedFetch(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const resolved = await resolveToken();
  if (!resolved) throw new NotAuthenticatedError();

  let res: Response;
  try {
    res = await fetchWithTimeout(
      resolveUrl(pathOrUrl),
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {}),
          Authorization: `Bearer ${resolved.token}`,
        },
      },
      config.timeoutMs,
    );
  } catch (err) {
    throw new ApiError(
      `Could not reach ${resolveUrl(pathOrUrl)}: ${(err as Error).message}`,
      0,
    );
  }

  if (res.status === 401) {
    throw new TokenExpiredError(
      resolved.source === "env"
        ? `The token in $${config.tokenEnvVar} was rejected (401) — it is expired or invalid.`
        : "Your session has expired (401). Run `tabbrew login` to sign in again.",
    );
  }

  return res;
}

/** Call the userinfo endpoint and return the parsed user object. */
export async function fetchUserInfo(): Promise<Record<string, unknown>> {
  const res = await authedFetch(config.endpoints.userInfo);
  if (!res.ok) {
    const detail = await safeText(res);
    throw new ApiError(
      `whoami failed (HTTP ${res.status})` + (detail ? `: ${detail}` : ""),
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

// One row of the Docs list. Mirrors the server's HtmlFileDTO
// (tabbrew-web/lib/html-files.ts) — kept a tolerant reader, so extra fields the
// server may add later are ignored rather than breaking an older binary.
export interface HtmlFileRow {
  id: number;
  title: string;
  filename: string;
  sizeBytes: number;
  kind: "gcs" | "local";
  localPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * List the signed-in user's HTML docs. Like the POST helper below, the read
 * route authenticates with the OAuth login token (Authorization: Bearer), so
 * this uses `authedFetch` directly like `fetchUserInfo`.
 */
export async function htmlFilesList(): Promise<HtmlFileRow[]> {
  const res = await authedFetch(config.endpoints.htmlList);
  if (!res.ok) {
    const detail = await safeText(res);
    throw new ApiError(
      `docs list failed (HTTP ${res.status})` + (detail ? `: ${detail}` : ""),
      res.status,
    );
  }
  const body = (await res.json()) as { data?: HtmlFileRow[] };
  return body.data ?? [];
}

/**
 * Owner-only browser view URL for a cloud (`gcs`) doc — the same URL the TabBrew
 * extension opens (`…/api/v1/html_files/<id>/view`). Derived from `config.baseUrl`
 * so staging/local targets work without a new env var. It is gated by the
 * tabbrew.com session cookie, so it only renders in a browser signed in to
 * tabbrew.com. Local docs open via `file://` instead (see commands/docs.ts).
 */
export function htmlFileViewUrl(id: number): string {
  return `${config.baseUrl}/api/v1/html_files/${id}/view`;
}

// --- html_files (Docs view) ------------------------------------------------
// These endpoints authenticate with the OAuth login token (Authorization:
// Bearer) like the rest of the CLI, so htmlFilesPost delegates to authedFetch
// (as htmlFilesList does) and only layers on the Docs-specific response
// handling below. (They once also accepted a legacy per-feature x-upload-token;
// the server dropped that, so the CLI no longer sends it.)

export interface HtmlFilesResponse {
  success: boolean;
  /** Present on success; the server echoes the stored record here. */
  data?: {
    id?: number;
    title?: string;
    filename?: string;
    kind?: "local" | "gcs" | string;
    localPath?: string | null;
    /** cloud mode: an owner-only view URL for the uploaded doc. */
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * POST to an html_files (Docs) endpoint with the OAuth login token, then apply
 * the Docs-specific response handling. `authedFetch` supplies the bearer,
 * timeout, and typed auth errors (NotAuthenticatedError when logged out,
 * TokenExpiredError on a 401), so this only builds the request and hands the
 * response to `handleHtmlFilesResponse`.
 */
export async function htmlFilesPost(
  url: string,
  built: { body: string | FormData; headers?: Record<string, string> },
): Promise<HtmlFilesResponse> {
  const res = await authedFetch(url, {
    method: "POST",
    headers: built.headers,
    body: built.body,
  });
  return handleHtmlFilesResponse(res);
}

async function handleHtmlFilesResponse(
  res: Response,
): Promise<HtmlFilesResponse> {
  if (res.status === 413) {
    throw new ApiError(
      "File exceeds the 2 MB cloud limit — use local mode (drop --cloud) or slim the file.",
      413,
    );
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json: HtmlFilesResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as HtmlFilesResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || (json != null && json.success === false)) {
    const serverMsg =
      json && typeof json.error === "string" ? json.error : text.slice(0, 300);
    throw new ApiError(
      `Docs upload failed (HTTP ${res.status})` +
        (serverMsg ? `: ${serverMsg}` : ""),
      res.status,
    );
  }

  return json ?? { success: true };
}
