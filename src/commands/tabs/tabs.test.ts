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
const reloads: { tabId: number; bypassCache?: boolean }[] = []
const closes: number[][] = []
const groupings: { tabIds: number[]; groupId?: number; windowId?: number }[] = []
const groupUpdates: { groupId: number; title?: string; color?: string; collapsed?: boolean }[] = []
const creations: { url?: string; windowId?: number; index?: number }[] = []
const focuses: number[] = []

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
  if (request.operator === 'reloadTab') {
    const input = request.input as { tabId: number; bypassCache?: boolean }
    reloads.push(input)
    if (input.tabId === 4242) return { error: 'No tab with id: 4242' }
    return { output: { tabId: input.tabId } }
  }
  if (request.operator === 'closeTabs') {
    const { tabIds } = request.input as { tabIds: number[] }
    closes.push(tabIds)
    if (tabIds.includes(1903)) return { error: 'Tabs cannot be edited right now' }
    return { output: { tabIds } }
  }
  if (request.operator === 'groupTabs') {
    const input = request.input as { tabIds: number[]; groupId?: number; windowId?: number }
    groupings.push(input)
    if (input.tabIds.includes(1903)) return { error: 'Tabs cannot be edited right now' }
    return { output: { groupId: input.groupId ?? 9001 } }
  }
  if (request.operator === 'updateGroup') {
    const input = request.input as {
      groupId: number
      title?: string
      color?: string
      collapsed?: boolean
    }
    groupUpdates.push(input)
    return { output: input }
  }
  if (request.operator === 'createTab') {
    const input = request.input as { url?: string; windowId?: number; index?: number }
    creations.push(input)
    if (input.url === 'https://bad.example/') return { error: 'Cannot open that URL' }
    return {
      output: {
        tabId: 2100,
        windowId: input.windowId ?? 1842,
        index: input.index ?? 9,
        url: input.url ?? 'chrome://newtab/',
      },
    }
  }
  if (request.operator === 'focusTab') {
    const { tabId } = request.input as { tabId: number }
    focuses.push(tabId)
    const tab = snapshot.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return { error: `tab ${tabId} not found` }
    return { output: { tabId, windowId: tab.windowId } }
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

describe('tabbrew tabs reload', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'reload', '1950', '0')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: 0')
    expect(stdout).toBe('')
    expect(reloads).toEqual([])
  })

  test('reloads one tab per call, in order, and prints nothing', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'reload', '1950', '1901')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(reloads.splice(0)).toEqual([
      { tabId: 1950, bypassCache: false },
      { tabId: 1901, bypassCache: false },
    ])
  })

  test('sends --hard as bypassCache and prints the results as json', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'reload', '1950', '--hard', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([{ tabId: 1950 }])
    expect(reloads.splice(0)).toEqual([{ tabId: 1950, bypassCache: true }])
  })

  test("stops at Chrome's refusal and leaves the rest untouched", async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'reload', '4242', '1950')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('reloadTab failed: No tab with id: 4242')
    expect(reloads.splice(0)).toEqual([{ tabId: 4242, bypassCache: false }])
  })
})

describe('tabbrew tabs close', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'close', '1950', '0')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: 0')
    expect(stdout).toBe('')
    expect(closes).toEqual([])
  })

  test('rejects an id the snapshot does not have, closing nothing', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'close', '1950', '9999')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no tab 9999; run "tabbrew tabs list"')
    expect(stdout).toBe('')
    expect(closes).toEqual([])
  })

  test('closes every id in one call and prints nothing', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'close', '1950', '1901', '1950')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(closes.splice(0)).toEqual([[1950, 1901]])
  })

  test('prints the closed ids as json', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'close', '1901', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([1901])
    closes.splice(0)
  })

  test("surfaces Chrome's refusal", async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'close', '1903', '1950')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('closeTabs failed: Tabs cannot be edited right now')
    expect(closes.splice(0)).toEqual([[1903, 1950]])
  })
})

