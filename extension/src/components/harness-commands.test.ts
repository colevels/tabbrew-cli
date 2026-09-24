import { expect, test } from 'bun:test'
import type { ChromeApi } from '../../../sdk/src/index'
import { parseDeclaration } from '../../../src/core/commands/declaration'
import { harnessCommands } from './harness-commands'

const chrome = (urls: (string | undefined)[]) =>
  ({ tabs: { query: async () => urls.map((url) => ({ url })) } }) as unknown as ChromeApi

test('everything the harness declares is accepted', () => {
  const parsed = parseDeclaration({
    commandsVersion: 1,
    namespaces: harnessCommands(chrome([]), '0.0.0'),
  })
  expect(parsed?.invalidNamespaces).toEqual([])
  expect(parsed?.dropped).toEqual([])
  expect(Object.keys(parsed?.declaration.namespaces ?? {})).toEqual(['harness', 'harness-build'])
  expect(parsed?.declaration.namespaces.harness?.commands.echo?.examples).toHaveLength(1)
})

test('echo says it back', async () => {
  const { echo } = harnessCommands(chrome([]), '0.0.0').harness?.commands ?? {}
  expect(await echo?.run({ text: 'brewed', times: 2 })).toEqual({ text: 'brewed brewed' })
})

test('tabs-by-host counts the busiest host first', async () => {
  const commands = harnessCommands(
    chrome(['https://b.test/1', 'https://a.test/', 'https://b.test/2', undefined, 'about:blank']),
    '0.0.0',
  ).harness?.commands
  expect(await commands?.['tabs-by-host']?.run({})).toEqual({
    hosts: [
      { host: '-', tabs: 2 },
      { host: 'b.test', tabs: 2 },
      { host: 'a.test', tabs: 1 },
    ],
  })
})
