import { afterEach, describe, expect, test } from 'bun:test'
import { fromBrowser } from './as-extension'
import { callOperator, OperatorCallError } from './call'
import { VERSION } from './config'
import type { OperatorRequest, SessionInfo } from './protocol'
import { createServer, type ServerOptions, type SessionServer } from './server'

const servers: SessionServer[] = []
const squatters: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
  await Promise.all(squatters.splice(0).map((s) => s.stop(true)))
})

const up = (options: ServerOptions = {}) => {
  const server = createServer(0, options)
  servers.push(server)
  return server
}
const info = (port: number): SessionInfo => ({
  port,
  pid: process.pid,
  version: VERSION,
  uptimeMs: 0,
  listening: true,
})

const claim = async (port: number): Promise<OperatorRequest> => {
  const res = await fetch(`http://127.0.0.1:${port}/requests/next`, fromBrowser)
  return (await res.json()) as OperatorRequest
}

// One request served the way the panel would.
async function panel(port: number, result: unknown): Promise<OperatorRequest> {
  const request = await claim(port)
  await fetch(`http://127.0.0.1:${port}/requests/${request.id}/result`, {
    method: 'POST',
    body: JSON.stringify(result),
    ...fromBrowser,
  })
  return request
}

const failure = async (promise: Promise<unknown>): Promise<OperatorCallError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof OperatorCallError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('callOperator', () => {
  test('resolves with what the panel returned', async () => {
    const { port } = up()
    const snapshot = { takenAt: 1, windows: [], groups: [], tabs: [] }
    const served = panel(port, { output: snapshot })
    expect(await callOperator(info(port), 'readSnapshot', {})).toEqual(snapshot)
    expect(await served).toMatchObject({ operator: 'readSnapshot', input: {} })
  })

  test('says to open the connection page when nobody is listening', async () => {
    const { port } = up({ claimWaitMs: 50 })
    const error = await failure(callOperator(info(port), 'readSnapshot', {}))
    expect(error.code).toBe('no_panel')
    expect(error.message).toContain('tabbrew session open')
  })

  test('carries the panel error with the operator name', async () => {
    const { port } = up()
    void panel(port, { error: 'tab 9 not found' })
    const error = await failure(callOperator(info(port), 'focusTab', { tabId: 9 }))
    expect(error.code).toBe('operator_failed')
    expect(error.message).toBe('focusTab failed: tab 9 not found')
  })

  test('times out when the panel claims but never answers', async () => {
    const { port } = up({ operatorTimeoutMs: 100 })
    void claim(port)
    const error = await failure(callOperator(info(port), 'readSnapshot', {}))
    expect(error.code).toBe('timeout')
    expect(error.message).toContain('did not answer')
  })

  test('says busy, not absent, behind a page still working', async () => {
    const { port } = up({ claimWaitMs: 40, operatorTimeoutMs: 400 })
    const waiting = callOperator(info(port), 'readSnapshot', {}).catch(() => undefined)
    await claim(port)
    const error = await failure(callOperator(info(port), 'focusTab', { tabId: 9 }))
    expect(error.code).toBe('timeout')
    expect(error.message).toContain('still busy')
    await waiting
  })

  test('names an operator the connected extension does not serve', async () => {
    const { port } = up({ longPollMs: 300 })
    const declared = await fetch(`http://127.0.0.1:${port}/commands`, {
      method: 'POST',
      body: JSON.stringify({ commandsVersion: 1, operators: ['readSnapshot'] }),
      headers: { origin: `chrome-extension://${'a'.repeat(32)}`, 'sec-fetch-site': 'none' },
    })
    const { owner } = (await declared.json()) as { owner: string }
    const held = fetch(`http://127.0.0.1:${port}/requests/next?owner=${owner}`, fromBrowser)
    await Bun.sleep(30)
    const error = await failure(callOperator(info(port), 'reloadTab', { tabId: 9 }))
    expect(error.code).toBe('unknown_operator')
    expect(error.message).toBe(
      'the connected extension does not support reloadTab; update it and retry',
    )
    await held
  })

  test('reports a session that is gone as unreachable', async () => {
    const server = up()
    await server.stop('gone')
    const error = await failure(callOperator(info(server.port), 'readSnapshot', {}))
    expect(error.code).toBe('unreachable')
    expect(error.message).toContain('tabbrew session status')
  })

  test('recognises a session too old to have operator routes', async () => {
    const squatter = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => Response.json({ error: 'not_found' }, { status: 404 }),
    })
    squatters.push(squatter)
    const error = await failure(callOperator(info(squatter.port ?? 0), 'readSnapshot', {}))
    expect(error.code).toBe('unsupported')
    expect(error.message).toContain('predates')
  })
})
