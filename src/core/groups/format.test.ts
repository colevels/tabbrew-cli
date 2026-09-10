import { describe, expect, test } from 'bun:test'
import type { GroupSnapshot, Snapshot, TabSnapshot, WindowSnapshot } from '../operators/contract'
import { formatGroupTable, summarizeGroups } from './format'

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

const group = (
  overrides: Pick<GroupSnapshot, 'id' | 'windowId'> & Partial<GroupSnapshot>,
): GroupSnapshot => ({
  title: '',
  color: 'grey',
  collapsed: false,
  ...overrides,
})

const snapshot = (
  windows: WindowSnapshot[],
  groups: GroupSnapshot[] = [],
  tabs: TabSnapshot[] = [],
): Snapshot => ({ takenAt: 0, windows, groups, tabs })

const lines = (table: string) => table.split('\n')

describe('summarizeGroups', () => {
  test('counts tabs, resolves the window label and orders by window then tab strip position', () => {
    const summary = summarizeGroups(
      snapshot(
        [window({ id: 1842, label: 'A' }), window({ id: 1843, label: 'B' })],
        [
          group({ id: 9, windowId: 1843, title: 'Reading', color: 'red', collapsed: true }),
          group({ id: 7, windowId: 1842, title: 'Work', color: 'blue' }),
          group({ id: 5, windowId: 1842, title: 'Later' }),
        ],
        [
          tab({ id: 1, windowId: 1842, index: 0, groupId: 5 }),
          tab({ id: 2, windowId: 1842, index: 1, groupId: -1 }),
          tab({ id: 3, windowId: 1842, index: 2, groupId: 7 }),
          tab({ id: 4, windowId: 1842, index: 3, groupId: 7 }),
          tab({ id: 5, windowId: 1843, index: 0, groupId: 9 }),
        ],
      ),
    )
    expect(summary).toEqual([
      {
        id: 5,
        windowId: 1842,
        windowLabel: 'A',
        title: 'Later',
        color: 'grey',
        collapsed: false,
        tabCount: 1,
      },
      {
        id: 7,
        windowId: 1842,
        windowLabel: 'A',
        title: 'Work',
        color: 'blue',
        collapsed: false,
        tabCount: 2,
      },
      {
        id: 9,
        windowId: 1843,
        windowLabel: 'B',
        title: 'Reading',
        color: 'red',
        collapsed: true,
        tabCount: 1,
      },
    ])
  })

  test('falls back to the window id when a session sent no label and orders empty groups by id', () => {
    const summary = summarizeGroups(
      snapshot(
        [window({ id: 1842 })],
        [group({ id: 9, windowId: 1842 }), group({ id: 7, windowId: 1842 })],
      ),
    )
    expect(summary.map((group) => [group.id, group.windowLabel, group.tabCount])).toEqual([
      [7, '1842', 0],
      [9, '1842', 0],
    ])
  })
})

describe('formatGroupTable', () => {
  test('lays groups out in a padded table with the title last', () => {
    const table = formatGroupTable(
      snapshot(
        [window({ id: 1842, label: 'A' })],
        [
          group({ id: 7, windowId: 1842, title: 'Work', color: 'blue' }),
          group({ id: 9, windowId: 1842, title: 'Reading', color: 'red', collapsed: true }),
        ],
        [
          tab({ id: 1, windowId: 1842, index: 0, groupId: 7 }),
          tab({ id: 2, windowId: 1842, index: 1, groupId: 9 }),
          tab({ id: 3, windowId: 1842, index: 2, groupId: 9 }),
          tab({ id: 4, windowId: 1842, index: 3, groupId: 9 }),
        ],
      ),
    )
    expect(table).toBe(
      [
        'GROUP  WINDOW  TABS  COLOR  FLAGS      TITLE',
        '7      A       1     blue   -          Work',
        '9      A       3     red    collapsed  Reading',
      ].join('\n'),
    )
    for (const line of lines(table)) expect(line).not.toMatch(/ $/)
  })

  test('shows an untitled group as -', () => {
    const [, first] = lines(
      formatGroupTable(snapshot([window({ id: 1 })], [group({ id: 1, windowId: 1 })])),
    )
    expect(first).toMatch(/^1\s+1\s+0\s+grey\s+-\s+-$/)
  })

  test('caps the title at 60 columns', () => {
    const table = formatGroupTable(
      snapshot([window({ id: 1 })], [group({ id: 1, windowId: 1, title: 'a'.repeat(100) })]),
    )
    expect(lines(table)[1]).toMatch(new RegExp(`\\s${'a'.repeat(59)}…$`))
  })

  test('prints only the header when there are no groups', () => {
    expect(formatGroupTable(snapshot([]))).toBe('GROUP  WINDOW  TABS  COLOR  FLAGS  TITLE')
  })
})
