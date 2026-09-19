import type { Registry } from '../commands/declaration'
import type { OperatorInput, OperatorName, OperatorOutput } from '../operators/contract'
import { cell } from '../table'
import { HOST, OPERATOR_CALL_TIMEOUT_MS, OPERATOR_TIMEOUT_MS, PROBE_TIMEOUT_MS } from './config'
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

function explain(
  name: string,
  session: SessionInfo,
  status: number,
  body: Record<string, unknown> | null,
  namespace?: string,
): OperatorCallError {
  const error = typeof body?.error === 'string' ? body.error : ''
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  switch (error) {
    case 'no_panel':
      return new OperatorCallError(
        error,
        namespace
          ? `the "${namespace}" plugin is not connected; open its Chrome extension's page and retry`
          : 'nothing is connected to the session; run "tabbrew session open" and retry',
      )
    case 'timeout':
      return new OperatorCallError(
        error,
        `the connected page did not answer within ${Math.round(OPERATOR_TIMEOUT_MS / 1000)}s`,
      )
    case 'operator_failed':
      // The detail is whatever an extension threw.
      return new OperatorCallError(error, `${name} failed: ${cell(detail)}`)
    case 'stopping':
      return new OperatorCallError(error, 'the session is stopping; run "tabbrew session start"')
    // A session started by an older binary has no operator routes at all.
    case 'not_found':
      return new OperatorCallError('unsupported', `this session predates tabbrew tabs; ${UPGRADE}`)
    default:
      return isFailureCode(error)
        ? new OperatorCallError(error, `${name} rejected: ${error}${detail ? ` (${detail})` : ''}`)
        : new OperatorCallError(
            'unsupported',
            `session on ${HOST}:${session.port} answered HTTP ${status} to ${name}; ${UPGRADE}`,
          )
  }
}

// `name` is what the user typed, so a failure reads in their words: an
// operator name, or "namespace command".
async function post(
  session: SessionInfo,
  path: string,
  name: string,
  input: unknown,
  namespace?: string,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`http://${HOST}:${session.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(OPERATOR_CALL_TIMEOUT_MS),
    })
  } catch {
    throw new OperatorCallError(
      'unreachable',
      `session on ${HOST}:${session.port} did not answer; run "tabbrew session status"`,
    )
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok && body && 'output' in body) return body.output
  throw explain(name, session, response.status, body, namespace)
}

export const callOperator = async <N extends OperatorName>(
  session: SessionInfo,
  name: N,
  input: OperatorInput<N>,
): Promise<OperatorOutput<N>> =>
  (await post(session, operatorPath(name), name, input)) as OperatorOutput<N>

export const callCommand = (
  session: SessionInfo,
  namespace: string,
  command: string,
  input: unknown,
): Promise<unknown> =>
  post(session, commandPath(namespace, command), `${namespace} ${command}`, input, namespace)

// Help is built from this, so every way of not getting an answer (an older
// session, a dead one) reads as "no plugin commands".
export async function readCommands(session: SessionInfo): Promise<Registry> {
  try {
    const response = await fetch(`http://${HOST}:${session.port}${COMMANDS_PATH}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const body: unknown = response.ok ? await response.json() : null
    return typeof body === 'object' && body !== null ? (body as Registry) : {}
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
