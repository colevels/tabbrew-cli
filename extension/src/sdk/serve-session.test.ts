import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Registry } from '../../../src/core/commands/declaration'
import {
  createServer,
  type ServerOptions,
  type SessionServer,
} from '../../../src/core/session/server'
import { asExtension } from '../../../test/as-extension'
import { type Command, type SessionStatus, serveSession } from './serve-session'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

const servers: SessionServer[] = []
let restore = () => {}
beforeEach(() => {
  restore = asExtension(EXTENSION_ID)
})
afterEach(async () => {
  restore()
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

const up = (port = 0, options: ServerOptions = {}) => {
  const server = createServer(port, { longPollMs: 300, claimWaitMs: 300, ...options })
  servers.push(server)
  return server
}

const commands: Record<string, Command> = {
  list: {
    description: 'List bookmarks',
    options: { folder: { type: 'string' } },
    view: { rows: 'bookmarks', columns: ['id', 'title'] },
    run: async ({ folder }: { folder?: string }) => ({
      bookmarks: [{ id: 1, title: folder ?? 'all' }],
    }),
  },
  fail: {
    description: 'Always fails',
    run: async () => {
      throw new Error('bookmarks are locked')
    },
  },
}

const call = (port: number, path: string, input: unknown = {}) =>
  fetch(`http://127.0.0.1:${port}/operators/${path}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

const registry = async (port: number): Promise<Registry> =>
  (await (await fetch(`http://127.0.0.1:${port}/commands`)).json()) as Registry

const until = async (check: () => boolean | Promise<boolean>): Promise<void> => {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error('never happened')
}

function serve(ports: number[], extra: Partial<Parameters<typeof serveSession>[0]> = {}) {
  const controller = new AbortController()
  const statuses: SessionStatus[] = []
  const loop = serveSession({
    namespace: 'bookmarks',
    description: 'Manage bookmarks',
    commands,
    ports,
    signal: controller.signal,
    retryMs: 20,
    onStatus: (status) => statuses.push(status),
    ...extra,
  })
  const stop = async () => {
    controller.abort()
    await loop
  }
  return { loop, statuses, stop }
}

describe('serveSession', () => {
  test('declares its commands without their handlers, then answers calls', async () => {
    const { port } = up()
    const serving = serve([port])
    await until(async () => (await registry(port)).bookmarks?.connected === true)

    expect((await registry(port)).bookmarks).toEqual({
      extensionId: EXTENSION_ID,
      description: 'Manage bookmarks',
      connected: true,
      commands: {
        list: {
          description: 'List bookmarks',
          options: { folder: { type: 'string' } },
          view: { rows: 'bookmarks', columns: ['id', 'title'] },
        },
        fail: { description: 'Always fails' },
      },
    })

    const res = await call(port, 'bookmarks/list', { folder: 'work' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: { bookmarks: [{ id: 1, title: 'work' }] } })
    expect(serving.statuses.at(-1)).toMatchObject({ state: 'connected', session: { port } })
    await serving.stop()
  })

  test('a handler that throws reaches the caller as operator_failed', async () => {
    const { port } = up()
    const serving = serve([port])
    await until(async () => (await registry(port)).bookmarks?.connected === true)
    const res = await call(port, 'bookmarks/fail')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'operator_failed', detail: 'bookmarks are locked' })
    await serving.stop()
  })

  test('a refusal ends the loop with its reason', async () => {
    const { port } = up()
    const serving = serve([port], { namespace: 'tabs' })
    await serving.loop
    expect(serving.statuses.at(-1)).toEqual({ state: 'rejected', reason: 'namespace_taken' })
  })

  test('declares again to a session restarted on the same port', async () => {
    const first = up()
    const { port } = first
    const serving = serve([port])
    await until(async () => (await registry(port)).bookmarks?.connected === true)

    await first.stop('restart')
    up(port)
    await until(async () => (await registry(port)).bookmarks?.connected === true)
    expect((await call(port, 'bookmarks/list')).status).toBe(200)
    await serving.stop()
  })

  test('keeps looking while no session is up, and settles on abort', async () => {
    const { port } = up()
    await servers[0]?.stop('gone')
    const serving = serve([port])
    await Bun.sleep(80)
    expect(serving.statuses.every((status) => status.state === 'searching')).toBe(true)
    const started = Date.now()
    await serving.stop()
    expect(Date.now() - started).toBeLessThan(500)
  })
})
