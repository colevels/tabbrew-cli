// Central configuration. Everything is overridable via environment variables so
// the same binary can point at prod, staging, or a local device-flow server.

const stripTrailingSlash = (u: string): string => u.replace(/\/+$/, "");

const baseUrl = stripTrailingSlash(
  process.env.TABBREW_BASE_URL ?? "https://www.tabbrew.com",
);

export interface CliConfig {
  /** Base URL of the auth/identity server. */
  baseUrl: string;
  /** OAuth client identifier presented in the device flow. */
  clientId: string;
  /** Optional space-delimited scopes. */
  scope: string | undefined;
  endpoints: {
    /** POST — RFC 8628 device authorization request. */
    deviceCode: string;
    /** POST — RFC 8628 token endpoint (polled). */
    token: string;
    /** GET — "whoami" / userinfo, requires a valid bearer token. */
    userInfo: string;
    /** POST — register a local HTML file's absolute path (Docs view). */
    htmlLocal: string;
    /** POST — upload HTML content to cloud storage (Docs view). */
    htmlUpload: string;
  };
  /** Env var the CLI reads a token from (CI/CD), overriding the stored file. */
  tokenEnvVar: string;
  /** Env var the CLI reads the html_files upload token from, overriding the file. */
  uploadTokenEnvVar: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const config: CliConfig = {
  baseUrl,
  clientId: process.env.TABBREW_CLIENT_ID ?? "tabbrew-cli",
  scope: process.env.TABBREW_SCOPE || undefined,
  endpoints: {
    deviceCode:
      process.env.TABBREW_DEVICE_CODE_URL ??
      `${baseUrl}/api/v1/oauth/device/code`,
    token: process.env.TABBREW_TOKEN_URL ?? `${baseUrl}/api/v1/oauth/token`,
    userInfo:
      process.env.TABBREW_USERINFO_URL ?? `${baseUrl}/api/v1/oauth/userinfo`,
    htmlLocal:
      process.env.TABBREW_HTML_LOCAL_URL ?? `${baseUrl}/api/v1/html_files/local`,
    htmlUpload:
      process.env.TABBREW_HTML_UPLOAD_URL ??
      `${baseUrl}/api/v1/html_files/upload`,
  },
  tokenEnvVar: "TABBREW_TOKEN",
  uploadTokenEnvVar: "TABBREW_UPLOAD_TOKEN",
  timeoutMs: parsePositiveInt(process.env.TABBREW_TIMEOUT_MS, 15000),
};
