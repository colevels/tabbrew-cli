import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeGroups } from '../../core/groups'
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
  windows: [{ id: 1842, focused: true, incognito: false, state: 'normal' }],
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
  ],
}

const panel = new AbortController()
const updates: { groupId: number; collapsed: boolean }[] = []

function answer(request: OperatorRequest): unknown {
  if (request.operator === 'readSnapshot') return { output: snapshot }
  const input = request.input as { groupId: number; collapsed: boolean }
  updates.push(input)
  if (input.groupId === 99) return { error: `No group with id: ${input.groupId}` }
  return { output: { groupId: input.groupId, title: 'Work', color: 'blue' } }
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
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-groups-'))
})

afterAll(async () => {
  panel.abort()
  await tabbrew('session', 'stop')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('tabbrew groups list', () => {
  test('needs a session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('groups', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no session running')
    expect(stdout).toBe('')
  })

  test('needs the panel', async () => {
    expect((await tabbrew('session', 'start', '--no-open')).exitCode).toBe(0)
    const { exitCode, stdout, stderr } = await tabbrew('groups', 'list', '--json')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tabbrew session open')
    expect(stdout).toBe('')
  })

  test('prints the summaries as json', async () => {
    void servePanel(panel.signal)
    const { exitCode, stdout } = await tabbrew('groups', 'list', '--json')
    expect(exitCode).toBe(0)
    const labelled = {
      ...snapshot,
      windows: snapshot.windows.map((window) => ({ ...window, label: 'A' })),
    }
    expect(JSON.parse(stdout)).toEqual(summarizeGroups(labelled))
  })

  test('prints the table', async () => {
    const { exitCode, stdout } = await tabbrew('groups', 'list')
    expect(exitCode).toBe(0)
    const [header, first] = stdout.split('\n')
    expect(header).toMatch(/^GROUP\s+WINDOW\s+TABS\s+COLOR\s+FLAGS\s+TITLE$/)
    expect(first).toMatch(/^7\s+A\s+1\s+blue\s+-\s+Work$/)
  })
})

describe('tabbrew groups collapse', () => {
  test('rejects a bad id before touching the session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('groups', 'collapse', '7', 'x')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('group id must be a positive integer: x')
    expect(stdout).toBe('')
    expect(updates).toEqual([])
  })

  test('collapses each id in order and prints nothing', async () => {
    const { exitCode, stdout } = await tabbrew('groups', 'collapse', '7', '9')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('')
    expect(updates.splice(0)).toEqual([
      { groupId: 7, collapsed: true },
      { groupId: 9, collapsed: true },
    ])
  })

  test('prints the results as json', async () => {
    const { exitCode, stdout } = await tabbrew('groups', 'collapse', '7', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([{ groupId: 7, collapsed: true }])
    updates.splice(0)
  })

  test('stops at the first failure', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('groups', 'collapse', '7', '99', '9')
    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('updateGroup failed: No group with id: 99')
    expect(updates.splice(0).map((update) => update.groupId)).toEqual([7, 99])
  })
})

describe('tabbrew groups uncollapse', () => {
  test('expands the group', async () => {
    const { exitCode, stdout } = await tabbrew('groups', 'uncollapse', '7', '--json')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual([{ groupId: 7, collapsed: false }])
    expect(updates.splice(0)).toEqual([{ groupId: 7, collapsed: false }])
  })
})
