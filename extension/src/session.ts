import {
  DEFAULT_PORTS,
  discover as discoverOn,
  HOST,
  probe as probeOn,
  type SessionInfo,
} from '../../src/core/session/protocol'

export { DEFAULT_PORTS as PORTS, formatUptime, HOST } from '../../src/core/session/protocol'
export type { SessionInfo }

// Looser than the CLI's 400ms: Chrome adds its own latency, but a foreign
// socket that accepts and never answers still must not stall the panel.
const PROBE_TIMEOUT_MS = 1500

const ORIGINS = DEFAULT_PORTS.map((port) => `http://${HOST}:${port}/*`)

export const probe = (port: number): Promise<SessionInfo | null> => probeOn(port, PROBE_TIMEOUT_MS)

export const discover = (ports: readonly number[] = DEFAULT_PORTS): Promise<SessionInfo | null> =>
  discoverOn(ports, PROBE_TIMEOUT_MS)

export async function hasPermission(): Promise<boolean> {
  for (const origin of ORIGINS) {
    if (await chrome.permissions.contains({ origins: [origin] })) return true
  }
  return false
}

// Call this as the FIRST await of a click handler: Chrome's transient
// activation lapses otherwise and request() is refused without a prompt.
// Per origin so a user who declines the fallback port keeps the default one.
export async function ensurePermission(): Promise<boolean> {
  const granted: string[] = []
  const missing: string[] = []
  for (const origin of ORIGINS) {
    if (await chrome.permissions.contains({ origins: [origin] })) granted.push(origin)
    else missing.push(origin)
  }
  if (missing.length === 0) return true
  if (await chrome.permissions.request({ origins: missing })) return true
  return granted.length > 0
}
