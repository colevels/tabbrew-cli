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

const row = (tab: TabSnapshot): string[] => [
  String(tab.id),
  String(tab.windowId),
  tab.groupId === -1 ? '-' : String(tab.groupId),
  flags(tab),
  cell(domain(tab.url)),
  clip(cell(tab.title), TITLE_MAX),
]

const byPlace = (a: TabSnapshot, b: TabSnapshot): number =>
  a.windowId - b.windowId || a.index - b.index

export const formatTabTable = (snapshot: Snapshot): string =>
  renderTable(COLUMNS, [...snapshot.tabs].sort(byPlace).map(row))
