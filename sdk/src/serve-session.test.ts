import { afterEach, describe, expect, test } from 'bun:test'
import { OPERATOR_NAMES, type Operators } from '../../src/core/operators/contract'
import { createServer, type SessionServer } from '../../src/core/session/server'
import { type ServedEvent, type SessionStatus, serveSession } from './serve-session'

const servers: SessionServer[] = []
const controllers: AbortController[] = []

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort()
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

const up = () => {
  const server = createServer(0)
  servers.push(server)
  return server
}

const snapshot = { takenAt: 1, windows: [], groups: [], tabs: [] }

const operators = {
  ...Object.fromEntries(OPERATOR_NAMES.map((name) => [name, async () => ({})])),
  readSnapshot: async () => snapshot,
} as unknown as Operators

const readSnapshot = (port: number) =>
  fetch(`http://127.0.0.1:${port}/operators/readSnapshot`, { method: 'POST', body: '{}' })

const POLL_MS = 20

const serve = (ports: readonly number[]) => {
  const controller = new AbortController()
  controllers.push(controller)
  const statuses: SessionStatus[] = []
  const served: ServedEvent[] = []
  const done = serveSession({
    operators,
    signal: controller.signal,
    ports,
    pollMs: POLL_MS,
    retryMs: POLL_MS,
    onStatus: (status) => statuses.push(status),
    onServed: (event) => served.push(event),
  })
  return { controller, statuses, served, done }
}

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition never held')
    await Bun.sleep(5)
  }
}

describe('serveSession', () => {
  test('finds the session and serves its commands', async () => {
    const { port } = up()
    const { statuses, served } = serve([port])
    const res = await readSnapshot(port)
    expect(await res.json()).toEqual({ output: snapshot })
    expect(served).toMatchObject([{ operator: 'readSnapshot' }])
    expect(statuses[0]).toMatchObject({ state: 'connected', session: { port } })
  })

  test('reports every poll, the ones that find nothing included', async () => {
    const { port } = up()
    await servers.pop()?.stop('never there')
    const { statuses } = serve([port])
    await until(() => statuses.length >= 3)
    expect(statuses.every((status) => status.state === 'searching')).toBe(true)
  })

  test('keeps polling while connected, so the session info stays fresh', async () => {
    const { port } = up()
    const { statuses } = serve([port])
    await until(() => statuses.length >= 3)
    expect(statuses.every((status) => status.state === 'connected')).toBe(true)
  })

  test('reports a session that went away once, then searches again', async () => {
    const server = up()
    const { statuses } = serve([server.port])
    await until(() => statuses.length >= 1)
    await servers.pop()?.stop('gone')
    await until(() => statuses.at(-1)?.state === 'searching')
    const states = statuses.map((status) => status.state)
    expect(states.filter((state) => state === 'lost')).toHaveLength(1)
    expect(states.indexOf('lost')).toBe(states.lastIndexOf('connected') + 1)
  })

  test('follows a session that comes back on another port', async () => {
    const first = up()
    const second = up()
    await servers.pop()?.stop('not yet')
    const { statuses, served } = serve([first.port, second.port])
    await until(() => statuses.length >= 1)
    await servers.pop()?.stop('restarting')
    await until(() => statuses.at(-1)?.state !== 'connected')

    const replacement = createServer(second.port)
    servers.push(replacement)
    await until(() => statuses.at(-1)?.state === 'connected')
    expect(statuses.at(-1)).toMatchObject({ session: { port: second.port } })
    expect((await readSnapshot(second.port)).status).toBe(200)
    expect(served).toHaveLength(1)
  })

  test('settles promptly when aborted, and stops serving', async () => {
    const { port } = up()
    const { controller, statuses, done } = serve([port])
    await until(() => statuses.length >= 1)
    const before = Date.now()
    controller.abort()
    await done
    expect(Date.now() - before).toBeLessThan(500)
    const seen = statuses.length
    await Bun.sleep(POLL_MS * 3)
    expect(statuses).toHaveLength(seen)
  })
})
