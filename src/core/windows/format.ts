import type { Snapshot, TabSnapshot, WindowState } from '../operators/contract'
import { cell, clip, domain, renderTable, TITLE_MAX } from '../table'

export interface WindowSummary {
  id: number
  focused: boolean
  incognito: boolean
  state?: WindowState
  tabCount: number
  groupCount: number
  activeTabId?: number
}

// ACTIVE last: it carries the active tab's title, the widest field.
const COLUMNS = ['WINDOW', 'TABS', 'GROUPS', 'FLAGS', 'ACTIVE'] as const

export function summarizeWindows(snapshot: Snapshot): WindowSummary[] {
  return [...snapshot.windows]
    .sort((a, b) => a.id - b.id)
    .map((window) => {
      const tabs = snapshot.tabs.filter((tab) => tab.windowId === window.id)
      const activeTabId = tabs.find((tab) => tab.active)?.id
      return {
        id: window.id,
        focused: window.focused,
        incognito: window.incognito,
        ...(window.state === undefined ? {} : { state: window.state }),
        tabCount: tabs.length,
        groupCount: snapshot.groups.filter((group) => group.windowId === window.id).length,
        ...(activeTabId === undefined ? {} : { activeTabId }),
      }
    })
}

// `normal` is the state every ordinary window has; printing it would make the
// column noise and hide the ones that matter.
const flags = (window: WindowSummary): string => {
  const set = [
    window.focused && 'focused',
    window.incognito && 'incognito',
    window.state !== undefined && window.state !== 'normal' && window.state,
  ].filter((flag): flag is string => typeof flag === 'string')
  return set.length ? set.join(',') : '-'
}

const active = (tab: TabSnapshot | undefined): string =>
  tab ? `${cell(domain(tab.url))}  ${clip(cell(tab.title), TITLE_MAX)}` : '-'

export function formatWindowTable(snapshot: Snapshot): string {
  const rows = summarizeWindows(snapshot).map((window) => [
    String(window.id),
    String(window.tabCount),
    String(window.groupCount),
    flags(window),
    active(snapshot.tabs.find((tab) => tab.id === window.activeTabId)),
  ])
  return renderTable(COLUMNS, rows)
}
