// The panel's half of the command channel: claim a request from the session,
// run it against Chrome, post the result, repeat while the panel is open.

import type { OperatorName, Operators } from '../../../src/core/operators/contract'
import {
  HOST,
  NEXT_REQUEST_PATH,
  type OperatorRequest,
  type OperatorResult,
  resultPath,
} from '../../../src/core/session/protocol'

export interface ServedEvent {
  at: number
  operator: OperatorName
  error?: string
}

export interface ChannelOptions {
  port: number
  operators: Operators
  signal: AbortSignal
  onServed?: (event: ServedEvent) => void
  retryMs?: number
}

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })

async function execute(operators: Operators, request: OperatorRequest): Promise<OperatorResult> {
  // The name came over the wire; the contract only says what it should be.
  if (!Object.hasOwn(operators, request.operator)) {
    return { error: `unknown operator: ${request.operator}` }
  }
  const run = operators[request.operator] as (input: unknown) => Promise<unknown>
  try {
    return { output: await run(request.input) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function serveOperators({
  port,
  operators,
  signal,
  onServed,
  retryMs = 1_000,
}: ChannelOptions): Promise<void> {
  const base = `http://${HOST}:${port}`
  while (!signal.aborted) {
    let request: OperatorRequest
    try {
      const response = await fetch(base + NEXT_REQUEST_PATH, { signal })
      if (response.status === 204) continue
      if (!response.ok) {
        await pause(retryMs, signal)
        continue
      }
      request = (await response.json()) as OperatorRequest
    } catch {
      if (signal.aborted) return
      await pause(retryMs, signal)
      continue
    }

    const result = await execute(operators, request)
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
