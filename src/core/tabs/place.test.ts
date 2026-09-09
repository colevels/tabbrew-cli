import { describe, expect, test } from 'bun:test'
import type { Snapshot, TabSnapshot } from '../operators/contract'
import { planCreate, planMove } from './place'

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

const populated: Snapshot = {
  ...snapshot,
  windows: [
    { id: 1842, focused: true, incognito: false },
    { id: 1843, focused: false, incognito: false },
  ],
  groups: [{ id: 7, windowId: 1843, title: 'Work', color: 'blue', collapsed: false }],
}

describe('planCreate', () => {
  test('leaves the placement to Chrome when nothing is asked for', () => {
    expect(planCreate(populated, {})).toEqual({ ok: true, input: {} })
  })

  test('lands after or before an anchor, in the anchor window', () => {
    expect(planCreate(populated, { after: 1902 })).toEqual({
      ok: true,
      input: { windowId: 1842, index: 2 },
    })
    expect(planCreate(populated, { before: 1902 })).toEqual({
      ok: true,
      input: { windowId: 1842, index: 1 },
    })
  })

  test('opens in a named window, at its end', () => {
    expect(planCreate(populated, { windowId: 1843 })).toEqual({
      ok: true,
      input: { windowId: 1843 },
    })
  })

  test('opens in the group window when only a group is given', () => {
    expect(planCreate(populated, { groupId: 7 })).toEqual({
      ok: true,
      input: { windowId: 1843 },
      groupId: 7,
    })
  })

  test('keeps the anchor index when the group is in the same window', () => {
    expect(planCreate(populated, { after: 1950, groupId: 7 })).toEqual({
      ok: true,
      input: { windowId: 1843, index: 1 },
      groupId: 7,
    })
  })

  test('rejects a group that lives in another window', () => {
    expect(planCreate(populated, { windowId: 1842, groupId: 7 })).toEqual({
      ok: false,
      message: 'group 7 is in window 1843',
    })
    expect(planCreate(populated, { after: 1901, groupId: 7 })).toEqual({
      ok: false,
      message: 'group 7 is in window 1843',
    })
  })

  test('rejects an unknown anchor, window or group', () => {
    expect(planCreate(populated, { after: 1 })).toEqual({
      ok: false,
      message: 'no tab 1; run "tabbrew tabs list"',
    })
    expect(planCreate(populated, { windowId: 2 })).toEqual({
      ok: false,
      message: 'no window 2; run "tabbrew windows list"',
    })
    expect(planCreate(populated, { groupId: 3 })).toEqual({
      ok: false,
      message: 'no group 3; run "tabbrew groups list"',
    })
  })
})

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
