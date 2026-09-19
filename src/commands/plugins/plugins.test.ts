import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Command, serveSession } from '../../../extension/src/sdk'
import { asExtension } from '../../../test/as-extension'

const root = `${import.meta.dir}/../../..`
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000)
let stateDir = ''
let restore = () => {}
const page = new AbortController()

const env = () => ({
  ...process.env,
  TABBREW_SESSION_PORTS: String(port),
  TABBREW_SESSION_DIR: stateDir,
  TABBREW_SESSION_CLAIM_WAIT_MS: '300',
  TABBREW_SESSION_LONG_POLL_MS: '500',
})

async function tabbrew(...args: string[]) {
  const child = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    cwd: root,
    env: env(),
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

const received: unknown[] = []

const commands: Record<string, Command> = {
  list: {
    description: 'List bookmarks',
    options: {
      folder: { type: 'string', description: 'only this folder' },
      limit: { type: 'number', default: 50 },
      tag: { type: 'string', repeatable: true },
      'dry-run': { type: 'boolean' },
    },
    view: { rows: 'bookmarks', columns: ['id', 'folder', 'title'] },
    run: async (input: { folder?: string }) => {
      received.push(input)
      return { bookmarks: [{ id: 12, folder: input.folder ?? '-', title: 'tabbrew-cli' }] }
    },
  },
  add: {
    description: 'Bookmark tabs',
    arguments: [{ name: 'tab', type: 'number', description: 'tab ids', variadic: true }],
    view: { message: 'bookmarked {count} tabs' },
    run: async ({ tab }: { tab: number[] }) => {
      if (tab.includes(4242)) throw new Error('No tab with id: 4242')
      return { count: tab.length }
    },
  },
}

const connected = async (): Promise<boolean> => {
  const { stdout } = await tabbrew('plugins', 'list', '--json')
  return stdout.includes('"connected":true')
}

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-plugins-'))
  restore = asExtension(EXTENSION_ID)
})

afterAll(async () => {
  page.abort()
  restore()
  await tabbrew('session', 'stop')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('plugin commands', () => {
  test('without a session there are none, and help says nothing of them', async () => {
    const help = await tabbrew('--help')
    expect(help.stdout).not.toContain('PLUGIN COMMANDS')
    const { exitCode, stderr } = await tabbrew('bookmarks', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain("unknown command 'bookmarks'")
  })

  test('a connected plugin shows up in help and in plugins list', async () => {
    expect((await tabbrew('session', 'start', '--no-open')).exitCode).toBe(0)
    void serveSession({
      namespace: 'bookmarks',
      description: 'Manage Chrome bookmarks',
      commands,
      ports: [port],
      signal: page.signal,
      retryMs: 50,
    })
    for (let tries = 0; tries < 50 && !(await connected()); tries++) await Bun.sleep(50)

    const root = await tabbrew('--help')
    expect(root.stdout).toContain('PLUGIN COMMANDS\n  bookmarks:')
    expect(root.stdout).toContain('Manage Chrome bookmarks')

    const noun = await tabbrew('bookmarks', '--help')
    expect(noun.stdout).toContain('USAGE\n  tabbrew bookmarks <command> [flags]')
    expect(noun.stdout).toMatch(/list:\s+List bookmarks/)
    expect(noun.stdout).toContain(`Chrome extension ${EXTENSION_ID}`)

    const verb = await tabbrew('bookmarks', 'list', '--help')
    expect(verb.stdout).toMatch(/--folder <string>\s+only this folder/)
    expect(verb.stdout).toContain('--json')

    const listed = await tabbrew('plugins', 'list')
    expect(listed.stdout).toMatch(
      new RegExp(`^bookmarks\\s+${EXTENSION_ID}\\s+yes\\s+list, add$`, 'm'),
    )
  })

  test('options reach the handler typed, and the view renders the answer', async () => {
    const { exitCode, stdout, stderr } = await tabbrew(
      'bookmarks',
      'list',
      '--folder',
      'work',
      '--limit',
      '5',
      '--tag',
      'a',
      '--tag',
      'b',
      '--dry-run',
    )
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('ID  FOLDER  TITLE\n12  work    tabbrew-cli\n')
    expect(received.at(-1)).toEqual({ folder: 'work', limit: 5, tag: ['a', 'b'], dryRun: true })
  })

  test('defaults apply and --json prints the raw output', async () => {
    const { exitCode, stdout } = await tabbrew('bookmarks', 'list', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      bookmarks: [{ id: 12, folder: '-', title: 'tabbrew-cli' }],
    })
    expect(received.at(-1)).toEqual({ limit: 50 })
  })

  test('variadic arguments arrive as a typed list and a message view answers', async () => {
    const { exitCode, stdout } = await tabbrew('bookmarks', 'add', '7', '8')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('bookmarked 2 tabs\n')
  })

  test('a value of the wrong type is refused before anything is called', async () => {
    const before = received.length
    const { exitCode, stderr } = await tabbrew('bookmarks', 'list', '--limit', 'many')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('must be a number')
    expect(received.length).toBe(before)
  })

  test('a failing handler is reported in the words the user typed', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('bookmarks', 'add', '4242')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('bookmarks add failed: No tab with id: 4242')
  })

  test('once the page is gone the namespace stays, marked and explained', async () => {
    page.abort()
    for (let tries = 0; tries < 50 && (await connected()); tries++) await Bun.sleep(50)
    const help = await tabbrew('--help')
    expect(help.stdout).toContain('Manage Chrome bookmarks (not connected)')
    const { exitCode, stderr } = await tabbrew('bookmarks', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('the "bookmarks" plugin is not connected')
  })
})
