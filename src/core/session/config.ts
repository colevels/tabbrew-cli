import { homedir } from 'node:os'
import { join } from 'node:path'
import pkg from '../../../package.json'
import { DEFAULT_PORTS } from './protocol'

export { CONNECTION_PAGE, EXTENSION_KEY, HOST, PRODUCT_EXTENSION_ID, SERVICE } from './protocol'

export const VERSION: string = pkg.version

export const PORTS: readonly number[] =
  parsePorts(process.env.TABBREW_SESSION_PORTS) ?? DEFAULT_PORTS

export const IDLE_EXIT_MS = parseMs(process.env.TABBREW_SESSION_IDLE_MS) ?? 10 * 60 * 1000
export const PROBE_TIMEOUT_MS = 400
export const SPAWN_WAIT_MS = 4_000
export const STOP_WAIT_MS = 3_000
// Chrome has to open a tab and load the page before it can hold the channel.
export const CONNECT_WAIT_MS = parseMs(process.env.TABBREW_SESSION_CONNECT_WAIT_MS) ?? 5_000

// How long a call waits for a panel to claim it, how long a claimed call
// waits for its result, and how long the panel's poll is held open.
export const CLAIM_WAIT_MS = parseMs(process.env.TABBREW_SESSION_CLAIM_WAIT_MS) ?? 2_000
export const OPERATOR_TIMEOUT_MS =
  parseMs(process.env.TABBREW_SESSION_OPERATOR_TIMEOUT_MS) ?? 10_000
export const LONG_POLL_MS = parseMs(process.env.TABBREW_SESSION_LONG_POLL_MS) ?? 25_000
// An upper bound only: the session answers sooner in every case it handles.
export const OPERATOR_CALL_TIMEOUT_MS = 30_000

export const STATE_DIR = process.env.TABBREW_SESSION_DIR ?? join(homedir(), '.tabbrew')
export const LOG_PATH = join(STATE_DIR, 'session.log')

// Under `bun run src/index.ts` execPath is bun and the entry is Bun.main; in
// a compiled binary execPath is tabbrew itself and Bun.main is a virtual path
// baked into it.
export const compiled = Bun.main.includes('$bunfs') || Bun.main.includes('~BUN')

export function selfArgv(...args: string[]): [string, ...string[]] {
  return compiled ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args]
}

function parsePorts(value: string | undefined): number[] | null {
  if (!value) return null
  const ports = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
  return ports.length ? ports : null
}

function parseMs(value: string | undefined): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
