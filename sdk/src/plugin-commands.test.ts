import { afterEach, describe, expect, test } from 'bun:test'
import { OPERATOR_NAMES, type Operators } from '../../src/core/operators/contract'
import { asExtension } from '../../src/core/session/as-extension'
import { commandPath } from '../../src/core/session/protocol'
import { createServer, type SessionServer } from '../../src/core/session/server'
import type { NamespaceDefinition } from './channel'
import {
  type ServedCommandEvent,
  type ServedEvent,
  type ServeSessionOptions,
  type SessionStatus,
  serveSession,
} from './serve-session'

const QUICKNOTES = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

const servers: SessionServer[] = []
const controllers: AbortController[] = []
const restores: (() => void)[] = []

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort()
  for (const restore of restores.splice(0)) restore()
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

const up = (port = 0) => {
  const server = createServer(port, { claimWaitMs: 200 })
  servers.push(server)
  return server
}

const page = (extensionId: string) => restores.push(asExtension(extensionId))

const snapshot = { takenAt: 1, windows: [], groups: [], tabs: [] }
const operators = {
  ...Object.fromEntries(OPERATOR_NAMES.map((name) => [name, async () => ({})])),
  readSnapshot: async () => snapshot,
} as unknown as Operators

const notes: Record<string, NamespaceDefinition> = {
  notes: {
    description: 'Notes',
    commands: {
      add: {
        description: 'Add a note',
        arguments: [{ name: 'text', type: 'string' }],
        run: ({ text }) => ({ id: 'n1', text }),
      },
      fail: {
        description: 'Always fails',
        run: () => {
          throw new Error('the store is locked')
        },
      },
    },
  },
}

const POLL_MS = 20

const serve = (port: number, options: Partial<ServeSessionOptions>) => {
  const controller = new AbortController()
  controllers.push(controller)
  const statuses: SessionStatus[] = []
  const served: ServedEvent[] = []
  const commands: ServedCommandEvent[] = []
  void serveSession({
    signal: controller.signal,
    ports: [port],
    pollMs: POLL_MS,
    retryMs: POLL_MS,
    onStatus: (status) => statuses.push(status),
    onServed: (event) => served.push(event),
    onCommandServed: (event) => commands.push(event),
    ...options,
  })
  return { statuses, served, commands }
}

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition never held')
    await Bun.sleep(5)
  }
}
const declared = (statuses: SessionStatus[]) => {
  const last = statuses.at(-1)
  return last?.state === 'connected' ? last.declared : undefined
}

