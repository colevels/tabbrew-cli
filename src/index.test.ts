import { describe, expect, test } from 'bun:test'
import pkg from '../package.json'

const root = `${import.meta.dir}/..`

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', ...args], { cwd: root })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('tabbrew cli', () => {
  test('--version prints package version', () => {
    const { exitCode, stdout } = run('--version')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe(pkg.version)
  })

  test('--help prints gh-style root help', () => {
    const { exitCode, stdout } = run('--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('USAGE\n  tabbrew <command> <subcommand> [flags]')
    expect(stdout).toContain(
      'CORE COMMANDS\n  session:    Connect this CLI to the TabBrew extension in Chrome',
    )
    expect(stdout).toContain('ADDITIONAL COMMANDS\n  init:       Write the TabBrew cheat sheet')
    expect(stdout).toContain(
      '  -h, --help     show help for command\n  -V, --version  show tabbrew version',
    )
    expect(stdout).toContain('EXAMPLES\n  $ tabbrew session start')
    expect(stdout).toContain('Use `tabbrew <command> <subcommand> --help`')
    expect(stdout).not.toContain('help:')
  })

  test('bare tabbrew prints root help to stdout', () => {
    const bare = run()
    expect(bare.exitCode).toBe(0)
    expect(bare.stdout).toBe(run('--help').stdout)
  })

  test('unknown command is still an error', () => {
    const { exitCode, stderr } = run('foo')
    expect(exitCode).toBe(1)
    expect(stderr).toContain("unknown command 'foo'")
  })

  test('group and verb screens share the layout', () => {
    expect(run('tabs', '--help').stdout).toContain('USAGE\n  tabbrew tabs <command> [flags]')
    const verb = run('tabs', 'focus', '--help').stdout
    expect(verb).toContain('USAGE\n  tabbrew tabs focus <tab> [flags]')
    expect(verb).toContain('ARGUMENTS\n  <tab>  tab id, as shown by "tabs list"')
    expect(verb).toContain(
      '      --json  machine-readable output\n  -h, --help  show help for command',
    )
  })

  test('group help states the session note once', () => {
    const count = (text: string) => text.split('connected session').length - 1
    expect(count(run('tabs', '--help').stdout)).toBe(1)
    expect(count(run('tabs', 'list', '--help').stdout)).toBe(1)
    expect(count(run('session', '--help').stdout)).toBe(0)
  })
})
