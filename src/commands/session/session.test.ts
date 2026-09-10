import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pkg from '../../../package.json'
import { connectionUrl } from '../../core/session/chrome'
import { NEXT_REQUEST_PATH } from '../../core/session/protocol'

const root = `${import.meta.dir}/../../..`
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000)
let stateDir = ''

// A launcher that only records what it was asked to open.
let launcher = ''
const opened = (): string[] => {
  try {
    return readFileSync(join(stateDir, 'opened'), 'utf8').trim().split('\n')
  } catch {
    return []
  }
}

const env = () => ({
  ...process.env,
  TABBREW_SESSION_PORTS: String(port),
  TABBREW_SESSION_DIR: stateDir,
  TABBREW_SESSION_LONG_POLL_MS: '500',
  TABBREW_SESSION_CONNECT_WAIT_MS: '1500',
  TABBREW_CHROME: launcher,
})

function tabbrew(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', 'session', ...args], {
    cwd: root,
    env: env(),
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-session-'))
  launcher = join(stateDir, 'chrome')
  writeFileSync(launcher, `#!/bin/sh\necho "$1" >> "${join(stateDir, 'opened')}"\n`, {
    mode: 0o755,
  })
})

afterAll(() => {
  tabbrew('stop')
  rmSync(stateDir, { recursive: true, force: true })
})

describe('tabbrew session', () => {
  test('status reports nothing running', () => {
    const { exitCode, stdout } = tabbrew('status')
    expect(exitCode).toBe(1)
    expect(stdout).toContain('no session running')
  })

  test('start launches a background session', () => {
    const { exitCode, stdout } = tabbrew('start', '--no-open')
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`session started on 127.0.0.1:${port}`)
  })

  test('status sees it, as text and as json', () => {
    const text = tabbrew('status')
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain('session running')

    const { exitCode, stdout } = tabbrew('status', '--json')
    expect(exitCode).toBe(0)
    const body = JSON.parse(stdout)
    expect(body).toMatchObject({ running: true, port, version: pkg.version, cli: pkg.version })
    expect(body.pid).toBeGreaterThan(0)
    expect(body.pid).not.toBe(process.pid)
  })

  test('start again is a no-op', () => {
    const { exitCode, stdout } = tabbrew('start', '--no-open')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('already running')
    expect(opened()).toEqual([])
  })

  test('open launches the connection page and waits for it', async () => {
    const controller = new AbortController()
    const hold = async () => {
      while (!controller.signal.aborted) {
        try {
          await fetch(`http://127.0.0.1:${port}${NEXT_REQUEST_PATH}`, {
            headers: { 'sec-fetch-site': 'none' },
            signal: controller.signal,
          })
        } catch {
          if (controller.signal.aborted) return
          await Bun.sleep(50)
        }
      }
    }
    // The fake page shows up a moment after the launcher is asked for it.
    const page = (async () => {
      while (opened().length === 0) await Bun.sleep(20)
      await hold()
    })()
    try {
      // Async, unlike the rest: the fake page must get to run while the CLI waits.
      const child = Bun.spawn(['bun', 'run', 'src/index.ts', 'session', 'open'], {
        cwd: root,
        env: env(),
        stdout: 'pipe',
      })
      const stdout = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(stdout).toContain('session connected')
      expect(opened()).toEqual([connectionUrl()])
      expect(tabbrew('status').stdout).toContain('running, connected')
    } finally {
      controller.abort()
      await page
    }
  })

  test('open reports a page that never connects', () => {
    const { exitCode, stderr } = tabbrew('open')
    expect(exitCode).toBe(1)
    expect(stderr).toContain(connectionUrl())
    expect(tabbrew('status').stdout).toContain('running, not connected')
  })

  test('run refuses to start a second one', () => {
    const { exitCode, stderr } = tabbrew('run')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('already running')
  })

  test('stop ends it', () => {
    const { exitCode, stdout } = tabbrew('stop')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('session stopped')
    expect(tabbrew('status').exitCode).toBe(1)
  })

  test('stop with nothing running is fine', () => {
    const { exitCode, stdout } = tabbrew('stop')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('no session running')
  })

  test('open with nothing running is not', () => {
    const { exitCode, stderr } = tabbrew('open')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('no session running')
  })
})
