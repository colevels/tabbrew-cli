import type { Snapshot, TabSnapshot } from '../operators/contract'
import { cell, clip, domain, renderTable, TITLE_MAX } from '../table'

// TITLE last: it is the widest and most variable field.
const COLUMNS = ['TAB', 'WINDOW', 'GROUP', 'FLAGS', 'URL', 'TITLE'] as const

const flags = (tab: TabSnapshot): string => {
  const set = [
    tab.active && 'active',
    tab.pinned && 'pinned',
    tab.audible && 'audible',
    tab.muted && 'muted',
    tab.discarded && 'discarded',
    tab.status === 'loading' && 'loading',
  ].filter((flag): flag is string => typeof flag === 'string')
  return set.length ? set.join(',') : '-'
}

const row = (tab: TabSnapshot, windowLabel: Map<number, string>): string[] => [
  String(tab.id),
  windowLabel.get(tab.windowId) ?? String(tab.windowId),
  tab.groupId === -1 ? '-' : String(tab.groupId),
  flags(tab),
  cell(domain(tab.url)),
  clip(cell(tab.title), TITLE_MAX),
]

const byPlace = (a: TabSnapshot, b: TabSnapshot): number =>
  a.windowId - b.windowId || a.index - b.index

export function formatTabTable(snapshot: Snapshot): string {
  const windowLabel = new Map(
    snapshot.windows.flatMap((window) =>
      window.label === undefined ? [] : [[window.id, window.label] as const],
    ),
  )
  return renderTable(
    COLUMNS,
    [...snapshot.tabs].sort(byPlace).map((tab) => row(tab, windowLabel)),
  )
}
