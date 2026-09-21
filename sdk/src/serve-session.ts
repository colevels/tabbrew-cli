// One call for an extension page: find the session, serve its commands, and
// keep doing both until the signal aborts. An open page *is* the connection;
// this belongs in a page, never in a service worker.

import type { DeclareResponse } from '../../src/core/commands/declaration'
import type { Operators } from '../../src/core/operators/contract'
import { DEFAULT_PORTS, type SessionInfo } from '../../src/core/session/protocol'
import {
  type Declared,
  type NamespaceDefinition,
  pause,
  type Rejection,
  type ServedCommandEvent,
  type ServedEvent,
  serveRequests,
} from './channel'
import { discover } from './session'

export type { ServedCommandEvent, ServedEvent }

export type SessionStatus =
  | { state: 'searching'; at: number }
  // `declared` says what the session made of the page's own commands; it is
  // absent against a session that predates them.
  | { state: 'connected'; at: number; session: SessionInfo; declared?: DeclareResponse }
  // Once, on the first poll after a session this call was serving went away.
  | { state: 'lost'; at: number }
  // This session has nothing for the page to serve, and asking again gets the
  // same answer; the next session is asked afresh.
  | { state: 'rejected'; at: number; session: SessionInfo; reason: Rejection }

export interface ServeSessionOptions {
  // The base every tabbrew command runs on. Leave out to add commands only.
  operators?: Operators
  // The page's own commands, called as `tabbrew plugin <namespace> <command>`.
  namespaces?: Record<string, NamespaceDefinition>
  // The extension page the CLI may open when a command finds no page
  // connected, as a path inside the extension.
  page?: string
  signal: AbortSignal
  // After every poll, the ones that find nothing included.
  onStatus?: (status: SessionStatus) => void
  onServed?: (event: ServedEvent) => void
  onCommandServed?: (event: ServedCommandEvent) => void
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
  namespaces,
  page,
  signal,
  onStatus,
  onServed,
  onCommandServed,
  ports = DEFAULT_PORTS,
  pollMs = POLL_MS,
  retryMs,
}: ServeSessionOptions): Promise<void> {
  if (!operators && !namespaces) throw new TypeError('serveSession needs operators or namespaces')

  let channel: { key: string; controller: AbortController; outcome: Declared } | undefined
  // A probe in flight cannot be aborted; the channel must not wait for it.
  signal.addEventListener('abort', () => channel?.controller.abort(), { once: true })

  while (!signal.aborted) {
    const session = await discover(ports)
    if (signal.aborted) return

    const lost = channel !== undefined && session === null
    // Keyed on what stays the same for the life of a session: every poll hands
    // back a fresh object and the channel must outlive them. A new pid has
    // forgotten what this page declared, or may accept what the last refused.
    const key = session ? `${session.pid}:${session.port}` : undefined
    if (key !== channel?.key) {
      channel?.controller.abort()
      channel = undefined
      if (session && key) {
        const opened = { key, controller: new AbortController(), outcome: {} as Declared }
        channel = opened
        void serveRequests({
          port: session.port,
          operators,
          namespaces,
          page,
          signal: opened.controller.signal,
          onServed,
          onCommandServed,
          onDeclared: (outcome) => {
            opened.outcome = outcome
          },
          retryMs,
        })
      }
    }

    const at = Date.now()
    if (!session || !channel) onStatus?.({ state: lost ? 'lost' : 'searching', at })
    else if ('rejected' in channel.outcome) {
      onStatus?.({ state: 'rejected', at, session, reason: channel.outcome.rejected })
    } else onStatus?.({ state: 'connected', at, session, declared: channel.outcome.declared })
    await pause(pollMs, signal)
  }
}
