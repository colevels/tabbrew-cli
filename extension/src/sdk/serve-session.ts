// What another extension needs to add its own commands to tabbrew: declare
// them to the session, then serve the calls the session routes back.

import {
  COMMANDS_VERSION,
  type CommandDeclaration,
  type Declaration,
} from '../../../src/core/commands/declaration'
import {
  COMMANDS_PATH,
  DEFAULT_PORTS,
  discover,
  HOST,
  type SessionInfo,
} from '../../../src/core/session/protocol'
import { execute, pause, type ServedEvent, serveRequests } from '../utils/channel'

export type {
  ArgumentDeclaration,
  CommandDeclaration,
  OptionDeclaration,
  ValueType,
  View,
} from '../../../src/core/commands/declaration'
export type { ServedEvent, SessionInfo }

// biome-ignore lint/suspicious/noExplicitAny: each command names its own input shape
export interface Command<Input = any> extends CommandDeclaration {
  run: (input: Input) => Promise<unknown>
}

export type Rejection = 'forbidden' | 'namespace_taken' | 'bad_commands'

export type SessionStatus =
  | { state: 'searching' }
  | { state: 'connected'; session: SessionInfo }
  | { state: 'rejected'; reason: Rejection }

export interface ServeSessionOptions {
  namespace: string
  description: string
  commands: Record<string, Command>
  signal: AbortSignal
  ports?: readonly number[]
  onStatus?: (status: SessionStatus) => void
  onServed?: (event: ServedEvent) => void
  retryMs?: number
}

const PROBE_TIMEOUT_MS = 1500

const REJECTIONS: Record<number, Rejection> = {
  400: 'bad_commands',
  403: 'forbidden',
  409: 'namespace_taken',
}

export async function serveSession({
  namespace,
  description,
  commands,
  signal,
  ports = DEFAULT_PORTS,
  onStatus,
  onServed,
  retryMs = 1_000,
}: ServeSessionOptions): Promise<void> {
  const declaration: Declaration = {
    commandsVersion: COMMANDS_VERSION,
    namespace,
    description,
    commands: Object.fromEntries(
      Object.entries(commands).map(([name, { run: _, ...declared }]) => [name, declared]),
    ),
  }
  const handlers = Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [name, command.run]),
  )

  while (!signal.aborted) {
    onStatus?.({ state: 'searching' })
    const session = await discover(ports, PROBE_TIMEOUT_MS)
    if (signal.aborted) return
    if (!session) {
      await pause(retryMs, signal)
      continue
    }

    let owner: unknown
    try {
      const response = await fetch(`http://${HOST}:${session.port}${COMMANDS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(declaration),
        signal,
      })
      const rejection = REJECTIONS[response.status]
      // Asking again gets the same answer, so a refusal ends the loop.
      if (rejection) return onStatus?.({ state: 'rejected', reason: rejection })
      owner = response.ok ? ((await response.json()) as { owner?: unknown }).owner : undefined
    } catch {
      if (signal.aborted) return
    }
    // Anything else, an older session included, may be different next time.
    if (typeof owner !== 'string') {
      await pause(retryMs, signal)
      continue
    }

    onStatus?.({ state: 'connected', session })
    await serveRequests({
      port: session.port,
      owner,
      signal,
      onServed,
      retryMs,
      run: (request) => execute(handlers, request),
    })
  }
}
