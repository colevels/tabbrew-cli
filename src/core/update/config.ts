import pkg from '../../../package.json'

export const VERSION: string = pkg.version

// Releases live on GitHub, not on any TabBrew server. Overridable so a test
// can point them at a local fixture, or a fork at its own releases.
export const REPOSITORY = process.env.TABBREW_UPDATE_REPOSITORY ?? 'colevels/tabbrew-cli'
export const LATEST_URL =
  process.env.TABBREW_UPDATE_LATEST_URL ?? `https://github.com/${REPOSITORY}/releases/latest`
export const DOWNLOAD_BASE_URL = (
  process.env.TABBREW_UPDATE_DOWNLOAD_BASE_URL ??
  `https://github.com/${REPOSITORY}/releases/latest/download`
).replace(/\/+$/, '')

export const REQUEST_TIMEOUT_MS = 15_000
// The binary is tens of megabytes.
export const DOWNLOAD_TIMEOUT_MS =
  parseMs(process.env.TABBREW_UPDATE_DOWNLOAD_TIMEOUT_MS) ?? 120_000

export const UPDATE_CHECK_INTERVAL_MS =
  parseMs(process.env.TABBREW_UPDATE_CHECK_INTERVAL_MS) ?? 24 * 60 * 60 * 1000

// Read live rather than frozen at import time: it's a plain opt-out flag
// checked once per invocation, and reading it live keeps it easy to test.
export const noUpdateCheck = (): boolean => truthy(process.env.TABBREW_NO_UPDATE_CHECK)

function parseMs(value: string | undefined): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function truthy(value: string | undefined): boolean {
  return value != null && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}
