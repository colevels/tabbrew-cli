// The compiled CLI against a real Chrome holding the harness extension: no
// fake panel, every command goes through chrome.* for real. Needs
// TABBREW_E2E=1 and TABBREW_E2E_CHROME_BIN (Chrome for Testing or Chromium;
// branded Chrome 137+ ignores --load-extension); see scripts/e2e-chrome.sh.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pkg from '../../package.json'
import type { GroupSummary } from '../core/groups'
import type { OperatorOutput, Snapshot, TabPlacement, TabSnapshot } from '../core/operators'
import { connectionUrl } from '../core/session/chrome'
import type { WindowSummary } from '../core/windows'

const enabled = !!process.env.TABBREW_E2E
const root = `${import.meta.dir}/../..`
const binary = join(root, 'dist', 'tabbrew')
const extension = join(root, 'extension', 'dist', 'chrome-mv3')
let stateDir = ''
let profile = ''

// Five pages served from here, so the urls and titles Chrome reports are
// exactly known and the suite never depends on the network.
const PAGES = ['Inbox', 'Pull Request #42', 'Docs', 'Dashboard', 'Notes'] as const
let site: ReturnType<typeof Bun.serve> | null = null
const pageUrl = (page: number): string => `http://127.0.0.1:${site?.port}/page/${page}`
const siteUrls = (): string[] => PAGES.map((_, page) => pageUrl(page))

const env = () => ({
  ...process.env,
  TABBREW_SESSION_DIR: stateDir,
  TABBREW_CHROME: join(root, 'scripts', 'e2e-chrome.sh'),
  TABBREW_E2E_PROFILE: profile,
  TABBREW_E2E_EXTENSION: extension,
  // A cold Chrome on a CI runner takes well over the 5s default to show a page.
  TABBREW_SESSION_CONNECT_WAIT_MS: '30000',
  TABBREW_SESSION_IDLE_MS: '120000',
})

async function tabbrew(...args: string[]) {
  const child = Bun.spawn([binary, ...args], {
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

async function json<T>(...args: string[]): Promise<T> {
  const { exitCode, stdout, stderr } = await tabbrew(...args, '--json')
  expect(stderr).toBe('')
  expect(exitCode).toBe(0)
  return JSON.parse(stdout) as T
}

const snapshot = () => json<Snapshot>('tabs', 'list')

// The tabs of one window in strip order, once none of them is still loading:
// a title is only trustworthy after the page has finished.
async function settledTabs(windowId: number, timeoutMs = 15_000): Promise<TabSnapshot[]> {
  const until = Date.now() + timeoutMs
  let tabs: TabSnapshot[] = []
  while (Date.now() < until) {
    tabs = (await snapshot()).tabs
      .filter((tab) => tab.windowId === windowId)
      .sort((a, b) => a.index - b.index)
    if (tabs.length > 0 && tabs.every((tab) => tab.status === 'complete')) return tabs
    await Bun.sleep(200)
  }
  return tabs
}

beforeAll(() => {
  if (!enabled) return
  if (!process.env.TABBREW_E2E_CHROME_BIN) throw new Error('TABBREW_E2E_CHROME_BIN is not set')
  if (!existsSync(binary)) throw new Error(`${binary} is missing; run "bun run build"`)
  if (!existsSync(extension)) throw new Error(`${extension} is missing; run "bun run build:ext"`)
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-e2e-state-'))
  profile = mkdtempSync(join(tmpdir(), 'tabbrew-e2e-profile-'))
  site = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const page = Number(new URL(req.url).pathname.split('/')[2])
      const title = PAGES[page]
      if (title === undefined) return new Response('not found', { status: 404 })
      return new Response(`<!doctype html><title>${title}</title><h1>${title}</h1>`, {
        headers: { 'content-type': 'text/html' },
      })
    },
  })
})

afterAll(async () => {
  if (!enabled) return
  await tabbrew('session', 'stop')
  // The launcher's argv carries the profile path, so it names exactly our Chrome.
  await Bun.spawn(['pkill', '-f', profile]).exited
  await Bun.sleep(500)
  site?.stop(true)
  // A CI runner is thrown away anyway, and the workflow uploads session.log on failure.
  if (process.env.CI) return
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
})

