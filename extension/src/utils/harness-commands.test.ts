import { describe, expect, test } from 'bun:test'
import type { Browser } from 'wxt/browser'
import { parseDeclaration } from '../../../src/core/commands/declaration'
import { createHarnessCommands, HARNESS_DESCRIPTION, HARNESS_NAMESPACE } from './harness-commands'

const tab = (url: string, pendingUrl?: string) => ({ url, pendingUrl }) as Browser.tabs.Tab

const commands = createHarnessCommands({
  tabs: {
    query: async () => [
      tab('https://github.com/a'),
      tab('https://github.com/b'),
      tab('', 'https://bun.sh/docs'),
      tab('about:blank'),
    ],
  },
})

describe('harness commands', () => {
  test('are a declaration the session accepts', () => {
    const declared = Object.fromEntries(
      Object.entries(commands).map(([name, { run: _, ...rest }]) => [name, rest]),
    )
    expect(
      parseDeclaration({
        commandsVersion: 1,
        namespace: HARNESS_NAMESPACE,
        description: HARNESS_DESCRIPTION,
        commands: declared,
      }),
    ).not.toBeNull()
  })

  test('echo repeats its text', async () => {
    expect(await commands.echo?.run({ text: 'hi', times: 3 })).toEqual({ text: 'hi hi hi' })
  })

  test('tabs-by-host counts tabs per host, busiest first', async () => {
    expect(await commands['tabs-by-host']?.run({})).toEqual({
      hosts: [
        { host: 'github.com', tabs: 2 },
        { host: '-', tabs: 1 },
        { host: 'bun.sh', tabs: 1 },
      ],
    })
  })
})
