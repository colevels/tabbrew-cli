// Central configuration. Everything is overridable via environment variables so
// the same binary can point at prod, staging, or a local device-flow server.

import { homedir } from "node:os";
import { join } from "node:path";

const stripTrailingSlash = (u: string): string => u.replace(/\/+$/, "");

const baseUrl = stripTrailingSlash(
  process.env.TABBREW_BASE_URL ?? "https://www.tabbrew.com",
);

// Self-update source: GitHub Releases for this repo (not $BASE, which is the
// TabBrew server). The URLs derive from the slug unless individually overridden.
const updateRepo = process.env.TABBREW_REPO ?? "colevels/tabbrew-cli";

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
    /** GET — list the signed-in user's HTML docs (Docs view). */
    htmlList: string;
  };
  /**
   * Self-update (`tabbrew update`). Points at GitHub Releases, not the TabBrew
   * web API — overridable so a test can aim it at a local fixture server.
   */
  update: {
    /** `owner/name` slug the release URLs derive from. */
    repo: string;
    /** URL that 302-redirects to the newest release's tag page. */
    releaseLatestUrl: string;
    /** Base URL the per-asset download URLs are built from. */
    downloadBaseUrl: string;
    /** Timeout for the (tens-of-MB) binary download, separate from timeoutMs. */
    downloadTimeoutMs: number;
  };
  /** Env var the CLI reads a token from (CI/CD), overriding the stored file. */
  tokenEnvVar: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** `tabbrew tabs serve` — local HTTP bridge the Chrome extension POSTs tabs to. */
  serve: {
    /**
     * Bind port, shared by `tabs serve` (listens) and `tabs push` (connects).
     * Host is always 127.0.0.1 (hardcoded in the command, not here).
     */
    port: number;
    /** Where the posted tabs JSON is saved. */
    outPath: string;
  };
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
    htmlList:
      process.env.TABBREW_HTML_LIST_URL ?? `${baseUrl}/api/v1/html_files`,
  },
  update: {
    repo: updateRepo,
    releaseLatestUrl:
      process.env.TABBREW_RELEASE_URL ??
      `https://github.com/${updateRepo}/releases/latest`,
    downloadBaseUrl: stripTrailingSlash(
      process.env.TABBREW_DOWNLOAD_BASE_URL ??
        `https://github.com/${updateRepo}/releases/latest/download`,
    ),
    downloadTimeoutMs: parsePositiveInt(
      process.env.TABBREW_DOWNLOAD_TIMEOUT_MS,
      120000,
    ),
  },
  tokenEnvVar: "TABBREW_TOKEN",
  timeoutMs: parsePositiveInt(process.env.TABBREW_TIMEOUT_MS, 15000),
  serve: {
    port: parsePositiveInt(process.env.TABBREW_SERVE_PORT, 49227),
    outPath:
      process.env.TABBREW_TABS_PATH ??
      join(homedir(), ".config", "tabbrew", "tabs.json"),
  },
};
