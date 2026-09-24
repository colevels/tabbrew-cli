import { describe, expect, test } from 'bun:test'
import type { GroupSnapshot, Snapshot, TabSnapshot } from '../operators/contract'
import { findGrouped } from './group'

const tab = (id: number, groupId: number, windowId = 1842): TabSnapshot => ({
  id,
  windowId,
  index: 0,
  url: '',
  title: '',
  pinned: false,
  audible: false,
  muted: false,
  discarded: false,
  active: false,
  groupId,
})

const group = (id: number, windowId = 1842): GroupSnapshot => ({
  id,
  windowId,
  title: '',
  color: 'grey',
  collapsed: false,
})

const snapshot = (groups: GroupSnapshot[], tabs: TabSnapshot[]): Snapshot => ({
  takenAt: 0,
  windows: [],
  groups,
  tabs,
})

const before = snapshot([group(7)], [tab(1, 7), tab(2, 7), tab(3, -1)])

describe('findGrouped', () => {
  test('finds the group Chrome created in the window after all', () => {
    const after = snapshot([group(7), group(9)], [tab(1, 9), tab(2, 9), tab(3, -1)])
    expect(findGrouped(before, after, { tabIds: [1, 2], windowId: 1842 })).toBe(9)
  })

  test('finds the existing group the tabs joined after all', () => {
    const after = snapshot([group(7)], [tab(1, 7), tab(2, 7), tab(3, 7)])
    expect(findGrouped(before, after, { tabIds: [3], groupId: 7 })).toBe(7)
  })

  test('finds nothing while any tab is outside the group', () => {
    const after = snapshot([group(7), group(9)], [tab(1, 9), tab(2, 7), tab(3, -1)])
    expect(findGrouped(before, after, { tabIds: [1, 2], windowId: 1842 })).toBeUndefined()
    expect(findGrouped(before, before, { tabIds: [3], groupId: 7 })).toBeUndefined()
  })

  test('takes a group that was already there for no new group', () => {
    expect(findGrouped(before, before, { tabIds: [1, 2], windowId: 1842 })).toBeUndefined()
  })

  test('takes a new group in another window for no group in this one', () => {
    const after = snapshot([group(7), group(9, 1843)], [tab(1, 9, 1843), tab(2, 9, 1843)])
    expect(findGrouped(before, after, { tabIds: [1, 2], windowId: 1842 })).toBeUndefined()
  })

  test('finds nothing when a tab is gone', () => {
    const after = snapshot([group(7), group(9)], [tab(1, 9)])
    expect(findGrouped(before, after, { tabIds: [1, 2], windowId: 1842 })).toBeUndefined()
  })
})
