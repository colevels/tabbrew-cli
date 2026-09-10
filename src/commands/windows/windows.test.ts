import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Snapshot } from '../../core/operators'
import { NEXT_REQUEST_PATH, type OperatorRequest, resultPath } from '../../core/session/protocol'
import { summarizeWindows } from '../../core/windows'

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
const creates: { urls: string[]; focused: boolean }[] = []

function answer(request: OperatorRequest): unknown {
  if (request.operator === 'createWindow') {
    const input = request.input as { urls: string[]; focused: boolean }
    creates.push(input)
    return {
      output: {
        windowId: 9001,
        focused: input.focused,
        tabs: input.urls.map((url, i) => ({ tabId: 9100 + i, url })),
      },
    }
  }
  return { output: snapshot }
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
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-windows-'))
})

afterAll(async () => {
  panel.abort()
  await tabbrew('session', 'stop')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('tabbrew windows list', () => {
  test('needs a session', async () => {
    const { exitCode, stdout, stderr } = await tabbrew('windows', 'list')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no session running')
    expect(stdout).toBe('')
  })

  test('needs the panel', async () => {
    expect((await tabbrew('session', 'start', '--no-open')).exitCode).toBe(0)
    const { exitCode, stdout, stderr } = await tabbrew('windows', 'list', '--json')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('tabbrew session open')
    expect(stdout).toBe('')
  })

  test('prints the snapshot as json', async () => {
    void servePanel(panel.signal)
    const { exitCode, stdout } = await tabbrew('windows', 'list', '--json')
    expect(exitCode).toBe(0)
    const labelled = {
      ...snapshot,
      windows: snapshot.windows.map((window) => ({ ...window, label: 'A' })),
    }
    expect(JSON.parse(stdout)).toEqual(summarizeWindows(labelled))
  })

  test('prints the table', async () => {
    const { exitCode, stdout } = await tabbrew('windows', 'list')
    expect(exitCode).toBe(0)
    const [header, first] = stdout.split('\n')
    expect(header).toMatch(/^WINDOW\s+ID\s+TABS\s+GROUPS\s+FLAGS\s+ACTIVE$/)
    expect(first).toMatch(/^A\s+1842\s+2\s+1\s+focused\s+mail\.google\.com\s+Inbox$/)
  })
})

describe('tabbrew windows create', () => {
  test('opens unfocused by default and prints a summary', async () => {
    const { exitCode, stdout } = await tabbrew('windows', 'create', 'https://example.com')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('created window 9001 (1 tab)\n')
    expect(creates.splice(0)).toEqual([{ urls: ['https://example.com'], focused: false }])
  })

  test('opens focused with --focus', async () => {
    const { exitCode, stdout } = await tabbrew(
      'windows',
      'create',
      'https://example.com',
      '--focus',
    )
    expect(exitCode).toBe(0)
    expect(stdout).toBe('created window 9001 (1 tab)\n')
    expect(creates.splice(0)).toEqual([{ urls: ['https://example.com'], focused: true }])
  })

  test('opens with no urls', async () => {
    const { exitCode, stdout } = await tabbrew('windows', 'create')
    expect(exitCode).toBe(0)
    expect(stdout).toBe('created window 9001 (0 tabs)\n')
    expect(creates.splice(0)).toEqual([{ urls: [], focused: false }])
  })

  test('opens several urls and prints the output as json', async () => {
    const { exitCode, stdout } = await tabbrew(
      'windows',
      'create',
      'https://a.example.com',
      'https://b.example.com',
      '--json',
    )
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      windowId: 9001,
      focused: false,
      tabs: [
        { tabId: 9100, url: 'https://a.example.com' },
        { tabId: 9101, url: 'https://b.example.com' },
      ],
    })
    expect(creates.splice(0)).toEqual([
      { urls: ['https://a.example.com', 'https://b.example.com'], focused: false },
    ])
  })
})