describe('tabbrew tabs group', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'group', '1950', 'x')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: x')
    expect(stdout).toBe('')
    expect(groupings).toEqual([])
  })

  test('rejects --to and --window together', async () => {
    const { exitCode, stderr } = await tabbrew(
      'tabs',
      'group',
      '1950',
      '--to',
      '7',
      '--window',
      '1842',
    )
    expect(exitCode).toBe(1)
    expect(stderr).toContain('give at most one of --to, --window')
    expect(groupings).toEqual([])
  })

  test('rejects an invalid color before touching the session', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'group', '1950', '--color', 'plaid')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('color must be one of')
    expect(groupings).toEqual([])
  })

  test('rejects --collapse and --expand together', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'group', '1950', '--collapse', '--expand')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('give at most one of --collapse, --expand')
    expect(groupings).toEqual([])
  })

  test('fails on an unknown --to group without grouping anything', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('tabs', 'group', '1950', '--to', '99')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('no group 99; run "tabbrew groups list"')
    expect(groupings).toEqual([])
  })

  test('fails on an unknown --window without grouping anything', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'group', '1950', '--window', '9999')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no window 9999; run "tabbrew windows list"')
    expect(groupings).toEqual([])
  })

  test('defaults to the first tab window when neither flag is given', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'group', '1950', '1901', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ groupId: 9001 })
    expect(groupings.splice(0)).toEqual([{ tabIds: [1950, 1901], windowId: 1843 }])
  })

  test('joins an existing group via --to', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'group', '1950', '--to', '7', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ groupId: 7 })
    expect(groupings.splice(0)).toEqual([{ tabIds: [1950], groupId: 7 }])
  })

  test('creates a group in a window via --window', async () => {
    const { exitCode, stdout } = await tabbrew(
      'tabs',
      'group',
      '1950',
      '--window',
      '1843',
      '--json',
    )
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ groupId: 9001 })
    expect(groupings.splice(0)).toEqual([{ tabIds: [1950], windowId: 1843 }])
  })

  test('applies --title and --color via a follow-up updateGroup call', async () => {
    const { exitCode, stdout } = await tabbrew(
      'tabs',
      'group',
      '1950',
      '--to',
      '7',
      '--title',
      'Foo',
      '--color',
      'blue',
      '--json',
    )
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ groupId: 7, title: 'Foo', color: 'blue' })
    groupings.splice(0)
    expect(groupUpdates.splice(0)).toEqual([{ groupId: 7, title: 'Foo', color: 'blue' }])
  })

  test('applies --collapse via a follow-up updateGroup call', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'group', '1950', '--to', '7', '--collapse')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    groupings.splice(0)
    expect(groupUpdates.splice(0)).toEqual([{ groupId: 7, collapsed: true }])
  })

  test('applies --expand via a follow-up updateGroup call', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'group', '1950', '--to', '7', '--expand')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    groupings.splice(0)
    expect(groupUpdates.splice(0)).toEqual([{ groupId: 7, collapsed: false }])
  })

  test("surfaces Chrome's refusal", async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'group', '1903', '--to', '7')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('groupTabs failed: Tabs cannot be edited right now')
    groupings.splice(0)
  })
})

describe('tabbrew tabs create', () => {
  test('opens a new tab page when given no url', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'create')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('created tab 2100 in window A at index 9')
    expect(creations.splice(0)).toEqual([{}])
  })

  test('prints the created tab as json', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'create', 'https://a.example/', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      tabId: 2100,
      windowId: 1842,
      index: 9,
      url: 'https://a.example/',
    })
    expect(creations.splice(0)).toEqual([{ url: 'https://a.example/' }])
  })

  test('makes a bare host absolute', async () => {
    expect((await tabbrew('tabs', 'create', 'example.com')).exitCode).toBe(0)
    expect(creations.splice(0)).toEqual([{ url: 'https://example.com' }])
  })

  test('places the tab after an anchor, in the anchor window', async () => {
    const { exitCode, stdout } = await tabbrew(
      'tabs',
      'create',
      'https://a.example/',
      '--after',
      '1901',
    )
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('created tab 2100 in window A at index 1')
    expect(creations.splice(0)).toEqual([{ url: 'https://a.example/', windowId: 1842, index: 1 }])
  })

  test('places the tab before an anchor', async () => {
    expect((await tabbrew('tabs', 'create', '--before', '1903')).exitCode).toBe(0)
    expect(creations.splice(0)).toEqual([{ windowId: 1842, index: 1 }])
  })

  test('opens the tab in a named window', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'create', '--window', '1843')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('created tab 2100 in window B at index 9')
    expect(creations.splice(0)).toEqual([{ windowId: 1843 }])
  })

  test('joins a group through a follow-up groupTabs call', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'create', '--group', '7', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ tabId: 2100, groupId: 7 })
    expect(creations.splice(0)).toEqual([{ windowId: 1842 }])
    expect(groupings.splice(0)).toEqual([{ tabIds: [2100], groupId: 7 }])
  })

  test('rejects a group that lives in another window', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'create', '--window', '1843', '--group', '7')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('group 7 is in window 1842')
    expect(creations).toEqual([])
  })

  test('rejects more than one placement flag', async () => {
    const { exitCode, stderr } = await tabbrew(
      'tabs',
      'create',
      '--window',
      '1842',
      '--after',
      '1901',
    )
    expect(exitCode).toBe(1)
    expect(stderr).toContain('give at most one of --window, --after, --before')
    expect(creations).toEqual([])
  })

  test('rejects an unknown anchor', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'create', '--after', '4242')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no tab 4242')
    expect(creations).toEqual([])
  })

  test('rejects an unknown window', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'create', '--window', '4242')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no window 4242')
    expect(creations).toEqual([])
  })

  test('rejects a non-numeric id', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'create', '--group', 'work')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('--group must be a positive integer: work')
    expect(creations).toEqual([])
  })

  test("surfaces Chrome's refusal", async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'create', 'https://bad.example/')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('createTab failed: Cannot open that URL')
    creations.splice(0)
  })
})

describe('tabbrew tabs focus', () => {
  test('is silent on success', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'focus', '1950')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(focuses.splice(0)).toEqual([1950])
  })

  test('prints the focused tab as json', async () => {
    const { exitCode, stdout } = await tabbrew('tabs', 'focus', '1950', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ tabId: 1950, windowId: 1843 })
    expect(focuses.splice(0)).toEqual([1950])
  })

  test('rejects a non-numeric id before the session is contacted', async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'focus', 'inbox')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tab id must be a positive integer: inbox')
    expect(focuses).toEqual([])
  })

  test("surfaces Chrome's refusal", async () => {
    const { exitCode, stderr } = await tabbrew('tabs', 'focus', '4242')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('focusTab failed: tab 4242 not found')
    focuses.splice(0)
  })
})
