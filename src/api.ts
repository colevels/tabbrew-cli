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
