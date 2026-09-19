// The panel's half of the command channel: claim a request from the session,
// run it against Chrome, post the result, repeat while the panel is open.

import type { Operators } from '../../../src/core/operators/contract'
import {
  HOST,
  NEXT_REQUEST_PATH,
  type OperatorRequest,
  type OperatorResult,
  OWNER_PARAM,
  resultPath,
} from '../../../src/core/session/protocol'

export interface ServedEvent {
  at: number
  operator: string
  error?: string
}

export interface ChannelOptions {
  port: number
  operators: Operators
  signal: AbortSignal
  onServed?: (event: ServedEvent) => void
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

export type Handlers = Record<string, (input: never) => Promise<unknown>>

export async function execute(
  handlers: Handlers,
  request: OperatorRequest,
): Promise<OperatorResult> {
  // The name came over the wire; the contract only says what it should be.
  if (!Object.hasOwn(handlers, request.operator)) {
    return { error: `unknown operator: ${request.operator}` }
  }
  const run = handlers[request.operator] as (input: unknown) => Promise<unknown>
  try {
    return { output: await run(request.input) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export interface RequestLoopOptions {
  port: number
  signal: AbortSignal
  run: (request: OperatorRequest) => Promise<OperatorResult>
  // The token from declaring commands; without one the loop serves the standard pool.
  owner?: string
  onServed?: (event: ServedEvent) => void
  retryMs?: number
}

// Settles on abort, or for an owned loop as soon as the token stops being
// good: a restarted session has forgotten it, and only declaring again helps.
export async function serveRequests({
  port,
  signal,
  run,
  owner,
  onServed,
  retryMs = 1_000,
}: RequestLoopOptions): Promise<void> {
  const base = `http://${HOST}:${port}`
  const next =
    base + NEXT_REQUEST_PATH + (owner ? `?${OWNER_PARAM}=${encodeURIComponent(owner)}` : '')
  while (!signal.aborted) {
    let request: OperatorRequest
    try {
      const response = await fetch(next, { signal })
      if (response.status === 204) continue
      if (owner && response.status === 410) return
      if (!response.ok) {
        await pause(retryMs, signal)
        continue
      }
      request = (await response.json()) as OperatorRequest
    } catch {
      if (signal.aborted || owner) return
      await pause(retryMs, signal)
      continue
    }

    const result = await run(request)
    onServed?.({
      at: Date.now(),
      operator: request.operator,
      ...('error' in result ? { error: result.error } : {}),
    })
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

export const serveOperators = ({ operators, ...loop }: ChannelOptions): Promise<void> =>
  serveRequests({ ...loop, run: (request) => execute(operators, request) })
