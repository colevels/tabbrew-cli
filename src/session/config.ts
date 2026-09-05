import { homedir } from 'node:os'
import { join } from 'node:path'
import pkg from '../../package.json'

export const VERSION: string = pkg.version
export const SERVICE = 'tabbrew-session'
export const HOST = '127.0.0.1'

// The only two loopback ports the TabBrew extension's manifest lets Chrome
// reach. A session anywhere else is invisible to the browser.
const DEFAULT_PORTS: readonly number[] = [49227, 49228]

export const PORTS: readonly number[] =
  parsePorts(process.env.TABBREW_SESSION_PORTS) ?? DEFAULT_PORTS

export const IDLE_EXIT_MS = parseMs(process.env.TABBREW_SESSION_IDLE_MS) ?? 10 * 60 * 1000
export const PROBE_TIMEOUT_MS = 400
export const SPAWN_WAIT_MS = 4_000
export const STOP_WAIT_MS = 3_000

export const STATE_DIR = process.env.TABBREW_SESSION_DIR ?? join(homedir(), '.tabbrew')
export const LOG_PATH = join(STATE_DIR, 'session.log')

// Under `bun run src/index.ts` execPath is bun and the entry is Bun.main; in
// a compiled binary execPath is tabbrew itself and Bun.main is a virtual path
// baked into it.
const compiled = Bun.main.includes('$bunfs') || Bun.main.includes('~BUN')

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
