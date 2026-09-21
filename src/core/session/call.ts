import { parseRegistry, type Registry } from '../commands/declaration'
import type { OperatorInput, OperatorName, OperatorOutput } from '../operators/contract'
import { cell } from '../table'
import {
  CLAIM_WAIT_MS,
  HOST,
  OPERATOR_CALL_TIMEOUT_MS,
  OPERATOR_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
} from './config'
import { discover } from './lifecycle'
import {
  COMMANDS_PATH,
  commandPath,
  OPERATOR_FAILURE_CODES,
  type OperatorFailureCode,
  operatorPath,
  type SessionInfo,
} from './protocol'

export type OperatorCallCode = OperatorFailureCode | 'unreachable' | 'unsupported'

export class OperatorCallError extends Error {
  constructor(
    readonly code: OperatorCallCode,
    message: string,
  ) {
    super(message)
    this.name = 'OperatorCallError'
  }
}

const isFailureCode = (value: string): value is OperatorFailureCode =>
  (OPERATOR_FAILURE_CODES as readonly string[]).includes(value)

const UPGRADE = 'run "tabbrew session stop" then "start"'

// What a failure is told in: the user's words for what they ran.
interface Call {
  path: string
  name: string
  // The namespace, when a plugin serves the call and not the extension.
  plugin?: string
  timeoutMs: number
  abortMs: number
}

function explain(
  { name, plugin, timeoutMs }: Call,
  session: SessionInfo,
  status: number,
  body: Record<string, unknown> | null,
): OperatorCallError {
  const error = typeof body?.error === 'string' ? body.error : ''
  // Whatever an extension threw.
  const detail = typeof body?.detail === 'string' ? cell(body.detail) : ''
  switch (error) {
    case 'no_panel':
      return new OperatorCallError(
        error,
        plugin
          ? `the "${plugin}" plugin is not connected; open its Chrome extension's page and retry`
          : 'nothing is connected to the session; run "tabbrew session open" and retry',
      )
    case 'timeout':
      return new OperatorCallError(
        error,
        detail === 'busy'
          ? 'the connected page is still busy with an earlier command; retry in a moment'
          : `the connected page did not answer within ${Math.round(timeoutMs / 1000)}s`,
      )
    case 'unknown_operator':
      return new OperatorCallError(
        error,
        plugin
          ? `the "${plugin}" plugin no longer has this command; see "tabbrew plugin ${plugin} --help"`
          : detail
            ? `the connected extension does not support ${name}; update it and retry`
            : `${name} rejected: ${error}`,
      )
    case 'operator_failed':
      return new OperatorCallError(error, `${name} failed: ${detail}`)
    case 'stopping':
      return new OperatorCallError(error, 'the session is stopping; run "tabbrew session start"')
    // A session started by an older binary has no operator routes at all.
    case 'not_found':
      return new OperatorCallError(
        'unsupported',
        `this session predates ${plugin ? 'plugins' : 'tabbrew tabs'}; ${UPGRADE}`,
      )
    default:
      return isFailureCode(error)
        ? new OperatorCallError(error, `${name} rejected: ${error}${detail ? ` (${detail})` : ''}`)
        : new OperatorCallError(
            'unsupported',
            `session on ${HOST}:${session.port} answered HTTP ${status} to ${name}; ${UPGRADE}`,
          )
  }
}

async function post(session: SessionInfo, call: Call, input: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`http://${HOST}:${session.port}${call.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(call.abortMs),
    })
  } catch {
    throw new OperatorCallError(
      'unreachable',
      `session on ${HOST}:${session.port} did not answer; run "tabbrew session status"`,
    )
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok && body && 'output' in body) return body.output
  throw explain(call, session, response.status, body)
}

export const callOperator = <N extends OperatorName>(
  session: SessionInfo,
  name: N,
  input: OperatorInput<N>,
): Promise<OperatorOutput<N>> =>
  post(
    session,
    {
      path: operatorPath(name),
      name,
      timeoutMs: OPERATOR_TIMEOUT_MS,
      abortMs: OPERATOR_CALL_TIMEOUT_MS,
    },
    input,
  ) as Promise<OperatorOutput<N>>

export const callCommand = (
  session: SessionInfo,
  namespace: string,
  command: string,
  input: Record<string, unknown>,
  timeoutMs = OPERATOR_TIMEOUT_MS,
): Promise<unknown> =>
  post(
    session,
    {
      path: commandPath(namespace, command),
      name: `${namespace} ${command}`,
      plugin: namespace,
      timeoutMs,
      // As long as the session may hold the call, and then some for the answer.
      abortMs: CLAIM_WAIT_MS + OPERATOR_TIMEOUT_MS + timeoutMs + 5_000,
    },
    input,
  )

// Every way of not getting an answer (an older session, a dead one) reads as
// "no plugins".
export async function readCommands(session: SessionInfo): Promise<Registry> {
  try {
    const response = await fetch(`http://${HOST}:${session.port}${COMMANDS_PATH}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return response.ok ? parseRegistry(await response.json()) : {}
  } catch {
    return {}
  }
}

// Every operator-backed command shares the same failure surface: no session,
// or a call that the session or panel rejected. Both end with exit code 1.
export async function withSession(work: (session: SessionInfo) => Promise<void>): Promise<void> {
  const session = await discover()
  if (!session) {
    console.error('no session running; run "tabbrew session start"')
    process.exitCode = 1
    return
  }
  try {
    await work(session)
  } catch (error) {
    console.error(error instanceof OperatorCallError ? error.message : String(error))
    process.exitCode = 1
  }
}
