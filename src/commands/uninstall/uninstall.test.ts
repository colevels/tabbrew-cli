import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entry = join(import.meta.dir, '../../index.ts')
// A port nothing else on the machine (or a real session) is likely to hold.
const port = 50_000 + Math.floor(Math.random() * 10_000)
let stateDir = ''

function tabbrew(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', entry, 'uninstall', ...args], {
    env: { ...process.env, TABBREW_SESSION_PORTS: String(port), TABBREW_SESSION_DIR: stateDir },
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('tabbrew uninstall', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'tabbrew-uninstall-'))
    writeFileSync(join(stateDir, 'session.log'), 'x')
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  test('removes the state directory and skips the binary under a source run', () => {
    const { exitCode, stdout } = tabbrew()
    expect(exitCode).toBe(0)
    expect(existsSync(stateDir)).toBe(false)
    expect(stdout).toContain('session: none running')
    expect(stdout).toContain(`state: removed ${stateDir}`)
    expect(stdout).toContain('binary: skipped')
    expect(stdout).toContain('chrome://extensions')
  })

  test('--dry-run changes nothing', () => {
    const { exitCode, stdout } = tabbrew('--dry-run')
    expect(exitCode).toBe(0)
    expect(existsSync(join(stateDir, 'session.log'))).toBe(true)
    expect(stdout).toContain(`state: would remove ${stateDir}`)
  })

  test('--json reports the plan', () => {
    const { exitCode, stdout } = tabbrew('--json', '--dry-run')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      session: null,
      stateDirectory: stateDir,
      binary: null,
      removed: false,
    })
  })

  test('is idempotent when nothing is left', () => {
    rmSync(stateDir, { recursive: true, force: true })
    expect(tabbrew().exitCode).toBe(0)
  })
})
