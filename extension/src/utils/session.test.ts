import { afterEach, describe, expect, test } from 'bun:test'
import { VERSION } from '../../../src/core/session/config'
import { createServer, type SessionServer } from '../../../src/core/session/server'
import { discover, probe } from './session'

const sessions: SessionServer[] = []
const squatters: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.stop('test teardown')))
  await Promise.all(squatters.splice(0).map((s) => s.stop(true)))
})

const session = (): SessionServer => {
  const server = createServer(0)
  sessions.push(server)
  return server
}

// Some other local JSON service that happens to hold one of our ports.
const squatter = (): number => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ ok: true }),
  })
  squatters.push(server)
  if (server.port === undefined) throw new Error('squatter did not bind')
  return server.port
}

describe('extension session client', () => {
  test('probe identifies a tabbrew session', async () => {
    const server = session()
    expect(await probe(server.port)).toMatchObject({
      port: server.port,
      pid: process.pid,
      version: VERSION,
    })
  })

  test('probe does not adopt a foreign service on our port', async () => {
    expect(await probe(squatter())).toBeNull()
  })

  test('probe on a closed port is null', async () => {
    const server = session()
    const { port } = server
    await server.stop('closed on purpose')
    expect(await probe(port)).toBeNull()
  })

  test('discover walks ports in order and skips squatters', async () => {
    const taken = squatter()
    const server = session()
    expect((await discover([taken, server.port]))?.port).toBe(server.port)
    expect(await discover([taken])).toBeNull()
  })
})
