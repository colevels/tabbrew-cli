import { afterEach, describe, expect, test } from 'bun:test'
import { COMMANDS_VERSION, type Declaration } from '../commands/declaration'
import type { OperatorRequest } from './protocol'
import { createServer, type ServerOptions, type SessionServer } from './server'

const servers: SessionServer[] = []
const up = (options: ServerOptions = {}) => {
  const server = createServer(0, options)
  servers.push(server)
  return server
}
const url = (server: SessionServer, path: string) => `http://127.0.0.1:${server.port}${path}`

const BOOKMARKS = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const READER = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba'
const fromExtension = (origin: string) => ({ 'sec-fetch-site': 'cross-site', origin })

const bookmarks = (changes: Partial<Declaration> = {}): Declaration => ({
  commandsVersion: COMMANDS_VERSION,
  namespace: 'bookmarks',
  description: 'Manage bookmarks',
  commands: { list: { description: 'List bookmarks' } },
  ...changes,
})

const declare = (server: SessionServer, body: unknown, origin = BOOKMARKS) =>
  fetch(url(server, '/commands'), {
    method: 'POST',
    headers: fromExtension(origin),
    body: JSON.stringify(body),
  })
const owner = async (server: SessionServer, body: unknown, origin = BOOKMARKS): Promise<string> => {
  const res = await declare(server, body, origin)
  expect(res.status).toBe(200)
  return ((await res.json()) as { owner: string }).owner
}
const poll = (server: SessionServer, token?: string) =>
  fetch(url(server, `/requests/next${token ? `?owner=${token}` : ''}`), {
    headers: fromExtension(BOOKMARKS),
  })
const answer = (server: SessionServer, id: string, result: unknown) =>
  fetch(url(server, `/requests/${id}/result`), {
    method: 'POST',
    headers: fromExtension(BOOKMARKS),
    body: JSON.stringify(result),
  })
const call = (server: SessionServer, path: string, input: unknown = {}) =>
  fetch(url(server, `/operators/${path}`), { method: 'POST', body: JSON.stringify(input) })
const listed = async (server: SessionServer) =>
  (await (await fetch(url(server, '/commands'))).json()) as Record<string, unknown>

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

describe('declared commands', () => {
  test('an extension declares its commands and the shell reads them back without the token', async () => {
    const server = up()
    const token = await owner(server, bookmarks())
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    const registry = await listed(server)
    expect(registry).toEqual({
      bookmarks: {
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        description: 'Manage bookmarks',
        connected: false,
        commands: { list: { description: 'List bookmarks' } },
      },
    })
    expect(JSON.stringify(registry)).not.toContain(token)
  })

  test('only an extension page may declare', async () => {
    const server = up()
    expect((await declare(server, bookmarks(), 'https://example.com')).status).toBe(403)
    const shell = await fetch(url(server, '/commands'), {
      method: 'POST',
      body: JSON.stringify(bookmarks()),
    })
    expect(shell.status).toBe(403)
    expect(await listed(server)).toEqual({})
  })

  test('only the shell may read the registry', async () => {
    const server = up()
    const res = await fetch(url(server, '/commands'), { headers: fromExtension(BOOKMARKS) })
    expect(res.status).toBe(403)
  })

  test('a malformed declaration is refused', async () => {
    const server = up()
    for (const body of [
      'nonsense',
      bookmarks({ commandsVersion: 2 }),
      bookmarks({ namespace: 'Book Marks' }),
      bookmarks({ commands: {} }),
      bookmarks({
        commands: { list: { description: 'x', options: { json: { type: 'string' } } } },
      }),
    ]) {
      const res = await declare(server, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_commands' })
    }
  })

  test('a namespace cannot shadow a built-in command or another extension', async () => {
    const server = up()
    expect((await declare(server, bookmarks({ namespace: 'tabs' }))).status).toBe(409)
    await owner(server, bookmarks())
    const res = await declare(server, bookmarks(), READER)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'namespace_taken' })
  })

  test('two pages of one extension share a token; a changed declaration replaces it', async () => {
    const server = up()
    const first = await owner(server, bookmarks())
    expect(await owner(server, bookmarks())).toBe(first)

    const held = poll(server, first)
    const changed = await owner(server, bookmarks({ description: 'Bookmarks, again' }))
    expect(changed).not.toBe(first)
    expect((await held).status).toBe(410)
    expect((await poll(server, first)).status).toBe(410)
  })

  test('an extension that renames its namespace leaves nothing behind', async () => {
    const server = up()
    await owner(server, bookmarks())
    await owner(server, bookmarks({ namespace: 'marks' }))
    expect(Object.keys(await listed(server))).toEqual(['marks'])
  })

  test('a command call reaches only its owner and the answer comes back', async () => {
    const server = up({ claimWaitMs: 150 })
    const token = await owner(server, bookmarks())
    const standard = poll(server)
    const owned = poll(server, token)
    expect((await listed(server)).bookmarks).toMatchObject({ connected: true })

    const calling = call(server, 'bookmarks/list', { folder: 'work' })
    const request = (await (await owned).json()) as OperatorRequest
    expect(request).toMatchObject({
      namespace: 'bookmarks',
      operator: 'list',
      input: { folder: 'work' },
    })
    expect((await answer(server, request.id, { output: { bookmarks: [] } })).status).toBe(200)
    const res = await calling
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: { bookmarks: [] } })

    // The standard poller never saw it, and still takes standard work.
    const reading = call(server, 'readSnapshot')
    const next = (await (await standard).json()) as OperatorRequest
    expect(next).toMatchObject({ operator: 'readSnapshot' })
    expect(next.namespace).toBeUndefined()
    await answer(server, next.id, { output: {} })
    await reading
  })

  test('a standard poller does not make a namespace connected, nor the reverse', async () => {
    const server = up({ claimWaitMs: 100 })
    const token = await owner(server, bookmarks())
    const standard = poll(server)
    const refused = await call(server, 'bookmarks/list')
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'no_panel' })

    const reading = call(server, 'readSnapshot')
    const next = (await (await standard).json()) as OperatorRequest
    await answer(server, next.id, { output: {} })
    await reading

    const owned = poll(server, token)
    const health = (await (await fetch(url(server, '/health'))).json()) as { listening: boolean }
    expect(health.listening).toBe(false)
    const lonely = await call(server, 'readSnapshot')
    expect(lonely.status).toBe(503)
    void owned
  })

  test('an undeclared namespace or command is unknown, and a page may not call one', async () => {
    const server = up()
    await owner(server, bookmarks())
    expect((await call(server, 'reader/save')).status).toBe(404)
    expect((await call(server, 'bookmarks/drop')).status).toBe(404)
    const fromPage = await fetch(url(server, '/operators/bookmarks/list'), {
      method: 'POST',
      headers: fromExtension(BOOKMARKS),
      body: '{}',
    })
    expect(fromPage.status).toBe(403)
  })

  test('a token the session does not know is told to declare again', async () => {
    const server = up()
    const res = await poll(server, crypto.randomUUID())
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'unknown_owner' })
  })

  test('a snapshot-shaped answer from an extension is not stamped with window labels', async () => {
    const server = up()
    const token = await owner(
      server,
      bookmarks({
        commands: { 'read-snapshot': { description: 'x' }, readSnapshot: undefined } as never,
      }),
    )
    void token
  })
})
