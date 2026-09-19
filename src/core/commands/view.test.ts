import { describe, expect, test } from 'bun:test'
import { renderOutput } from './view'

describe('renderOutput', () => {
  test('a table view picks rows by path and columns in the declared order', () => {
    const output = { bookmarks: [{ id: 1, title: 'Docs', site: { host: 'bun.sh' } }] }
    expect(renderOutput(output, { rows: 'bookmarks', columns: ['id', 'site.host', 'title'] })).toBe(
      'ID  SITE HOST  TITLE\n1   bun.sh     Docs',
    )
  })

  test('a table view clips the columns it names and prints nothing for no rows', () => {
    const view = { columns: ['title'], clip: { title: 5 } }
    expect(renderOutput([{ title: 'A long title' }], view)).toBe('TITLE\nA lo…')
    expect(renderOutput([], view)).toBeNull()
  })

  test('a fields view lists the named fields', () => {
    expect(
      renderOutput({ id: 7, folderName: 'work', extra: 1 }, { fields: ['id', 'folderName'] }),
    ).toBe('FIELD        VALUE\nID           7\nFOLDER NAME  work')
  })

  test('a message view fills its placeholders', () => {
    expect(
      renderOutput({ tab: 4, node: { id: 'b9' } }, { message: 'saved {tab} as { node.id }' }),
    ).toBe('saved 4 as b9')
  })

  test('without a view the shape decides', () => {
    expect(renderOutput([{ a: 1 }, { b: 'x' }])).toBe('A  B\n1  -\n-  x')
    expect(renderOutput({ id: 3 })).toBe('FIELD  VALUE\nID     3')
    expect(renderOutput('done')).toBe('done')
    expect(renderOutput(['a', 'b'])).toBe('a\nb')
    expect(renderOutput({})).toBeNull()
    expect(renderOutput(null)).toBeNull()
    expect(renderOutput({ deep: { er: [1] } })).toBe(JSON.stringify({ deep: { er: [1] } }, null, 2))
  })

  test('a rows path that is not a list falls back to the shape', () => {
    expect(renderOutput({ count: 2 }, { rows: 'items', columns: ['id'] })).toBe(
      'FIELD  VALUE\nCOUNT  2',
    )
  })

  test('control characters from an extension never reach the terminal', () => {
    const hostile = `${String.fromCharCode(27)}[31mred${String.fromCharCode(7)}`
    for (const rendered of [
      renderOutput([{ title: hostile }], { columns: ['title'] }),
      renderOutput({ title: hostile }, { message: `${hostile} {title}` }),
      renderOutput({ title: hostile }),
      renderOutput({ nested: { title: hostile } }),
      renderOutput(hostile),
    ]) {
      for (const line of (rendered ?? '').split('\n')) expect(line).not.toMatch(/\p{Cc}/u)
    }
  })
})
