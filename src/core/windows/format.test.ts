import { describe, expect, test } from 'bun:test'
import type { GroupSnapshot, Snapshot, TabSnapshot, WindowSnapshot } from '../operators/contract'
import { formatWindowTable, summarizeWindows } from './format'

const tab = (
  overrides: Pick<TabSnapshot, 'id' | 'windowId'> & Partial<TabSnapshot>,
): TabSnapshot => ({
  index: 0,
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

const window = (
  overrides: Pick<WindowSnapshot, 'id'> & Partial<WindowSnapshot>,
): WindowSnapshot => ({
  focused: false,
  incognito: false,
  ...overrides,
})

const group = (id: number, windowId: number): GroupSnapshot => ({
  id,
  windowId,
  title: '',
  color: 'grey',
  collapsed: false,
})

const snapshot = (
  windows: WindowSnapshot[],
  tabs: TabSnapshot[] = [],
  groups: GroupSnapshot[] = [],
): Snapshot => ({ takenAt: 0, windows, groups, tabs })

const lines = (table: string) => table.split('\n')

describe('summarizeWindows', () => {
  test('counts tabs and groups per window and names the active tab, sorted by id', () => {
    const summary = summarizeWindows(
      snapshot(
        [window({ id: 1843 }), window({ id: 1842, focused: true, state: 'normal' })],
        [
          tab({ id: 1901, windowId: 1842, active: true }),
          tab({ id: 1903, windowId: 1842, index: 1 }),
          tab({ id: 1950, windowId: 1843 }),
        ],
        [group(7, 1842)],
      ),
    )
    expect(summary).toEqual([
      {
        id: 1842,
        focused: true,
        incognito: false,
        state: 'normal',
        tabCount: 2,
        groupCount: 1,
        activeTabId: 1901,
      },
      { id: 1843, focused: false, incognito: false, tabCount: 1, groupCount: 0 },
    ])
  })
})

describe('formatWindowTable', () => {
  test('lays windows out in a padded table with the active tab last', () => {
    const table = formatWindowTable(
      snapshot(
        [window({ id: 1842, focused: true, state: 'normal' }), window({ id: 1843 })],
        [
          tab({
            id: 1901,
            windowId: 1842,
            active: true,
            url: 'https://mail.google.com/',
            title: 'Inbox',
          }),
          tab({ id: 1903, windowId: 1842, index: 1, url: 'https://github.com/' }),
          tab({ id: 1950, windowId: 1843, url: 'chrome://newtab/', title: 'New Tab' }),
        ],
        [group(7, 1842)],
      ),
    )
    expect(table).toBe(
      [
        'WINDOW  TABS  GROUPS  FLAGS    ACTIVE',
        '1842    2     1       focused  mail.google.com  Inbox',
        '1843    1     0       -        -',
      ].join('\n'),
    )
    for (const line of lines(table)) expect(line).not.toMatch(/ $/)
  })

  test('lists the flags in a fixed order and hides a normal state', () => {
    const table = formatWindowTable(
      snapshot([
        window({ id: 1, focused: true, incognito: true, state: 'minimized' }),
        window({ id: 2, state: 'normal' }),
        window({ id: 3, state: 'locked-fullscreen' }),
      ]),
    )
    const [, first, second, third] = lines(table)
    expect(first).toContain('  focused,incognito,minimized  ')
    expect(second).toMatch(/^2\s+0\s+0\s+-\s+-$/)
    expect(third).toContain('  locked-fullscreen  ')
  })

  test('caps the active title at 60 columns', () => {
    const table = formatWindowTable(
      snapshot(
        [window({ id: 1 })],
        [tab({ id: 1, windowId: 1, active: true, url: 'u', title: 'a'.repeat(100) })],
      ),
    )
    expect(lines(table)[1]?.endsWith(`u  ${'a'.repeat(59)}…`)).toBe(true)
  })

  test('prints only the header when there are no windows', () => {
    expect(formatWindowTable(snapshot([]))).toBe('WINDOW  TABS  GROUPS  FLAGS  ACTIVE')
  })
})
