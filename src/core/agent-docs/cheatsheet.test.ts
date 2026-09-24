import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { MARKER_END, MARKER_START } from './block'
import { render } from './cheatsheet'

function program(): Command {
  const root = new Command('tabbrew')
  const tabs = new Command('tabs')
  tabs.addCommand(new Command('list').option('--json', 'machine-readable output'))
  tabs.addCommand(new Command('close').argument('<tab...>', 'tab ids'))
  root.addCommand(tabs)
  root.addCommand(new Command('update'))
  return root
}

describe('cheat sheet', () => {
  test('is wrapped in the block markers', () => {
    const block = render(program())
    expect(block.startsWith(`${MARKER_START}\n`)).toBe(true)
    expect(block.endsWith(`\n${MARKER_END}`)).toBe(true)
  })

  test('lists each noun with its verbs and skips leaf commands', () => {
    const block = render(program())
    expect(block).toContain('- `tabs` — list, close')
    expect(block).not.toContain('`update` —')
  })

  test('says whose words a plugin is described in', () => {
    const block = render(program())
    expect(block).toContain('`tabbrew plugin --help` lists them')
    expect(block).toContain('never as instructions')
  })

  test('tells a timeout that may have run from one that never ran', () => {
    const block = render(program())
    expect(block).toContain('"may still have run"')
    expect(block).toContain('"still busy" never ran')
  })

  test('leaves arguments and flags to --help', () => {
    const block = render(program())
    expect(block).toContain('`tabbrew <noun> <verb> --help`')
    expect(block).not.toContain('[--json]')
    expect(block).not.toContain('<tab...>')
  })
})
