import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import {
  HOST,
  LOG_PATH,
  PORTS,
  PROBE_TIMEOUT_MS,
  SPAWN_WAIT_MS,
  STATE_DIR,
  STOP_WAIT_MS,
  selfArgv,
} from './config'
import type { SessionInfo } from './protocol'
import * as protocol from './protocol'

export const probe = (port: number): Promise<SessionInfo | null> =>
  protocol.probe(port, PROBE_TIMEOUT_MS)

export const discover = (): Promise<SessionInfo | null> =>
  protocol.discover(PORTS, PROBE_TIMEOUT_MS)

export function spawnDetached(): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const log = openSync(LOG_PATH, 'a')
  const [cmd, ...args] = selfArgv('session', 'run')
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
}

export async function waitForSession(ms = SPAWN_WAIT_MS): Promise<SessionInfo | null> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const found = await discover()
    if (found) return found
    await Bun.sleep(40)
  }
  return null
}

export async function stopSession(session: SessionInfo): Promise<boolean> {
  try {
    await fetch(`http://${HOST}:${session.port}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch {
    // The server may drop the connection while exiting; the probe below is the judge.
  }
  const until = Date.now() + STOP_WAIT_MS
  while (Date.now() < until) {
    if (!(await probe(session.port))) return true
    await Bun.sleep(40)
  }
  return false
}
