import { describe, expect, test } from 'bun:test'
import { renderOutput } from './view'

const notes = [
  { id: 'n12', tags: ['work', 'idea'], author: { name: 'Jiho' }, title: 'Plugin commands' },
  { id: 'n09', tags: [], author: { name: 'Mina' }, title: 'Release checklist' },
]

describe('renderOutput', () => {
  test('a table takes its rows from a path and its cells from paths', () => {
    expect(
      renderOutput({ notes }, { rows: 'notes', columns: ['id', 'author.name', 'tags', 'title'] }),
    ).toBe(
      [
        'ID   AUTHOR NAME  TAGS        TITLE',
        'n12  Jiho         work, idea  Plugin commands',
        'n09  Mina         -           Release checklist',
      ].join('\n'),
    )
  })

  test('a table clips the columns it was told to', () => {
    expect(renderOutput(notes, { columns: ['id', 'title'], clip: { title: 8 } })).toBe(
      ['ID   TITLE', 'n12  Plugin …', 'n09  Release…'].join('\n'),
    )
  })

  test('an empty table prints nothing', () => {
    expect(renderOutput({ notes: [] }, { rows: 'notes', columns: ['id'] })).toBeNull()
  })

  test('fields are one per line', () => {
    expect(renderOutput(notes[0], { fields: ['id', 'author.name', 'missing'] })).toBe(
      ['FIELD        VALUE', 'ID           n12', 'AUTHOR NAME  Jiho', 'MISSING      -'].join('\n'),
    )
  })

  test('a message fills its placeholders', () => {
    expect(
      renderOutput({ id: 'n13', tab: { id: 4211 } }, { message: 'added {id} to { tab.id }' }),
    ).toBe('added n13 to 4211')
  })

  test('text keeps its line breaks and nothing else a terminal would act on', () => {
    expect(renderOutput({ body: 'one\ntwo\r\n\u0007\u001b[2Jthree' }, { text: 'body' })).toBe(
      'one\ntwo \n  [2Jthree',
    )
    expect(renderOutput({}, { text: 'body' })).toBeNull()
  })

  test('control characters from an extension never reach the terminal', () => {
    const hostile = { id: 'n\u001b[31m1', title: 'two\nlines' }
    for (const rendered of [
      renderOutput([hostile], { columns: ['id', 'title'] }),
      renderOutput(hostile, { fields: ['id', 'title'] }),
      renderOutput(hostile, { message: '{id} {title}' }),
      renderOutput([hostile]),
      renderOutput(hostile),
      renderOutput('two\nlines\u001b'),
    ]) {
      expect(rendered?.replace(/\n/g, '')).not.toMatch(/\p{Cc}/u)
      expect(rendered).not.toContain('two\nlines')
    }
  })

  test('a path stops at what is not an own property', () => {
    expect(renderOutput({}, { message: '[{constructor}] [{__proto__.x}]' })).toBe('[-] [-]')
  })

  test('without a view the shape decides', () => {
    expect(renderOutput(null)).toBeNull()
    expect(renderOutput([])).toBeNull()
    expect(renderOutput({})).toBeNull()
    expect(renderOutput(42)).toBe('42')
    expect(renderOutput(['a', 'b'])).toBe('a\nb')
    expect(renderOutput({ id: 'n1', ok: true })).toBe(
      ['FIELD  VALUE', 'ID     n1', 'OK     true'].join('\n'),
    )
    expect(renderOutput([{ id: 'n1' }, { id: 'n2', title: 'Two' }])).toBe(
      ['ID  TITLE', 'n1  -', 'n2  Two'].join('\n'),
    )
    expect(renderOutput({ nested: { deep: [1] } })).toBe(
      JSON.stringify({ nested: { deep: [1] } }, null, 2),
    )
  })

  test('a table view over something that is not rows falls back to the shape', () => {
    expect(renderOutput({ id: 'n1' }, { rows: 'notes', columns: ['id'] })).toBe(
      ['FIELD  VALUE', 'ID     n1'].join('\n'),
    )
  })
})
