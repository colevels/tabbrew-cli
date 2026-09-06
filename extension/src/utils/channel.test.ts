import { afterEach, describe, expect, test } from 'bun:test'
import { OPERATOR_NAMES, type Operators } from '../../../src/core/operators/contract'
import {
  createServer,
  type ServerOptions,
  type SessionServer,
} from '../../../src/core/session/server'
import { type ServedEvent, serveOperators } from './channel'

const servers: SessionServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

const up = (options: ServerOptions = {}) => {
  const server = createServer(0, options)
  servers.push(server)
  return server
}

const snapshot = { takenAt: 1, windows: [], groups: [], tabs: [] }

// Every operator refuses, except the one a test needs.
const operators = (): Operators => {
  const refusing = Object.fromEntries(
    OPERATOR_NAMES.map((name) => [
      name,
      async () => {
        throw new Error(`${name} is not for this test`)
      },
    ]),
  )
  return { ...refusing, readSnapshot: async () => snapshot } as unknown as Operators
}

const call = (port: number, name: string, input: unknown = {}) =>
  fetch(`http://127.0.0.1:${port}/operators/${name}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

describe('serveOperators', () => {
  test('answers a call with the operator output', async () => {
    const { port } = up()
    const controller = new AbortController()
    const served: ServedEvent[] = []
    const loop = serveOperators({
      port,
      operators: operators(),
      signal: controller.signal,
      onServed: (event) => served.push(event),
    })
    const res = await call(port, 'readSnapshot')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: snapshot })
    expect(served).toMatchObject([{ operator: 'readSnapshot' }])
    expect(served[0]?.error).toBeUndefined()
    controller.abort()
    await loop
  })

  test('reports an operator that throws', async () => {
    const { port } = up()
    const controller = new AbortController()
    const loop = serveOperators({ port, operators: operators(), signal: controller.signal })
    const res = await call(port, 'closeTabs', { tabIds: [1] })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'operator_failed',
      detail: 'closeTabs is not for this test',
    })
    controller.abort()
    await loop
  })

  test('reports an operator it does not have', async () => {
    const { port } = up()
    const controller = new AbortController()
    const { closeTabs: _closeTabs, ...missing } = operators()
    const loop = serveOperators({
      port,
      operators: missing as unknown as Operators,
      signal: controller.signal,
    })
    const res = await call(port, 'closeTabs', { tabIds: [1] })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'operator_failed',
      detail: 'unknown operator: closeTabs',
    })
    controller.abort()
    await loop
  })

  test('stops promptly when aborted mid-poll', async () => {
    const { port } = up({ longPollMs: 5_000 })
    const controller = new AbortController()
    const loop = serveOperators({ port, operators: operators(), signal: controller.signal })
    await Bun.sleep(30)
    const started = Date.now()
    controller.abort()
    await loop
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('keeps retrying while the session is away and still stops on abort', async () => {
    const server = up()
    const controller = new AbortController()
    const loop = serveOperators({
      port: server.port,
      operators: operators(),
      signal: controller.signal,
      retryMs: 20,
    })
    await Bun.sleep(30)
    await server.stop('away')
    await Bun.sleep(100)
    let settled = false
    void loop.then(() => {
      settled = true
    })
    await Bun.sleep(10)
    expect(settled).toBe(false)
    controller.abort()
    await loop
    expect(settled).toBe(true)
  })
})
