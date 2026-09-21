import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveSession } from '../../../sdk/src/index'
import type { Registry } from '../../core/commands/declaration'
import { mergeKnownPlugins, readKnownPlugins } from '../../core/plugins/cache'
import { asExtension } from '../../core/session/as-extension'
import { createServer, type SessionServer } from '../../core/session/server'

const root = `${import.meta.dir}/../../..`
const QUICKNOTES = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

let stateDir = ''
let port = 0
const servers: SessionServer[] = []
const cleanups: (() => void)[] = []

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-known-'))
  // A port nothing else on the machine (or a real session) is likely to hold.
  port = 50_000 + Math.floor(Math.random() * 10_000)
  // Stands in for Chrome: records the page it was asked to open.
  writeFileSync(join(stateDir, 'chrome.sh'), '#!/bin/sh\necho "$1" > "$(dirname "$0")/opened"\n')
  chmodSync(join(stateDir, 'chrome.sh'), 0o755)
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await Promise.all(servers.splice(0).map((server) => server.stop('test teardown')))
  rmSync(stateDir, { recursive: true, force: true })
})

async function tabbrew(...args: string[]) {
  const child = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    cwd: root,
    env: {
      ...process.env,
      TABBREW_SESSION_PORTS: String(port),
      TABBREW_SESSION_DIR: stateDir,
      TABBREW_SESSION_CONNECT_WAIT_MS: '2000',
      TABBREW_CHROME: join(stateDir, 'chrome.sh'),
    },
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

const notes = (extensionId: string, page?: string): Registry => ({
  notes: {
    extensionId,
    page,
    description: 'Notes attached to pages',
    connected: false,
    commands: { list: { description: 'List notes', view: { message: '{count} notes' } } },
  },
})
const remember = (registry: Registry) => mergeKnownPlugins(registry, Date.now(), stateDir)

const session = () => {
  const server = createServer(port, { claimWaitMs: 200 })
  servers.push(server)
  return server
}

// The QuickNotes page, opened the moment "Chrome" is asked for it.
const pageOnceOpened = () => {
  const controller = new AbortController()
  const restore = asExtension(QUICKNOTES)
  cleanups.push(() => controller.abort(), restore)
  const watch = setInterval(() => {
    if (!existsSync(join(stateDir, 'opened'))) return
    clearInterval(watch)
    void serveSession({
      signal: controller.signal,
      ports: [port],
      pollMs: 50,
      page: 'cli.html',
      namespaces: {
        notes: {
          description: 'Notes attached to pages',
          commands: {
            list: {
              description: 'List notes',
              view: { message: '{count} notes' },
              run: () => ({ count: 2 }),
            },
          },
        },
      },
    })
  }, 20)
  cleanups.push(() => clearInterval(watch))
}

describe('a plugin seen in an earlier session', () => {
  test('is still a command without a session, and says what is missing', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    const help = await tabbrew('plugin', '--help')
    expect(help.stdout).toContain('notes:')
    expect(help.stdout).toContain('Notes attached to pages (not connected)')

    const { stderr, exitCode } = await tabbrew('plugin', 'notes', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toBe('no session running; run "tabbrew session start"\n')
  })

  test('is listed as not connected', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    expect((await tabbrew('plugin', 'list')).stdout).toBe(
      [
        'PLUGIN  CHROME EXTENSION                  CONNECTED  COMMANDS',
        `notes   ${QUICKNOTES}  no         list`,
        '',
      ].join('\n'),
    )
  })

  test('has its page opened by the CLI, which then calls it', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    session()
    pageOnceOpened()
    const { stdout, stderr, exitCode } = await tabbrew('plugin', 'notes', 'list')
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('2 notes\n')
    expect(readFileSync(join(stateDir, 'opened'), 'utf8')).toBe(
      `chrome-extension://${QUICKNOTES}/cli.html\n`,
    )
  })

  test('plugin open opens the page and waits for it', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    session()
    pageOnceOpened()
    const { stdout, stderr, exitCode } = await tabbrew('plugin', 'open', 'notes')
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: '', stderr: '', exitCode: 0 })
    expect(existsSync(join(stateDir, 'opened'))).toBe(true)
  })

  test('says which extension to look for when its page never connects', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    session()
    const { stderr, exitCode } = await tabbrew('plugin', 'notes', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toBe(
      `the "notes" plugin did not connect; is Chrome extension ${QUICKNOTES} installed and enabled in the Chrome profile you use?\n`,
    )
  })

  test('that declared no page is left for the user to open', async () => {
    remember(notes(QUICKNOTES))
    session()
    const { stderr, exitCode } = await tabbrew('plugin', 'notes', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('open its Chrome extension')
    expect(existsSync(join(stateDir, 'opened'))).toBe(false)
  })

  test('is called out when another extension serves its name now', async () => {
    remember(notes(OTHER, 'cli.html'))
    remember(notes(QUICKNOTES, 'cli.html'))
    session()
    pageOnceOpened()
    const { stdout, stderr } = await tabbrew('plugin', 'notes', 'list')
    expect(stdout).toBe('2 notes\n')
    expect(stderr).toBe(
      `note: "notes" is now served by Chrome extension ${QUICKNOTES}, not ${OTHER} as before; "tabbrew plugin forget notes" accepts that\n`,
    )
  })

  test('can be forgotten', async () => {
    remember(notes(QUICKNOTES, 'cli.html'))
    expect(await tabbrew('plugin', 'forget', 'notes')).toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })
    expect((await tabbrew('plugin', 'list')).stdout).toBe('')
    const again = await tabbrew('plugin', 'forget', 'notes')
    expect(again.exitCode).toBe(1)
    expect(again.stderr).toBe('unknown plugin "notes"; run "tabbrew plugin list"\n')
  })
})

test('a running session remembers what was declared to it', async () => {
  expect((await tabbrew('session', 'start', '--no-open')).exitCode).toBe(0)
  try {
    const declared = await fetch(`http://127.0.0.1:${port}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        commandsVersion: 1,
        page: 'cli.html',
        namespaces: {
          notes: { description: 'Notes', commands: { list: { description: 'List' } } },
        },
      }),
      headers: { origin: `chrome-extension://${QUICKNOTES}`, 'sec-fetch-site': 'none' },
    })
    expect(declared.status).toBe(200)
    expect(readKnownPlugins(Date.now(), stateDir).notes).toMatchObject({
      extensionId: QUICKNOTES,
      page: 'cli.html',
    })
  } finally {
    await tabbrew('session', 'stop')
  }
})
