import { describe, expect, test } from 'bun:test'
import { COMMANDS_VERSION, parseDeclaration } from './declaration'

const valid = {
  commandsVersion: COMMANDS_VERSION,
  namespace: 'bookmarks',
  description: 'Manage bookmarks',
  commands: {
    list: {
      description: 'List bookmarks',
      arguments: [{ name: 'folder', type: 'string', variadic: true }],
      options: { limit: { type: 'number', default: 50 }, 'dry-run': { type: 'boolean' } },
      view: { rows: 'bookmarks', columns: ['id', 'title'], clip: { title: 60 } },
    },
    add: { description: 'Add one', view: { message: 'added {id}' } },
    show: { description: 'Show one', view: { fields: ['id'] } },
  },
}

const withCommand = (command: unknown) => ({ ...valid, commands: { list: command } })

const manyCommands = Object.fromEntries(
  Array.from({ length: 65 }, (_, index) => [`c${index}`, { description: 'x' }]),
)

describe('parseDeclaration', () => {
  test('accepts a full declaration', () => {
    expect(parseDeclaration(valid) as unknown).toEqual(valid)
  })

  test.each([
    ['not an object', 'text'],
    ['another version', { ...valid, commandsVersion: 2 }],
    ['an uppercase namespace', { ...valid, namespace: 'Bookmarks' }],
    ['no commands', { ...valid, commands: {} }],
    ['too many commands', { ...valid, commands: manyCommands }],
    ['a camelCase command name', { ...valid, commands: { listAll: { description: 'x' } } }],
    ['a command without a description', withCommand({})],
    ['an overlong description', withCommand({ description: 'x'.repeat(501) })],
    [
      'an unknown value type',
      withCommand({ description: 'x', arguments: [{ name: 'a', type: 'date' }] }),
    ],
    [
      'a variadic argument before the last',
      withCommand({
        description: 'x',
        arguments: [
          { name: 'a', type: 'string', variadic: true },
          { name: 'b', type: 'string' },
        ],
      }),
    ],
    [
      'an option named json',
      withCommand({ description: 'x', options: { json: { type: 'boolean' } } }),
    ],
    [
      'an option named help',
      withCommand({ description: 'x', options: { help: { type: 'boolean' } } }),
    ],
    [
      'a default of the wrong type',
      withCommand({ description: 'x', options: { limit: { type: 'number', default: '5' } } }),
    ],
    ['a view with no columns', withCommand({ description: 'x', view: { columns: [] } })],
    [
      'a clip too narrow for an ellipsis',
      withCommand({ description: 'x', view: { columns: ['a'], clip: { a: 1 } } }),
    ],
  ])('refuses %s', (_, value) => {
    expect(parseDeclaration(value)).toBeNull()
  })
})
