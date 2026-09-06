import { describe, expect, test } from 'bun:test'
import type { Snapshot, TabSnapshot } from '../operators/contract'
import { formatTabTable } from './format'

type Place = Pick<TabSnapshot, 'id' | 'windowId' | 'index'>

const tab = (overrides: Place & Partial<TabSnapshot>): TabSnapshot => ({
  url: '',
  title: '',
  pinned: false,
  audible: false,
  muted: false,
  discarded: false,
  active: false,
  groupId: -1,
  ...overrides,
})

const snapshot = (tabs: TabSnapshot[]): Snapshot => ({ takenAt: 0, windows: [], groups: [], tabs })

const lines = (table: string) => table.split('\n')

describe('formatTabTable', () => {
  test('lays tabs out by window and index in a padded table', () => {
    const table = formatTabTable(
      snapshot([
        tab({
          id: 1903,
          windowId: 1842,
          index: 1,
          groupId: 7,
          title: 'Pull Request #42',
          url: 'https://github.com/pull/42',
        }),
        tab({ id: 1950, windowId: 1843, index: 0, url: 'chrome://newtab/' }),
        tab({
          id: 1901,
          windowId: 1842,
          index: 0,
          active: true,
          title: 'Inbox',
          url: 'https://mail.google.com/',
        }),
      ]),
    )
    expect(table).toBe(
      [
        'TAB   WINDOW  GROUP  FLAGS   URL              TITLE',
        '1901  1842    -      active  mail.google.com  Inbox',
        '1903  1842    7      -       github.com       Pull Request #42',
        '1950  1843    -      -       newtab           -',
      ].join('\n'),
    )
  })

  test('lists the flags in a fixed order', () => {
    const table = formatTabTable(
      snapshot([
        tab({
          id: 1,
          windowId: 1,
          index: 0,
          active: true,
          pinned: true,
          audible: true,
          muted: true,
          discarded: true,
          status: 'loading',
          url: 'u',
        }),
      ]),
    )
    expect(lines(table)[1]).toContain('  active,pinned,audible,muted,discarded,loading  ')
  })

  test('keeps the title last and at a stable offset past wide characters', () => {
    const titles = ['日本語のタイトル', 'ภาษาไทย', 'Inbox']
    const table = formatTabTable(
      snapshot([
        tab({ id: 1, windowId: 1, index: 0, title: titles[0], url: 'https://example.jp/' }),
        tab({ id: 2, windowId: 1, index: 1, title: titles[1], url: 'https://example.co.th/' }),
        tab({ id: 3, windowId: 1, index: 2, title: titles[2], url: 'https://mail.google.com/' }),
      ]),
    )
    const [header, ...rows] = lines(table)
    expect(header?.endsWith('TITLE')).toBe(true)
    // Every title is the last cell, so it must start at the same column in each
    // row: that only holds if the padded columns before it agree on width.
    const offsets = rows.map((line, i) => {
      const title = titles[i] ?? ''
      expect(line.endsWith(title)).toBe(true)
      return Bun.stringWidth(line) - Bun.stringWidth(title)
    })
    expect(new Set(offsets).size).toBe(1)
    for (const line of rows) expect(line).not.toMatch(/ $/)
  })

  test('shows the host only, without www', () => {
    const table = formatTabTable(
      snapshot([
        tab({
          id: 1,
          windowId: 1,
          index: 0,
          title: 'a',
          url: 'https://www.youtube.com/watch?v=abc',
        }),
        tab({ id: 2, windowId: 1, index: 1, title: 'b', url: 'chrome://newtab/' }),
        tab({ id: 3, windowId: 1, index: 2, title: 'c', url: 'about:blank' }),
      ]),
    )
    const [, ...rows] = lines(table)
    expect(rows[0]).toContain('youtube.com')
    expect(rows[0]).not.toContain('www.')
    expect(rows[1]).toContain('newtab')
    expect(rows[2]).toContain('about')
  })

  test('scrubs control characters and never pads the last column', () => {
    const table = formatTabTable(
      snapshot([
        tab({ id: 1, windowId: 1, index: 0, title: 'bad\ntitle', url: 'https://example.com/long' }),
        tab({ id: 2, windowId: 1, index: 1, title: 'ok', url: 'u' }),
      ]),
    )
    expect(lines(table)).toHaveLength(3)
    expect(lines(table)[1]?.endsWith('bad title')).toBe(true)
    for (const line of lines(table)) expect(line).not.toMatch(/ $/)
  })

  test('caps the title at 60 columns with an ellipsis', () => {
    const table = formatTabTable(
      snapshot([
        tab({ id: 1, windowId: 1, index: 0, title: 'a'.repeat(100), url: 'u' }),
        tab({ id: 2, windowId: 1, index: 1, title: '本'.repeat(50), url: 'u' }),
      ]),
    )
    const [, wide, cjk] = lines(table)
    expect(wide?.endsWith(`${'a'.repeat(59)}…`)).toBe(true)
    expect(wide).not.toContain('a'.repeat(60))
    // 29 wide chars (58 columns) plus the ellipsis is the most that fits in 60.
    expect(cjk?.endsWith(`${'本'.repeat(29)}…`)).toBe(true)
    expect(cjk).not.toContain('本'.repeat(30))
  })

  test('prints only the header when there are no tabs', () => {
    expect(formatTabTable(snapshot([]))).toBe('TAB  WINDOW  GROUP  FLAGS  URL  TITLE')
  })
})
