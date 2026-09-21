import { afterEach, describe, expect, test } from 'bun:test'
import type { DeclareResponse, Registry } from '../commands/declaration'
import { asExtension, fromBrowser } from './as-extension'
import {
  COMMANDS_PATH,
  type CommandRequest,
  commandPath,
  NEXT_REQUEST_PATH,
  OWNER_PARAMETER,
  type SessionRequest,
} from './protocol'
import { createServer, type ServerOptions, type SessionServer } from './server'

const QUICKNOTES = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

const servers: SessionServer[] = []
const up = (options: ServerOptions = {}) => {
  const server = createServer(0, options)
  servers.push(server)
  return server
}
const url = (server: SessionServer, path: string) => `http://127.0.0.1:${server.port}${path}`

const notes = (commands: Record<string, unknown> = { list: { description: 'List notes' } }) => ({
  notes: { description: 'Notes', commands },
})

const post = (server: SessionServer, extensionId: string, body: string) =>
  fetch(url(server, COMMANDS_PATH), {
    method: 'POST',
    body,
    headers: { origin: `chrome-extension://${extensionId}`, 'sec-fetch-site': 'none' },
  })
const declare = async (
  server: SessionServer,
  extensionId: string,
  declaration: Record<string, unknown>,
): Promise<DeclareResponse> => {
  const res = await post(
    server,
    extensionId,
    JSON.stringify({ commandsVersion: 1, ...declaration }),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as DeclareResponse
}
const readRegistry = async (server: SessionServer): Promise<Registry> =>
  (await (await fetch(url(server, COMMANDS_PATH))).json()) as Registry

const callCommand = (server: SessionServer, namespace: string, command: string, input = {}) =>
  fetch(url(server, commandPath(namespace, command)), {
    method: 'POST',
    body: JSON.stringify(input),
  })
const callOperator = (server: SessionServer, name: string) =>
  fetch(url(server, `/operators/${name}`), { method: 'POST', body: '{}' })
const poll = (server: SessionServer, owner?: string) =>
  fetch(
    url(server, owner ? `${NEXT_REQUEST_PATH}?${OWNER_PARAMETER}=${owner}` : NEXT_REQUEST_PATH),
    fromBrowser,
  )
const delivered = async (response: Promise<Response>): Promise<SessionRequest> => {
  const res = await response
  expect(res.status).toBe(200)
  return (await res.json()) as SessionRequest
}
const answer = (server: SessionServer, id: string, result: unknown) =>
  fetch(url(server, `/requests/${id}/result`), {
    method: 'POST',
    body: JSON.stringify(result),
    ...fromBrowser,
  })
const listening = async (server: SessionServer): Promise<unknown> =>
  ((await (await fetch(url(server, '/health'))).json()) as Record<string, unknown>).listening

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

describe('declaring', () => {
  test('a declaration is read back by the shell, without its token', async () => {
    const server = up()
    const declared = await declare(server, QUICKNOTES, { page: 'cli.html', namespaces: notes() })
    expect(declared).toMatchObject({
      commandsVersion: 1,
      accepted: ['notes'],
      rejected: {},
      dropped: [],
    })
    expect(declared.owner).toMatch(/^[0-9a-f-]{36}$/)

    const res = await fetch(url(server, COMMANDS_PATH))
    const body = await res.text()
    expect(body).not.toContain(declared.owner)
    expect(JSON.parse(body)).toEqual({
      notes: {
        extensionId: QUICKNOTES,
        page: 'cli.html',
        description: 'Notes',
        connected: false,
        commands: { list: { description: 'List notes' } },
      },
    })
  })

  test.each([
    ['no origin', {}],
    ['a web origin', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    [
      'something shaped almost like an extension',
      { origin: `chrome-extension://${'z'.repeat(32)}` },
    ],
  ])('only an extension declares: %s is forbidden', async (_, headers) => {
    const server = up()
    const res = await fetch(url(server, COMMANDS_PATH), {
      method: 'POST',
      body: JSON.stringify({ commandsVersion: 1, namespaces: notes() }),
      headers,
    })
    expect(res.status).toBe(403)
    expect(await readRegistry(server)).toEqual({})
  })

  test('only the shell reads the registry', async () => {
    const server = up()
    const res = await fetch(url(server, COMMANDS_PATH), fromBrowser)
    expect(res.status).toBe(403)
  })

  test.each([
    ['not json', '{'],
    ['no version', JSON.stringify({ namespaces: {} })],
    ['too large', JSON.stringify({ commandsVersion: 1, padding: 'x'.repeat(300 * 1024) })],
  ])('a declaration that is %s is refused whole', async (_, body) => {
    const res = await post(up(), QUICKNOTES, body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_commands' })
  })

  test('what is wrong in a declaration is reported and the rest stands', async () => {
    const server = up()
    const declared = await declare(server, QUICKNOTES, {
      namespaces: {
        ...notes({ list: { description: 'List notes' }, add: { description: 7 } }),
        list: { description: 'Shadows a verb', commands: { all: { description: 'All' } } },
        Broken: { description: 'Broken', commands: {} },
      },
    })
    expect(declared.accepted).toEqual(['notes'])
    expect(declared.rejected).toEqual({ list: 'reserved', Broken: 'bad_commands' })
    expect(declared.dropped).toEqual(['notes.add'])
    expect(Object.keys(await readRegistry(server))).toEqual(['notes'])
  })

  test('two pages declaring the same thing share a token', async () => {
    const server = up()
    const panel = await declare(server, QUICKNOTES, { namespaces: notes() })
    const page = await declare(server, QUICKNOTES, { namespaces: notes() })
    expect(page.owner).toBe(panel.owner)
  })

  test('two pages declaring different things both keep theirs', async () => {
    const server = up({ longPollMs: 100 })
    const panel = await declare(server, QUICKNOTES, { namespaces: notes() })
    const options = await declare(server, QUICKNOTES, {
      namespaces: {
        settings: { description: 'Settings', commands: { show: { description: 'Show' } } },
      },
    })
    expect(options.owner).not.toBe(panel.owner)
    expect((await poll(server, panel.owner)).status).toBe(204)
    expect((await poll(server, options.owner)).status).toBe(204)
    expect(Object.keys(await readRegistry(server))).toEqual(['notes', 'settings'])
  })

  test('a namespace stays with the extension that declared it first', async () => {
    const server = up()
    await declare(server, QUICKNOTES, { namespaces: notes() })
    const late = await declare(server, OTHER, {
      namespaces: {
        ...notes(),
        bookmarks: { description: 'Bookmarks', commands: { list: { description: 'List' } } },
      },
    })
    expect(late.accepted).toEqual(['bookmarks'])
    expect(late.rejected).toEqual({ notes: 'namespace_taken' })
    const registry = await readRegistry(server)
    expect(registry.notes?.extensionId).toBe(QUICKNOTES)
    expect(registry.bookmarks?.extensionId).toBe(OTHER)
  })

  test('a registry change is announced once', async () => {
    const changes: Registry[] = []
    const server = up({ onRegistryChange: (registry) => changes.push(registry) })
    await declare(server, QUICKNOTES, { operators: ['readSnapshot'] })
    expect(changes).toHaveLength(0)
    await declare(server, QUICKNOTES, { namespaces: notes() })
    await declare(server, QUICKNOTES, { namespaces: notes() })
    expect(changes).toHaveLength(1)
    await declare(server, QUICKNOTES, { namespaces: notes({ add: { description: 'Add' } }) })
    expect(changes).toHaveLength(2)
    expect(Object.keys(changes[1]?.notes?.commands ?? {})).toEqual(['add'])
  })

  test('a token this session never issued is told to declare again', async () => {
    const before = up()
    const { owner } = await declare(before, QUICKNOTES, { namespaces: notes() })
    const restarted = up()
    const res = await poll(restarted, owner)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'unknown_owner' })
  })

  test('asExtension makes a page of this process', async () => {
    const server = up()
    const restore = asExtension(QUICKNOTES)
    try {
      const res = await fetch(url(server, COMMANDS_PATH), {
        method: 'POST',
        body: JSON.stringify({ commandsVersion: 1, namespaces: notes() }),
      })
      expect(res.status).toBe(200)
      expect((await readRegistry(server)).notes?.extensionId).toBe(QUICKNOTES)
    } finally {
      restore()
    }
    expect((await fetch(url(server, COMMANDS_PATH), { method: 'POST', body: '{}' })).status).toBe(
      403,
    )
  })
})

describe('calling a command', () => {
  test('a command reaches the page that declared it and nobody else', async () => {
    const server = up({ longPollMs: 400 })
    const { owner } = await declare(server, QUICKNOTES, { namespaces: notes() })
    const store = poll(server)
    const page = poll(server, owner)
    await Bun.sleep(30)
    expect((await readRegistry(server)).notes?.connected).toBe(true)

    const calling = callCommand(server, 'notes', 'list', { tag: ['work'] })
    const request = (await delivered(page)) as CommandRequest
    expect(request).toMatchObject({ namespace: 'notes', command: 'list', input: { tag: ['work'] } })
    await answer(server, request.id, { output: { notes: [] } })
    expect(await (await calling).json()).toEqual({ output: { notes: [] } })
    expect((await store).status).toBe(204)
  })

  test('a page that never declared is never handed a command', async () => {
    const server = up({ claimWaitMs: 60, longPollMs: 300 })
    await declare(server, QUICKNOTES, { namespaces: notes() })
    const store = poll(server)
    await Bun.sleep(30)
    const res = await callCommand(server, 'notes', 'list')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no_panel' })
    expect((await store).status).toBe(204)
  })

  test('one page serves its operators and its commands, oldest first', async () => {
    const server = up({ claimWaitMs: 500 })
    const { owner } = await declare(server, QUICKNOTES, {
      operators: ['readSnapshot'],
      namespaces: notes(),
    })
    const first = callCommand(server, 'notes', 'list')
    await Bun.sleep(20)
    const second = callOperator(server, 'readSnapshot')
    await Bun.sleep(20)

    const command = await delivered(poll(server, owner))
    expect(command).toMatchObject({ namespace: 'notes', command: 'list' })
    await answer(server, command.id, { output: 1 })
    const operator = await delivered(poll(server, owner))
    expect(operator).toMatchObject({ operator: 'readSnapshot' })
    await answer(server, operator.id, { output: { windows: [] } })
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
  })

  test('listening means a page that serves operators is here', async () => {
    const server = up({ longPollMs: 200 })
    const plugin = await declare(server, QUICKNOTES, { namespaces: notes() })
    const held = poll(server, plugin.owner)
    await Bun.sleep(30)
    expect(await listening(server)).toBe(false)
    await held

    const base = await declare(server, OTHER, { operators: ['readSnapshot'] })
    const serving = poll(server, base.owner)
    await Bun.sleep(30)
    expect(await listening(server)).toBe(true)
    await serving
    expect(await listening(server)).toBe(false)
  })

  test('an operator no connected page serves fails at once', async () => {
    const server = up({ longPollMs: 300 })
    const { owner } = await declare(server, QUICKNOTES, { operators: ['readSnapshot'] })
    const held = poll(server, owner)
    await Bun.sleep(30)
    const started = Date.now()
    const res = await callOperator(server, 'reloadTab')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'unknown_operator',
      detail: 'not served by the connected extension',
    })
    expect(Date.now() - started).toBeLessThan(200)
    await held
  })

  test('a page that never declared may serve any operator', async () => {
    const server = up({ longPollMs: 300 })
    const { owner } = await declare(server, QUICKNOTES, { operators: ['readSnapshot'] })
    const declared = poll(server, owner)
    const store = poll(server)
    await Bun.sleep(30)
    const calling = callOperator(server, 'reloadTab')
    const request = await delivered(store)
    expect(request).toMatchObject({ operator: 'reloadTab' })
    await answer(server, request.id, { output: {} })
    expect((await calling).status).toBe(200)
    expect((await declared).status).toBe(204)
  })

  test('a call behind a page still busy past the grace is told so', async () => {
    const server = up({ claimWaitMs: 40, operatorTimeoutMs: 80, longPollMs: 300 })
    const { owner } = await declare(server, QUICKNOTES, {
      operators: ['readSnapshot'],
      namespaces: notes({ sync: { description: 'Sync', timeoutMs: 1_000 } }),
    })
    const page = poll(server, owner)
    await Bun.sleep(20)
    const slow = callCommand(server, 'notes', 'sync')
    const claimed = await delivered(page)

    const res = await callOperator(server, 'readSnapshot')
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout', detail: 'busy' })

    await answer(server, claimed.id, { output: 'synced' })
    expect(await (await slow).json()).toEqual({ output: 'synced' })
  })

  test('a command runs under the timeout it declared', async () => {
    const server = up({ operatorTimeoutMs: 60, longPollMs: 300 })
    const { owner } = await declare(server, QUICKNOTES, {
      namespaces: notes({
        sync: { description: 'Sync', timeoutMs: 1_000 },
        list: { description: 'List' },
      }),
    })
    const slow = callCommand(server, 'notes', 'sync')
    const request = await delivered(poll(server, owner))
    await Bun.sleep(200)
    await answer(server, request.id, { output: 'synced' })
    expect(await (await slow).json()).toEqual({ output: 'synced' })

    const quick = callCommand(server, 'notes', 'list')
    await delivered(poll(server, owner))
    const res = await quick
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout' })
  })

  test('a namespace outlives its page, for its holder only', async () => {
    const server = up({ claimWaitMs: 40, longPollMs: 60 })
    const { owner } = await declare(server, QUICKNOTES, { namespaces: notes() })
    await poll(server, owner)
    expect((await readRegistry(server)).notes?.connected).toBe(false)

    const late = await declare(server, OTHER, { namespaces: notes() })
    expect(late.rejected).toEqual({ notes: 'namespace_taken' })
    const impostor = poll(server, late.owner)
    await Bun.sleep(20)
    const res = await callCommand(server, 'notes', 'list')
    expect(res.status).toBe(503)
    expect((await impostor).status).toBe(204)
  })

  test.each([
    ['an unknown namespace', 'bookmarks', 'list'],
    ['an unknown command', 'notes', 'delete'],
    ['a name every object has', 'notes', 'constructor'],
  ])('%s is not found', async (_, namespace, command) => {
    const server = up()
    await declare(server, QUICKNOTES, { namespaces: notes() })
    const res = await callCommand(server, namespace, command)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown_operator' })
  })

  test('a page cannot call a command', async () => {
    const server = up()
    await declare(server, QUICKNOTES, { namespaces: notes() })
    const res = await fetch(url(server, commandPath('notes', 'list')), {
      method: 'POST',
      body: '{}',
      ...fromBrowser,
    })
    expect(res.status).toBe(403)
  })

  test('a snapshot-shaped answer from a plugin is not given window labels', async () => {
    const server = up({ longPollMs: 300 })
    const { owner } = await declare(server, QUICKNOTES, {
      namespaces: notes({ 'read-snapshot': { description: 'Looks like the operator' } }),
    })
    const calling = callCommand(server, 'notes', 'read-snapshot')
    const request = await delivered(poll(server, owner))
    const output = { windows: [{ windowId: 7, tabs: [] }], groups: [] }
    await answer(server, request.id, { output })
    expect(await (await calling).json()).toEqual({ output })
  })
})
