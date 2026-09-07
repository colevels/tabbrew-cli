import { describe, expect, test } from 'bun:test'
import type { Snapshot, TabSnapshot } from '../operators/contract'
import { planMove } from './place'

type Place = Pick<TabSnapshot, 'id' | 'windowId' | 'index'>

const tab = (overrides: Place): TabSnapshot => ({
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

const snapshot: Snapshot = {
  takenAt: 0,
  windows: [],
  groups: [],
  tabs: [
    tab({ id: 1901, windowId: 1842, index: 0 }),
    tab({ id: 1902, windowId: 1842, index: 1 }),
    tab({ id: 1903, windowId: 1842, index: 2 }),
    tab({ id: 1950, windowId: 1843, index: 0 }),
  ],
}

describe('planMove', () => {
  test('lands after an anchor in another window', () => {
    expect(planMove(snapshot, [1950], { after: 1901 })).toEqual({
      ok: true,
      input: { tabIds: [1950], index: 1, windowId: 1842 },
    })
  })

  test('lands before an anchor in another window', () => {
    expect(planMove(snapshot, [1950], { before: 1901 })).toEqual({
      ok: true,
      input: { tabIds: [1950], index: 0, windowId: 1842 },
    })
  })

  test('accounts for moved tabs that sit ahead of the anchor', () => {
    expect(planMove(snapshot, [1901], { after: 1903 })).toEqual({
      ok: true,
      input: { tabIds: [1901], index: 2, windowId: 1842 },
    })
    expect(planMove(snapshot, [1901, 1950], { before: 1903 })).toEqual({
      ok: true,
      input: { tabIds: [1901, 1950], index: 1, windowId: 1842 },
    })
  })

  test('leaves the index alone when the moved tab sits behind the anchor', () => {
    expect(planMove(snapshot, [1903], { after: 1901 })).toEqual({
      ok: true,
      input: { tabIds: [1903], index: 1, windowId: 1842 },
    })
  })

  test('rejects an unknown anchor or tab', () => {
    expect(planMove(snapshot, [1950], { after: 1 })).toEqual({
      ok: false,
      message: 'no tab 1; run "tabbrew tabs list"',
    })
    expect(planMove(snapshot, [2], { after: 1901 })).toEqual({
      ok: false,
      message: 'no tab 2; run "tabbrew tabs list"',
    })
  })
})
