import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pkg from '../../../package.json'
import { MARKER_END, MARKER_START } from '../../core/agent-docs'

const entry = join(import.meta.dir, '../../index.ts')
let dir = ''

function tabbrew(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', entry, 'init', ...args], { cwd: dir })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const exists = (rel: string) => existsSync(join(dir, rel))
const count = (text: string, needle: string) => text.split(needle).length - 1

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabbrew-init-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('tabbrew init', () => {
  test('creates CLAUDE.md with the cheat sheet by default', () => {
    const { exitCode, stdout } = tabbrew()
    expect(exitCode).toBe(0)
    expect(stdout).toContain('agent docs written → CLAUDE.md')
    const doc = read('CLAUDE.md')
    expect(doc).toContain(MARKER_START)
    expect(doc).toContain(MARKER_END)
    expect(doc).toContain(`TabBrew CLI v${pkg.version}`)
    expect(doc).toContain('tabbrew session start')
    expect(doc).toContain('tabbrew session status [--json]')
    expect(readdirSync(dir)).toEqual(['CLAUDE.md'])
  })

  test('re-running keeps a single block and changes nothing', () => {
    tabbrew()
    const first = read('CLAUDE.md')
    expect(tabbrew().exitCode).toBe(0)
    expect(read('CLAUDE.md')).toBe(first)
    expect(count(first, MARKER_START)).toBe(1)
  })

  test('appends to an existing CLAUDE.md without touching its content', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n\nKeep this.\n')
    expect(tabbrew().exitCode).toBe(0)
    const doc = read('CLAUDE.md')
    expect(doc.startsWith('# Mine\n\nKeep this.\n\n')).toBe(true)
    expect(count(doc, MARKER_START)).toBe(1)
  })

  test('updates an existing AGENTS.md in place instead of creating CLAUDE.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n')
    const { stdout } = tabbrew()
    expect(stdout).toContain('agent docs written → AGENTS.md')
    expect(read('AGENTS.md')).toContain(MARKER_START)
    expect(exists('CLAUDE.md')).toBe(false)
  })

  test('--agent codex targets AGENTS.md', () => {
    expect(tabbrew('--agent', 'codex').exitCode).toBe(0)
    expect(exists('AGENTS.md')).toBe(true)
    expect(exists('CLAUDE.md')).toBe(false)
  })

  test('--agent all creates CLAUDE.md and AGENTS.md', () => {
    expect(tabbrew('--agent', 'all').exitCode).toBe(0)
    expect(exists('CLAUDE.md')).toBe(true)
    expect(exists('AGENTS.md')).toBe(true)
  })

  test('--agent bogus is rejected before anything is written', () => {
    const { exitCode, stderr } = tabbrew('--agent', 'bogus')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('claude, cursor, codex, all')
    expect(readdirSync(dir)).toEqual([])
  })

  test('--path writes a nested file', () => {
    expect(tabbrew('--path', 'docs/AI.md').exitCode).toBe(0)
    expect(read('docs/AI.md')).toContain(MARKER_START)
  })

  test('--path outside the directory is rejected', () => {
    const { exitCode, stderr } = tabbrew('--path', '../escape.md')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('inside')
    expect(readdirSync(dir)).toEqual([])
  })

  test('--print writes nothing', () => {
    const { exitCode, stdout } = tabbrew('--print')
    expect(exitCode).toBe(0)
    expect(stdout).toContain(MARKER_START)
    expect(readdirSync(dir)).toEqual([])
  })

  test('--remove deletes a file that held only our block', () => {
    tabbrew()
    const { exitCode, stdout } = tabbrew('--remove')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('removed empty CLAUDE.md')
    expect(exists('CLAUDE.md')).toBe(false)
  })

  test("--remove keeps the user's own content", () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n\nKeep this.\n')
    tabbrew()
    const { stdout } = tabbrew('--remove')
    expect(stdout).toContain('agent docs removed from CLAUDE.md')
    expect(read('CLAUDE.md')).toBe('# Mine\n\nKeep this.\n')
  })

  test('--remove with nothing installed', () => {
    const { exitCode, stdout } = tabbrew('--remove')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('no agent docs found')
  })
})
