import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveSession } from '../../../sdk/src/index'
import { asExtension } from '../../core/session/as-extension'
import { createServer, type SessionServer } from '../../core/session/server'

const root = `${import.meta.dir}/../../..`
const QUICKNOTES = 'a'.repeat(32)
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000)
let stateDir = ''
let server: SessionServer
let restore = () => {}
const page = new AbortController()
const received: Record<string, unknown>[] = []

async function tabbrew(...args: string[]) {
  const child = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, TABBREW_SESSION_PORTS: String(port), TABBREW_SESSION_DIR: stateDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

const stored = [
  { id: 'n12', tags: ['work', 'idea'], title: 'Plugin commands discovery' },
  { id: 'n09', tags: ['work'], title: 'Release checklist' },
]

// The session and a Chrome extension's page, both in this process; the CLI is
// the only thing spawned.
beforeAll(async () => {
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-plugin-'))
  server = createServer(port, { claimWaitMs: 300 })
  restore = asExtension(QUICKNOTES)
  let connected = false
  void serveSession({
    signal: page.signal,
    ports: [port],
    pollMs: 50,
    onStatus: (status) => {
      connected ||= status.state === 'connected' && status.declared !== undefined
    },
    namespaces: {
      notes: {
        description: 'Notes attached to pages, from QuickNotes',
        commands: {
          list: {
            description: 'List notes',
            options: {
              tag: { type: 'string', repeatable: true, description: 'only notes with this tag' },
              limit: { type: 'number', default: 20 },
              sort: { type: 'string', choices: ['title', 'updated'] },
            },
            view: { rows: 'notes', columns: ['id', 'tags', 'title'], clip: { title: 12 } },
            examples: ['tabbrew plugin notes list --tag work'],
            run: (input) => {
              received.push(input)
              return { notes: stored }
            },
          },
          add: {
            description: 'Add a note',
            arguments: [{ name: 'text', type: 'string', variadic: true }],
            options: { 'tab-id': { type: 'number' }, pinned: { type: 'boolean' } },
            view: { message: 'added note {id}' },
            run: (input) => {
              received.push(input)
              return { id: 'n13' }
            },
          },
          show: {
            description: 'Show one note',
            arguments: [{ name: 'id', type: 'string' }],
            view: { text: 'body' },
            run: () => ({ body: 'first line\nsecond \u001b[31mline' }),
          },
          fail: {
            description: 'Always fails',
            run: () => {
              throw new Error('the store is locked')
            },
          },
        },
      },
    },
  })
  const deadline = Date.now() + 3_000
  while (!connected && Date.now() < deadline) await Bun.sleep(10)
})

afterAll(async () => {
  page.abort()
  restore()
  await server.stop('test teardown')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('tabbrew plugin', () => {
  test('the root help stays as it is with a plugin connected', async () => {
    const { stdout } = await tabbrew('--help')
    expect(stdout).toContain('  plugin:     Commands added by other Chrome extensions')
    expect(stdout).not.toContain('notes')
    expect(stdout).not.toContain('QuickNotes')
  })

  test('its help lists the verbs apart from the plugins', async () => {
    const { stdout, exitCode } = await tabbrew('plugin', '--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('MANAGE\n  list:')
    expect(stdout).toContain('PLUGINS\n  notes:')
    expect(stdout).toContain('Notes attached to pages, from QuickNotes')
    expect(stdout).toContain(`(Chrome extension ${QUICKNOTES})`)
  })

  test('a plugin has help of its own, down to a command', async () => {
    const namespace = await tabbrew('plugin', 'notes', '--help')
    expect(namespace.stdout).toContain('USAGE\n  tabbrew plugin notes <command> [flags]')
    expect(namespace.stdout).toContain('  add:')
    expect(namespace.stdout).toContain('$ tabbrew plugin notes list --tag work')
    expect(namespace.stdout).toContain(`Chrome extension ${QUICKNOTES}`)

    const command = await tabbrew('plugin', 'notes', 'list', '--help')
    expect(command.stdout).toContain('--tag <string>')
    expect(command.stdout).toContain('only notes with this tag')
    expect(command.stdout).toContain('(default: 20)')
    expect(command.stdout).toContain('(one of: title, updated)')
    expect(command.stdout).toContain('--json')
  })

  test('typed options reach the page and a table comes back', async () => {
    received.length = 0
    const { stdout, exitCode } = await tabbrew(
      ...['plugin', 'notes', 'list', '--tag', 'work', '--tag', 'idea', '--limit', '5'],
    )
    expect(exitCode).toBe(0)
    expect(received).toEqual([{ tag: ['work', 'idea'], limit: 5 }])
    expect(stdout).toBe(
      [
        'ID   TAGS        TITLE',
        'n12  work, idea  Plugin comm…',
        'n09  work        Release che…',
        '',
      ].join('\n'),
    )
  })

  test('arguments join the options under their camel-cased names', async () => {
    received.length = 0
    const { stdout } = await tabbrew(
      ...['plugin', 'notes', 'add', 'follow', 'up', '--tab-id', '4211', '--pinned'],
    )
    expect(received).toEqual([{ text: ['follow', 'up'], tabId: 4211, pinned: true }])
    expect(stdout).toBe('added note n13\n')
  })

  test('--json prints what the page returned', async () => {
    const { stdout } = await tabbrew('plugin', 'notes', 'list', '--json')
    expect(JSON.parse(stdout)).toEqual({ notes: stored })
  })

  test('text keeps its lines and loses its escape codes', async () => {
    const { stdout } = await tabbrew('plugin', 'notes', 'show', 'n12')
    expect(stdout).toBe('first line\nsecond  [31mline\n')
  })

  test.each([
    [['--limit', 'many'], 'must be a number'],
    [['--sort', 'size'], 'must be one of: title, updated'],
  ])('%p is refused before anything is called', async (flags, message) => {
    received.length = 0
    const { stderr, exitCode } = await tabbrew('plugin', 'notes', 'list', ...flags)
    expect(exitCode).toBe(1)
    expect(stderr).toContain(message)
    expect(received).toEqual([])
  })

  test('a failure is told in the words of what was run', async () => {
    const { stderr, exitCode } = await tabbrew('plugin', 'notes', 'fail')
    expect(exitCode).toBe(1)
    expect(stderr).toBe('notes fail failed: the store is locked\n')
  })

  test('plugin list shows who serves what', async () => {
    const table = await tabbrew('plugin', 'list')
    expect(table.stdout).toBe(
      [
        'PLUGIN  CHROME EXTENSION                  CONNECTED  COMMANDS',
        `notes   ${QUICKNOTES}  yes        list, add, show, fail`,
        '',
      ].join('\n'),
    )
    const json = await tabbrew('plugin', 'list', '--json')
    expect(JSON.parse(json.stdout)).toMatchObject({
      notes: { extensionId: QUICKNOTES, connected: true },
    })
  })

  test('a plugin nobody declared is named as such', async () => {
    const { stderr, exitCode } = await tabbrew('plugin', 'bookmarks', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toBe('unknown plugin "bookmarks"; run "tabbrew plugin list"\n')
  })

  test('only `tabbrew plugin` reads the registry', async () => {
    let reads = 0
    const watched = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req): Response {
        const { pathname } = new URL(req.url)
        if (pathname === '/commands') reads += 1
        if (pathname !== '/health') return Response.json({ error: 'not_found' }, { status: 404 })
        return Response.json({
          service: 'tabbrew-session',
          version: '0.0.0',
          pid: 1,
          port: watched.port,
          uptimeMs: 0,
          listening: false,
        })
      },
    })
    const run = (...args: string[]) =>
      Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
        cwd: root,
        env: {
          ...process.env,
          TABBREW_SESSION_PORTS: String(watched.port),
          TABBREW_SESSION_DIR: stateDir,
        },
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited
    await run('--help')
    await run('tabs', '--help')
    await run('session', 'status')
    expect(reads).toBe(0)
    await run('plugin', '--help')
    expect(reads).toBe(1)
    await watched.stop(true)
  })
})

test('without a session a plugin command says so', async () => {
  const child = Bun.spawn(['bun', 'run', 'src/index.ts', 'plugin', 'notes', 'list'], {
    cwd: root,
    env: { ...process.env, TABBREW_SESSION_PORTS: '1', TABBREW_SESSION_DIR: tmpdir() },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(await child.exited).toBe(1)
  expect(await new Response(child.stderr).text()).toBe(
    'no session running; run "tabbrew session start"\n',
  )
})
