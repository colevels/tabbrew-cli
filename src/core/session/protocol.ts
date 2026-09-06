// Everything a client needs to recognise a session and talk to it, in a form
// that runs in the browser as well as in Bun: no node imports, no env, no process.

import type { OperatorName } from '../operators/contract'

export const SERVICE = 'tabbrew-session'
export const HOST = '127.0.0.1'

// extension/wxt.config.ts turns these into the manifest's
// optional_host_permissions, so Chrome cannot reach a session anywhere else.
export const DEFAULT_PORTS: readonly number[] = [49227, 49228]

export interface SessionInfo {
  port: number
  pid: number
  version: string
  uptimeMs: number
}

export async function probe(port: number, timeoutMs: number): Promise<SessionInfo | null> {
  try {
    const res = await fetch(`http://${HOST}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    // Something else answering on our port is not our session.
    if (body?.service !== SERVICE) return null
    return {
      port,
      pid: Number(body.pid),
      version: String(body.version ?? ''),
      uptimeMs: Number(body.uptimeMs ?? 0),
    }
  } catch {
    return null
  }
}

// In preference order, never in parallel: with two sessions up "the default
// one" is a stable answer where "whichever replied first" is not.
export async function discover(
  ports: readonly number[],
  timeoutMs: number,
): Promise<SessionInfo | null> {
  for (const port of ports) {
    const found = await probe(port, timeoutMs)
    if (found) return found
  }
  return null
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// The command channel: a local process posts an operator call, the open panel
// claims it by long-polling, runs it against Chrome and posts the result.
// Two path prefixes because the two sides are policed differently: only a
// local process may call an operator, while any panel may serve requests.
export interface OperatorRequest {
  id: string
  operator: OperatorName
  input: unknown
}

export type OperatorResult = { output: unknown } | { error: string }

export const OPERATOR_FAILURE_CODES = [
  'bad_request',
  'forbidden',
  'unknown_operator',
  'unknown_request',
  'no_panel',
  'timeout',
  'operator_failed',
  'stopping',
] as const

export type OperatorFailureCode = (typeof OPERATOR_FAILURE_CODES)[number]

export interface OperatorFailure {
  error: OperatorFailureCode
  detail?: string
}

export const NEXT_REQUEST_PATH = '/requests/next'
export const operatorPath = (name: OperatorName): string => `/operators/${name}`
export const resultPath = (id: string): string => `/requests/${id}/result`

const OPERATOR_PATH = /^\/operators\/([A-Za-z]+)$/
const RESULT_PATH = /^\/requests\/([0-9a-f-]+)\/result$/

export const matchOperatorPath = (pathname: string): string | null =>
  OPERATOR_PATH.exec(pathname)?.[1] ?? null
export const matchResultPath = (pathname: string): string | null =>
  RESULT_PATH.exec(pathname)?.[1] ?? null