const call = (port: number, namespace: string, command: string, input: unknown = {}) =>
  fetch(`http://127.0.0.1:${port}${commandPath(namespace, command)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
const readSnapshot = (port: number) =>
  fetch(`http://127.0.0.1:${port}/operators/readSnapshot`, { method: 'POST', body: '{}' })

describe('plugin commands', () => {
  test('one page serves the operators and its own commands', async () => {
    const { port } = up()
    page(QUICKNOTES)
    const { statuses, served, commands } = serve(port, { operators, namespaces: notes })
    await until(() => declared(statuses) !== undefined)
    expect(declared(statuses)).toMatchObject({ accepted: ['notes'], rejected: {}, dropped: [] })

    expect(await (await call(port, 'notes', 'add', { text: 'hello' })).json()).toEqual({
      output: { id: 'n1', text: 'hello' },
    })
    expect(await (await readSnapshot(port)).json()).toEqual({ output: snapshot })
    expect(commands).toMatchObject([{ namespace: 'notes', command: 'add' }])
    expect(served).toMatchObject([{ operator: 'readSnapshot' }])
  })

  test('what a command throws comes back as its failure', async () => {
    const { port } = up()
    page(QUICKNOTES)
    const { statuses, commands } = serve(port, { namespaces: notes })
    await until(() => declared(statuses) !== undefined)
    const res = await call(port, 'notes', 'fail')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'operator_failed', detail: 'the store is locked' })
    expect(commands).toMatchObject([{ command: 'fail', error: 'the store is locked' }])
  })

  test('declares the page and never its handlers', async () => {
    const { port } = up()
    page(QUICKNOTES)
    const { statuses } = serve(port, { namespaces: notes, page: 'cli.html' })
    await until(() => declared(statuses) !== undefined)
    const registry = await (await fetch(`http://127.0.0.1:${port}/commands`)).json()
    expect(registry).toMatchObject({
      notes: { extensionId: QUICKNOTES, page: 'cli.html', connected: true },
    })
    expect(JSON.stringify(registry)).not.toContain('run')
  })

  test('a page that only adds commands leaves the operators alone', async () => {
    const { port } = up()
    page(QUICKNOTES)
    const { statuses } = serve(port, { namespaces: notes })
    await until(() => declared(statuses) !== undefined)
    const res = await readSnapshot(port)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no_panel' })
  })

  test('a namespace another extension holds is reported and the rest is served', async () => {
    const { port } = up()
    page(OTHER)
    const first = serve(port, { namespaces: notes })
    await until(() => declared(first.statuses) !== undefined)
    restores.pop()?.()

    page(QUICKNOTES)
    const { statuses } = serve(port, { operators, namespaces: notes })
    await until(() => declared(statuses) !== undefined)
    expect(declared(statuses)).toMatchObject({
      accepted: [],
      rejected: { notes: 'namespace_taken' },
    })
    expect((await readSnapshot(port)).status).toBe(200)
  })

  test('with nothing left to serve the page is rejected, and stops asking', async () => {
    const { port } = up()
    page(OTHER)
    const first = serve(port, { namespaces: notes })
    await until(() => declared(first.statuses) !== undefined)
    restores.pop()?.()

    page(QUICKNOTES)
    const { statuses } = serve(port, { namespaces: notes })
    await until(() => statuses.at(-1)?.state === 'rejected')
    expect(statuses.at(-1)).toMatchObject({ reason: 'namespace_taken', session: { port } })
  })

  test('declares again to a session restarted on the same port', async () => {
    const server = up()
    page(QUICKNOTES)
    const { statuses } = serve(server.port, { namespaces: notes })
    await until(() => declared(statuses) !== undefined)
    const before = declared(statuses)?.owner

    await servers.pop()?.stop('restarting')
    up(server.port)
    await until(() => {
      const owner = declared(statuses)?.owner
      return owner !== undefined && owner !== before
    })
    expect((await call(server.port, 'notes', 'add', { text: 'again' })).status).toBe(200)
  })

  test('needs something to serve', async () => {
    await expect(serveSession({ signal: new AbortController().signal })).rejects.toThrow(TypeError)
  })
})

// What @tabbrew/sdk 0.9.12 talks to: operators for whoever polls, and nothing
// at /commands.
describe('against a session that predates plugins', () => {
  const squatters: ReturnType<typeof Bun.serve>[] = []
  afterEach(async () => {
    await Promise.all(squatters.splice(0).map((s) => s.stop(true)))
  })

  const old = () => {
    let polls = 0
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req): Response {
        const { pathname } = new URL(req.url)
        if (pathname === '/health') {
          return Response.json({
            service: 'tabbrew-session',
            version: '0.9.12',
            pid: 1,
            port: server.port,
            uptimeMs: 0,
            listening: false,
          })
        }
        if (pathname === '/requests/next') {
          polls += 1
          return new Response(null, { status: 204 })
        }
        return Response.json({ error: 'not_found' }, { status: 404 })
      },
    })
    squatters.push(server)
    return { port: server.port ?? 0, polls: () => polls }
  }

  test('a page with operators serves them as it always did', async () => {
    const session = old()
    const { statuses } = serve(session.port, { operators, namespaces: notes })
    await until(() => session.polls() > 0)
    expect(statuses.at(-1)).toMatchObject({ state: 'connected' })
    expect(declared(statuses)).toBeUndefined()
  })

  test('a page with only commands never polls', async () => {
    const session = old()
    const { statuses } = serve(session.port, { namespaces: notes })
    await until(() => statuses.at(-1)?.state === 'rejected')
    expect(statuses.at(-1)).toMatchObject({ reason: 'unsupported_session' })
    await Bun.sleep(POLL_MS * 3)
    expect(session.polls()).toBe(0)
  })
})
