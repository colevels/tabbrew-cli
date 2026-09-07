import { describe, expect, test } from 'bun:test'
import { createWindowLabels, windowLabel } from './labels'

describe('windowLabel', () => {
  test('counts like spreadsheet columns', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(windowLabel)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
  })
})

describe('createWindowLabels', () => {
  const snapshot = (...ids: number[]) => ({
    takenAt: 0,
    windows: ids.map((id) => ({ id, focused: false })),
    tabs: [],
  })
  const labelsOf = (output: unknown) =>
    (output as { windows: { id: number; label: string }[] }).windows.map((w) => [w.id, w.label])

  test('labels windows in id order on first sight', () => {
    const labels = createWindowLabels()
    expect(labelsOf(labels.stamp(snapshot(30, 10, 20)))).toEqual([
      [30, 'C'],
      [10, 'A'],
      [20, 'B'],
    ])
  })

  test('keeps labels across snapshots and never reuses one', () => {
    const labels = createWindowLabels()
    labels.stamp(snapshot(10, 20))
    expect(labelsOf(labels.stamp(snapshot(20, 30)))).toEqual([
      [20, 'B'],
      [30, 'C'],
    ])
    expect(labelsOf(labels.stamp(snapshot(10, 40)))).toEqual([
      [10, 'A'],
      [40, 'D'],
    ])
  })

  test('leaves the rest of the snapshot and non-snapshot outputs alone', () => {
    const labels = createWindowLabels()
    expect(labels.stamp(snapshot(1))).toMatchObject({ takenAt: 0, tabs: [] })
    for (const output of [null, 7, 'x', { tabIds: [1] }, { windows: [{ id: 'a' }] }]) {
      expect(labels.stamp(output)).toBe(output)
    }
  })
})
