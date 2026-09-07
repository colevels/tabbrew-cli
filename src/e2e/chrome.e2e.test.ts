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
import type { OperatorOutput, Snapshot, TabPlacement } from '../core/operators'
import { connectionUrl } from '../core/session/chrome'
import type { WindowSummary } from '../core/windows'

const enabled = !!process.env.TABBREW_E2E
const root = `${import.meta.dir}/../..`
const binary = join(root, 'dist', 'tabbrew')
const extension = join(root, 'extension', 'dist', 'chrome-mv3')
let stateDir = ''
let profile = ''

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

beforeAll(() => {
  if (!enabled) return
  if (!process.env.TABBREW_E2E_CHROME_BIN) throw new Error('TABBREW_E2E_CHROME_BIN is not set')
  if (!existsSync(binary)) throw new Error(`${binary} is missing; run "bun run build"`)
  if (!existsSync(extension)) throw new Error(`${extension} is missing; run "bun run build:ext"`)
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-e2e-state-'))
  profile = mkdtempSync(join(tmpdir(), 'tabbrew-e2e-profile-'))
})

afterAll(async () => {
  if (!enabled) return
  await tabbrew('session', 'stop')
  // The launcher's argv carries the profile path, so it names exactly our Chrome.
  await Bun.spawn(['pkill', '-f', profile]).exited
  await Bun.sleep(500)
  // A CI runner is thrown away anyway, and the workflow uploads session.log on failure.
  if (process.env.CI) return
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
})

describe.skipIf(!enabled)('tabbrew against a real Chrome', () => {
  let windowId = 0
  let first = 0
  let second = 0
  let third = 0
  let groupId = 0

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

  test('windows create opens a window with the given tabs', async () => {
    const windowsBefore = await json<WindowSummary[]>('windows', 'list')
    const created = await json<OperatorOutput<'createWindow'>>(
      'windows',
      'create',
      'about:blank',
      'about:blank',
      'about:blank',
    )
    expect(created.windowId).toBeNumber()
    expect(created.tabs).toHaveLength(3)
    windowId = created.windowId as number
    ;[first, second, third] = created.tabs.map((tab) => tab.tabId) as [number, number, number]

    const windows = await json<WindowSummary[]>('windows', 'list')
    expect(windows).toHaveLength(windowsBefore.length + 1)
    expect(windows.find((window) => window.id === windowId)?.tabCount).toBe(3)
  })

  test('tabs group creates a titled, coloured group', async () => {
    const grouped = await json<OperatorOutput<'updateGroup'>>(
      'tabs',
      'group',
      String(second),
      String(third),
      '--title',
      'ci',
      '--color',
      'blue',
    )
    expect(grouped.groupId).toBeGreaterThan(0)
    groupId = grouped.groupId

    const group = (await json<GroupSummary[]>('groups', 'list')).find((g) => g.id === groupId)
    expect(group).toMatchObject({
      windowId,
      title: 'ci',
      color: 'blue',
      collapsed: false,
      tabCount: 2,
    })
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

  test('tabs move places a tab after another', async () => {
    const moved = await json<TabPlacement[]>(
      'tabs',
      'move',
      String(first),
      '--after',
      String(third),
    )
    expect(moved).toEqual([{ tabId: first, windowId, index: 2 }])

    const tabs = (await snapshot()).tabs.filter((tab) => tab.windowId === windowId)
    expect(tabs.map((tab) => tab.id)).toEqual([second, third, first])
  })

  test('tabs discard unloads a background tab', async () => {
    const [result] = await json<OperatorOutput<'discardTab'>[]>('tabs', 'discard', String(second))
    expect(result?.previousTabId).toBe(second)

    const tab = (await snapshot()).tabs.find((t) => t.id === result?.tabId)
    expect(tab?.discarded).toBe(true)
    expect(tab?.groupId).toBe(groupId)
  })

  test('session stop ends the session', async () => {
    expect((await tabbrew('session', 'stop')).exitCode).toBe(0)
    expect((await tabbrew('session', 'status')).exitCode).toBe(1)
  })
})
