// One call for an extension page: find the session, serve its commands, and
// keep doing both until the signal aborts. An open page *is* the connection;
// this belongs in a page, never in a service worker.

import type { Operators } from '../../src/core/operators/contract'
import { DEFAULT_PORTS, type SessionInfo } from '../../src/core/session/protocol'
import { pause, type ServedEvent, serveOperators } from './channel'
import { discover } from './session'

export type { ServedEvent }

export type SessionStatus =
  | { state: 'searching'; at: number }
  | { state: 'connected'; at: number; session: SessionInfo }
  // Once, on the first poll after a session this call was serving went away.
  | { state: 'lost'; at: number }

export interface ServeSessionOptions {
  operators: Operators
  signal: AbortSignal
  // After every poll, the ones that find nothing included.
  onStatus?: (status: SessionStatus) => void
  onServed?: (event: ServedEvent) => void
  ports?: readonly number[]
  pollMs?: number
  retryMs?: number
}

// Well inside the session's idle window, so a serving page keeps it alive: a
// /health request counts as use. Also inside the CLI's wait for `listening`
// after it spawns a session.
const POLL_MS = 3_000

export async function serveSession({
  operators,
  signal,
  onStatus,
  onServed,
  ports = DEFAULT_PORTS,
  pollMs = POLL_MS,
  retryMs,
}: ServeSessionOptions): Promise<void> {
  let channel: { port: number; controller: AbortController } | undefined
  // A probe in flight cannot be aborted; the channel must not wait for it.
  signal.addEventListener('abort', () => channel?.controller.abort(), { once: true })

  while (!signal.aborted) {
    const session = await discover(ports)
    if (signal.aborted) return

    const lost = channel !== undefined && session === null
    // Keyed on the port, not the session: every poll hands back a fresh object
    // and the channel must outlive them. A session restarted on the same port
    // is picked up by the channel's own retry.
    if (session?.port !== channel?.port) {
      channel?.controller.abort()
      channel = undefined
      if (session) {
        const controller = new AbortController()
        channel = { port: session.port, controller }
        void serveOperators({
          port: session.port,
          operators,
          signal: controller.signal,
          onServed,
          retryMs,
        })
      }
    }

    const at = Date.now()
    if (session) onStatus?.({ state: 'connected', at, session })
    else onStatus?.({ state: lost ? 'lost' : 'searching', at })
    await pause(pollMs, signal)
  }
}
