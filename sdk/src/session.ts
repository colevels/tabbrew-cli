import {
  DEFAULT_PORTS,
  discover as discoverOn,
  probe as probeOn,
  type SessionInfo,
} from '../../src/core/session/protocol'

// Looser than the CLI's 400ms: Chrome adds its own latency, but a foreign
// socket that accepts and never answers still must not stall the page.
const PROBE_TIMEOUT_MS = 1500

export const probe = (port: number): Promise<SessionInfo | null> => probeOn(port, PROBE_TIMEOUT_MS)

export const discover = (ports: readonly number[] = DEFAULT_PORTS): Promise<SessionInfo | null> =>
  discoverOn(ports, PROBE_TIMEOUT_MS)
