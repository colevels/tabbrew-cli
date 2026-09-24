// The page's half of the command channel: say what it serves, then claim a
// request from the session, run it, post the result, repeat while the page is
// open. One loop serves the operators and the page's own commands alike.

import type { CommandDeclaration, DeclareResponse } from '../../src/core/commands/declaration'
import { COMMANDS_VERSION } from '../../src/core/commands/declaration'
import type { OperatorName, Operators } from '../../src/core/operators/contract'
import {
  COMMANDS_PATH,
  HOST,
  NEXT_REQUEST_PATH,
  type OperatorResult,
  OWNER_PARAMETER,
  resultPath,
  type SessionRequest,
} from '../../src/core/session/protocol'

export interface CommandDefinition extends CommandDeclaration {
  // Arguments and options arrive as one object, a name like `tab-id` as `tabId`.
  run: (input: Record<string, unknown>) => unknown
}

export interface NamespaceDefinition {
  description: string
  commands: Record<string, CommandDefinition>
}

export interface ServedEvent {
  at: number
  operator: OperatorName
  error?: string
}

export interface ServedCommandEvent {
  at: number
  namespace: string
  command: string
  error?: string
}

export type Rejection = 'forbidden' | 'namespace_taken' | 'bad_commands' | 'unsupported_session'

// `declared` is absent when the page serves without a token: the session
// predates plugins, or did not take the request for an extension's.
export type Declared = { declared?: DeclareResponse } | { rejected: Rejection }

export interface ChannelOptions {
  port: number
  operators?: Operators
  namespaces?: Record<string, NamespaceDefinition>
  page?: string
  signal: AbortSignal
  onServed?: (event: ServedEvent) => void
  onCommandServed?: (event: ServedCommandEvent) => void
  onDeclared?: (outcome: Declared) => void
  retryMs?: number
}

export const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })

const REFUSALS: Record<number, Rejection> = {
  400: 'bad_commands',
  403: 'forbidden',
  404: 'unsupported_session',
}

export async function serveRequests({
  port,
  operators,
  namespaces = {},
  page,
  signal,
  onServed,
  onCommandServed,
  onDeclared,
  retryMs = 1_000,
}: ChannelOptions): Promise<void> {
  const base = `http://${HOST}:${port}`
  const declaration = JSON.stringify({
    commandsVersion: COMMANDS_VERSION,
    operators: Object.keys(operators ?? {}),
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([namespace, { description, commands }]) => [
        namespace,
        {
          description,
          commands: Object.fromEntries(
            Object.entries(commands).map(([name, { run: _, ...command }]) => [name, command]),
          ),
        },
      ]),
    ),
    page,
  })

  // The names came over the wire; the types only say what they should be.
  async function execute(request: SessionRequest): Promise<OperatorResult> {
    let run: ((input: never) => unknown) | undefined
    if ('namespace' in request) {
      const commands = Object.hasOwn(namespaces, request.namespace)
        ? namespaces[request.namespace]?.commands
        : undefined
      if (commands && Object.hasOwn(commands, request.command)) run = commands[request.command]?.run
      if (!run) return { error: `unknown command: ${request.namespace} ${request.command}` }
    } else {
      if (!operators) return { error: 'this page serves no operators' }
      if (Object.hasOwn(operators, request.operator)) run = operators[request.operator]
      if (!run) return { error: `unknown operator: ${request.operator}` }
    }
    try {
      return { output: await run(request.input as never) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  while (!signal.aborted) {
    let owner: string | undefined
    try {
      const response = await fetch(base + COMMANDS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: declaration,
        signal,
      })
      if (response.ok) {
        const declared = (await response.json()) as DeclareResponse
        const refusals = Object.values(declared.rejected)
        if (!operators && declared.accepted.length === 0) {
          onDeclared?.({
            rejected: refusals.every((refusal) => refusal === 'bad_commands')
              ? 'bad_commands'
              : 'namespace_taken',
          })
          return
        }
        owner = declared.owner
        onDeclared?.({ declared })
      } else {
        const refusal = REFUSALS[response.status]
        if (!refusal) {
          await pause(retryMs, signal)
          continue
        }
        // Without a token a session hands out operators only, and one that
        // predates plugins hands them to whoever polls: a page with none to
        // serve would take the extension's calls and fail them.
        if (!operators) {
          onDeclared?.({ rejected: refusal })
          return
        }
        onDeclared?.({})
      }
    } catch {
      if (signal.aborted) return
      await pause(retryMs, signal)
      continue
    }

    const next = owner
      ? `${base}${NEXT_REQUEST_PATH}?${OWNER_PARAMETER}=${owner}`
      : base + NEXT_REQUEST_PATH
    while (!signal.aborted) {
      let request: SessionRequest
      try {
        const response = await fetch(next, { signal })
        if (response.status === 204) continue
        // A restarted session has forgotten the token; only declaring again helps.
        if (response.status === 410) break
        if (!response.ok) {
          await pause(retryMs, signal)
          continue
        }
        request = (await response.json()) as SessionRequest
      } catch {
        if (signal.aborted) return
        await pause(retryMs, signal)
        continue
      }

      const result = await execute(request)
      const outcome = { at: Date.now(), ...('error' in result ? { error: result.error } : {}) }
      if ('namespace' in request) {
        onCommandServed?.({ ...outcome, namespace: request.namespace, command: request.command })
      } else {
        onServed?.({ ...outcome, operator: request.operator })
      }
      try {
        await fetch(base + resultPath(request.id), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(result),
          signal,
        })
      } catch {
        // The session is gone or gave up on this request; the next poll says which.
      }
    }
  }
}