describe.skipIf(!enabled)('tabbrew against a real Chrome', () => {
  let windowId = 0
  // Tab ids in the order the window was created with, one per page.
  let ids: number[] = []
  let groupId = 0

  const expectedTab = (page: number, extra: Partial<TabSnapshot> = {}) => ({
    id: ids[page],
    windowId,
    url: pageUrl(page),
    title: PAGES[page],
    pinned: false,
    discarded: false,
    active: page === 0,
    status: 'complete',
    groupId: -1,
    ...extra,
  })

  test('session start opens the connection page and gets connected', async () => {
    const before = await tabbrew('session', 'status')
    if (before.exitCode === 0) throw new Error(`a session is already running:\n${before.stdout}`)

    const { exitCode, stdout, stderr } = await tabbrew('session', 'start')
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('connected')

    const status = await json<{ running: boolean; listening: boolean; version: string }>(
      'session',
      'status',
    )
    expect(status.running).toBe(true)
    expect(status.listening).toBe(true)
    expect(status.version).toBe(pkg.version)
  })

  test('tabs list sees the connection page', async () => {
    const snap = await snapshot()
    expect(snap.windows.length).toBeGreaterThan(0)
    expect(snap.tabs.map((tab) => tab.url)).toContain(connectionUrl())
  })

  test('windows create opens five pages and tabs list reports each of them', async () => {
    const windowsBefore = await json<WindowSummary[]>('windows', 'list')
    const created = await json<OperatorOutput<'createWindow'>>('windows', 'create', ...siteUrls())
    expect(created.windowId).toBeNumber()
    expect(created.tabs.map((tab) => tab.url)).toEqual(siteUrls())
    windowId = created.windowId as number
    ids = created.tabs.map((tab) => tab.tabId)

    const windows = await json<WindowSummary[]>('windows', 'list')
    expect(windows).toHaveLength(windowsBefore.length + 1)
    expect(windows.find((window) => window.id === windowId)).toMatchObject({
      tabCount: PAGES.length,
      groupCount: 0,
      activeTabId: ids[0],
    })

    const tabs = await settledTabs(windowId)
    expect(tabs).toMatchObject(PAGES.map((_, page) => expectedTab(page, { index: page })))
  })

  test('tabs group joins two tabs and tabs list shows only them in the group', async () => {
    const grouped = await json<OperatorOutput<'updateGroup'>>(
      'tabs',
      'group',
      String(ids[1]),
      String(ids[2]),
      '--title',
      'ci',
      '--color',
      'blue',
    )
    expect(grouped.groupId).toBeGreaterThan(0)
    groupId = grouped.groupId

    const tabs = await settledTabs(windowId)
    expect(tabs).toMatchObject([
      expectedTab(0, { index: 0 }),
      expectedTab(1, { index: 1, groupId }),
      expectedTab(2, { index: 2, groupId }),
      expectedTab(3, { index: 3 }),
      expectedTab(4, { index: 4 }),
    ])

    const groups = await json<GroupSummary[]>('groups', 'list')
    expect(groups.filter((group) => group.windowId === windowId)).toMatchObject([
      { id: groupId, windowId, title: 'ci', color: 'blue', collapsed: false, tabCount: 2 },
    ])
  })

  test('groups collapse and uncollapse toggle the group', async () => {
    type Toggled = { groupId: number; collapsed: boolean }[]
    const collapsed = (g: GroupSummary[]) => g.find((group) => group.id === groupId)?.collapsed

    expect(await json<Toggled>('groups', 'collapse', String(groupId))).toEqual([
      { groupId, collapsed: true },
    ])
    expect(collapsed(await json<GroupSummary[]>('groups', 'list'))).toBe(true)

    expect(await json<Toggled>('groups', 'uncollapse', String(groupId))).toEqual([
      { groupId, collapsed: false },
    ])
    expect(collapsed(await json<GroupSummary[]>('groups', 'list'))).toBe(false)
  })

  test('tabs move places a tab after another and tabs list shows the new order', async () => {
    const moved = await json<TabPlacement[]>(
      'tabs',
      'move',
      String(ids[0]),
      '--after',
      String(ids[2]),
    )
    expect(moved).toEqual([{ tabId: ids[0] as number, windowId, index: 2 }])

    const tabs = await settledTabs(windowId)
    expect(tabs).toMatchObject([
      expectedTab(1, { index: 0, groupId }),
      expectedTab(2, { index: 1, groupId }),
      expectedTab(0, { index: 2 }),
      expectedTab(3, { index: 3 }),
      expectedTab(4, { index: 4 }),
    ])
  })

  test('tabs discard unloads a background tab and keeps it in its group', async () => {
    const [result] = await json<OperatorOutput<'discardTab'>[]>('tabs', 'discard', String(ids[1]))
    expect(result?.previousTabId).toBe(ids[1] as number)

    const tab = (await snapshot()).tabs.find((t) => t.id === result?.tabId)
    expect(tab).toMatchObject({ windowId, index: 0, url: pageUrl(1), discarded: true, groupId })
  })

  test('session stop ends the session', async () => {
    expect((await tabbrew('session', 'stop')).exitCode).toBe(0)
    expect((await tabbrew('session', 'status')).exitCode).toBe(1)
  })
})
