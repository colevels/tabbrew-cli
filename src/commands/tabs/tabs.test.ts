import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Snapshot } from '../../core/operators'
import { NEXT_REQUEST_PATH, type OperatorRequest, resultPath } from '../../core/session/protocol'

const root = `${import.meta.dir}/../../..`
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000)
const base = `http://127.0.0.1:${port}`
const fromBrowser = { headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors' } }
let stateDir = ''

// The session inherits these from the CLI that spawns it.
const env = () => ({
  ...process.env,
  TABBREW_SESSION_PORTS: String(port),
  TABBREW_SESSION_DIR: stateDir,
  TABBREW_SESSION_CLAIM_WAIT_MS: '300',
  TABBREW_SESSION_LONG_POLL_MS: '500',
})

// Async, unlike the session tests: the fake panel below has to keep serving
// while the CLI runs.
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

const snapshot: Snapshot = {
  takenAt: 1_700_000_000_000,
  windows: [
    { id: 1842, focused: true, incognito: false, state: 'normal' },
    { id: 1843, focused: false, incognito: false, state: 'normal' },
  ],
  groups: [{ id: 7, windowId: 1842, title: 'Work', color: 'blue', collapsed: false }],
  tabs: [
    {
      id: 1901,
      windowId: 1842,
      index: 0,
      url: 'https://mail.google.com/',
      title: 'Inbox',
      pinned: false,
      audible: false,
      muted: false,
      discarded: false,
      active: true,
      status: 'complete',
      groupId: -1,
    },
    {
      id: 1903,
      windowId: 1842,
      index: 1,
      url: 'https://github.com/pull/42',
      title: 'Pull Request #42',
      pinned: false,
      audible: false,
      muted: false,
      discarded: false,
      active: false,
      status: 'complete',
      groupId: 7,
    },
    {
      id: 1950,
      windowId: 1843,
      index: 0,
      url: 'chrome://newtab/',
      title: 'New Tab',
      pinned: false,
      audible: false,
      muted: false,
      discarded: false,
      active: true,
      status: 'complete',
      groupId: -1,
    },
  ],
}

const panel = new AbortController()
const moves: { tabIds: number[]; index: number; windowId?: number }[] = []
const discards: number[] = []

function answer(request: OperatorRequest): unknown {
  if (request.operator === 'readSnapshot') return { output: snapshot }
  if (request.operator === 'discardTab') {
    const { tabId } = request.input as { tabId: number }
    discards.push(tabId)
    if (tabId === 1903) return { error: 'Cannot discard the active tab' }
    // Chrome may hand back a replacement tab under a new id.
    const replaced = tabId === 1952
    return { output: { tabId: replaced ? 2052 : tabId, previousTabId: tabId, changed: replaced } }
  }
  const input = request.input as { tabIds: number[]; index: number; windowId?: number }
  moves.push(input)
  if (input.tabIds.includes(1903)) return { error: 'Tabs cannot be edited right now' }
  return {
    output: {
      tabs: input.tabIds.map((tabId, offset) => ({
        tabId,
        windowId: input.windowId,
        index: input.index + offset,
      })),
    },
  }
}

async function servePanel(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const res = await fetch(base + NEXT_REQUEST_PATH, { ...fromBrowser, signal })
      if (res.status !== 200) continue
      const request = (await res.json()) as OperatorRequest
      await fetch(base + resultPath(request.id), {
        method: 'POST',
        body: JSON.stringify(answer(request)),
        ...fromBrowser,
        signal,
      })
    } catch {
      if (signal.aborted) return
      await Bun.sleep(50)
    }
  }
}

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-tabs-'))
})

afterAll(async () => {
  panel.abort()
  await tabbrew('session', 'stop')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('tabbrew tabs list', () => {
  test('needs a session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no session running')
    expect(stdout).toBe('')
  })

  test('needs the panel', async () => {
    expect((await tabbrew('session', 'start', '--no-open')).exitCode).toBe(0)
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'list', '--json')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tabbrew session open')
    expect(stdout).toBe('')
  })

  test('prints the snapshot as json', async () => {
    void servePanel(panel.signal)
    const { exitCode, stdout } = await tabbrew('tabs', 'list', '--json')
    expect(exitCode).toBe(0)
    const labelled = {
      ...snapshot,
      windows: snapshot.windows.map((window, i) => ({ ...window, label: 'AB'[i] })),
    }
    expect(JSON.parse(stdout)).toEqual(labelled)
  })

  test('prints the table', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'list')
    expect(exitCode).toBe(0)
    const [header, first] = stdout.split('\n')
    expect(header).toMatch(/^TAB\s+WINDOW\s+GROUP\s+FLAGS\s+URL\s+TITLE$/)
    expect(first).toMatch(/^1901\s+A\s+-\s+active\s+mail\.google\.com\s+Inbox$/)
    expect(stdout).toContain('1903  A       7')
  })
})

describe('tabbrew tabs move', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew(
      'tabs',
      'move',
      '1950',
      'x',
      '--after',
      '1901',
    )
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: x')
    expect(stdout).toBe('')
    expect(moves).toEqual([])
  })

  test('needs exactly one anchor flag', async () => {
    const both = await tabbrew('tabs', 'move', '1950', '--after', '1901', '--before', '1903')
    expect(both.exitCode).toBe(1)
    expect(both.stderr).toContain('give exactly one of --after, --before')
    const none = await tabbrew('tabs', 'move', '1950')
    expect(none.exitCode).toBe(1)
    expect(none.stderr).toContain('give exactly one of --after, --before')
    expect(moves).toEqual([])
  })

  test('refuses to move a tab next to itself', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'move', '1901', '--after', '1901')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('a tab cannot be moved next to itself: 1901')
    expect(moves).toEqual([])
  })

  test('moves across windows in one call and prints nothing', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'move', '1950', '--after', '1901')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(moves.splice(0)).toEqual([{ tabIds: [1950], index: 1, windowId: 1842 }])
  })

  test('prints the placements as json', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'move', '1950', '--before', '1901', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([{ tabId: 1950, windowId: 1842, index: 0 }])
    moves.splice(0)
  })

  test('fails on an unknown anchor without moving anything', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'move', '1950', '--after', '4')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('no tab 4; run "tabbrew tabs list"')
    expect(moves).toEqual([])
  })

  test("surfaces Chrome's refusal", async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'move', '1903', '--after', '1901')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('moveTabs failed: Tabs cannot be edited right now')
    moves.splice(0)
  })
})

describe('tabbrew tabs discard', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'discard', '1950', '0')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: 0')
    expect(stdout).toBe('')
    expect(discards).toEqual([])
  })

  test('discards one tab per call, in order, and prints nothing', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'discard', '1950', '1901')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(discards.splice(0)).toEqual([1950, 1901])
  })

  test('prints the results as json, including a replaced id', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'discard', '1950', '1952', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([
      { tabId: 1950, previousTabId: 1950, changed: false },
      { tabId: 2052, previousTabId: 1952, changed: true },
    ])
    discards.splice(0)
  })

  test("stops at Chrome's refusal and leaves the rest untouched", async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'discard', '1903', '1950')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('discardTab failed: Cannot discard the active tab')
    expect(discards.splice(0)).toEqual([1903])
  })
})
