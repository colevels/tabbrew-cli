import { describe, expect, test } from 'bun:test'
import pkg from '../package.json'

const root = `${import.meta.dir}/..`

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', ...args], {
    cwd: root,
  })
  return { exitCode: result.exitCode, stdout: result.stdout.toString() }
}

describe('tabbrew cli', () => {
  test('--version prints package version', () => {
    const { exitCode, stdout } = run('--version')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe(pkg.version)
  })

  test('--help prints usage', () => {
    const { exitCode, stdout } = run('--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('tabbrew')
    expect(stdout).toContain('tabbrew session start')
  })

  test('group help states the session note once', () => {
    const count = (text: string) => text.split('connected session').length - 1
    expect(count(run('tabs', '--help').stdout)).toBe(1)
    expect(count(run('tabs', 'list', '--help').stdout)).toBe(1)
    expect(count(run('session', '--help').stdout)).toBe(0)
  })
})
