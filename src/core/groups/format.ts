import type { GroupColor, Snapshot } from '../operators/contract'
import { cell, clip, renderTable, TITLE_MAX } from '../table'

export interface GroupSummary {
  id: number
  windowId: number
  windowLabel: string
  title: string
  color: GroupColor
  collapsed: boolean
  tabCount: number
}

// TITLE last: it is the widest and most variable field.
const COLUMNS = ['GROUP', 'WINDOW', 'TABS', 'COLOR', 'FLAGS', 'TITLE'] as const

// Chrome drops a group once its last tab leaves, so an empty group only exists
// in tests; the id tiebreak keeps that case deterministic.
export function summarizeGroups(snapshot: Snapshot): GroupSummary[] {
  const windowLabel = new Map(
    snapshot.windows.flatMap((window) =>
      window.label === undefined ? [] : [[window.id, window.label] as const],
    ),
  )
  return snapshot.groups
    .map((group) => {
      const tabs = snapshot.tabs.filter((tab) => tab.groupId === group.id)
      return {
        summary: {
          id: group.id,
          windowId: group.windowId,
          windowLabel: windowLabel.get(group.windowId) ?? String(group.windowId),
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
          tabCount: tabs.length,
        },
        firstIndex: Math.min(...tabs.map((tab) => tab.index)),
      }
    })
    .sort(
      (a, b) =>
        a.summary.windowId - b.summary.windowId ||
        a.firstIndex - b.firstIndex ||
        a.summary.id - b.summary.id,
    )
    .map(({ summary }) => summary)
}

const flags = (group: GroupSummary): string => (group.collapsed ? 'collapsed' : '-')

export function formatGroupTable(snapshot: Snapshot): string {
  const rows = summarizeGroups(snapshot).map((group) => [
    String(group.id),
    group.windowLabel,
    String(group.tabCount),
    group.color,
    flags(group),
    clip(cell(group.title), TITLE_MAX),
  ])
  return renderTable(COLUMNS, rows)
}
