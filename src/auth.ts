// OAuth 2.0 Device Authorization Grant (RFC 8628).
import { config } from "./config";
import { fetchWithTimeout, safeText, sleep } from "./util";

/** A user-facing auth failure. The router prints its message without a stack trace. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  /** Some servers include the code pre-filled in this URL. */
  verification_uri_complete?: string;
  expires_in: number;
  /** Minimum seconds between polls; defaults to 5 per the spec. */
  interval?: number;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

/** Step 1: ask the server for a device + user code. */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({ client_id: config.clientId });
  if (config.scope) body.set("scope", config.scope);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      config.endpoints.deviceCode,
      { method: "POST", headers: FORM_HEADERS, body },
      config.timeoutMs,
    );
  } catch (err) {
    throw new AuthError(
      `Could not reach the auth server at ${config.endpoints.deviceCode}.\n` +
        `  ${(err as Error).message}\n` +
        "  Check TABBREW_BASE_URL / your network.",
    );
  }

  if (!res.ok) {
    const detail = await safeText(res);
    throw new AuthError(
      `Device code request was rejected (HTTP ${res.status})` +
        (detail ? `:\n  ${detail}` : "."),
    );
  }

  const data = (await res.json().catch(() => null)) as DeviceCodeResponse | null;
  if (!data?.device_code || !data.user_code || !data.verification_uri) {
    throw new AuthError(
      "The auth server did not return a valid device code response.",
    );
  }
  return data;
}

/**
 * Step 3: poll the token endpoint until the user approves.
 * Handles the standard `authorization_pending` (keep polling) and `slow_down`
 * (back off by 5s) error codes from RFC 8628 §3.5.
 */
export async function pollForToken(
  device: DeviceCodeResponse,
  onTick?: (message: string) => void,
): Promise<TokenResponse> {
  let intervalMs = (device.interval ?? 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;

  while (true) {
    await sleep(intervalMs);

    if (Date.now() > deadline) {
      throw new AuthError(
        "The device code expired before you approved it. Run `login` again.",
      );
    }

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: config.clientId,
    });

    let res: Response;
    try {
      res = await fetchWithTimeout(
        config.endpoints.token,
        { method: "POST", headers: FORM_HEADERS, body },
        config.timeoutMs,
      );
    } catch (err) {
      // Transient network blip or slow poll — keep polling rather than aborting.
      onTick?.(`network error, retrying: ${(err as Error).message}`);
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok && typeof data.access_token === "string") {
      return data as unknown as TokenResponse;
    }

    switch (data.error) {
      case "authorization_pending":
        onTick?.("waiting for you to approve…");
        continue;
      case "slow_down":
        intervalMs += 5000;
        onTick?.(`server asked us to slow down (now every ${intervalMs / 1000}s)`);
        continue;
      case "access_denied":
        throw new AuthError("Access was denied — the login request was rejected.");
      case "expired_token":
        throw new AuthError(
          "The device code expired before you approved it. Run `login` again.",
        );
      default: {
        const desc =
          (data.error_description as string) ||
          (data.error as string) ||
          `HTTP ${res.status}`;
        throw new AuthError(`Token request failed: ${desc}`);
      }
    }
  }
}
