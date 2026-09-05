// The contract between the CLI and the extension's operator module, in a form
// that runs in the browser as well as in Bun: no node imports, no wxt types.

export type GroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange'

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'locked-fullscreen'

export type TabStatus = 'unloaded' | 'loading' | 'complete'

export interface WindowSnapshot {
  id: number
  focused: boolean
  incognito: boolean
  state?: WindowState
}

export interface GroupSnapshot {
  id: number
  windowId: number
  title: string
  color: GroupColor
  collapsed: boolean
}

export interface TabSnapshot {
  id: number
  windowId: number
  index: number
  url: string
  title: string
  pinned: boolean
  audible: boolean
  muted: boolean
  discarded: boolean
  active: boolean
  status?: TabStatus
  // -1 when ungrouped, as Chrome reports it; the CLI decides what -1 means.
  groupId: number
  // Absent before Chrome 121, and absent is not zero: a tab that cannot answer
  // a seen: question must not look ancient.
  lastAccessed?: number
}

export interface BrowserSnapshot {
  takenAt: number
  windows: WindowSnapshot[]
  groups: GroupSnapshot[]
  tabs: TabSnapshot[]
}

export type TabIds = [number, ...number[]]

export interface TabChanges {
  pinned?: boolean
  muted?: boolean
  url?: string
}

export interface TabPlacement {
  tabId: number
  windowId: number
  index: number
}

// Join an existing group or create one in a named window, never neither:
// without a window Chrome creates the group in the caller's window and moves
// the tabs there.
export type GroupTarget =
  | { groupId: number; windowId?: never }
  | { windowId: number; groupId?: never }

export interface OperatorMap {
  readSnapshot: { input: Record<string, never>; output: BrowserSnapshot }
  closeTabs: { input: { tabIds: TabIds }; output: { tabIds: number[] } }
  updateTab: {
    input: { tabId: number; changes: TabChanges }
    output: { tabId: number; index?: number }
  }
  moveTabs: {
    input: { tabIds: TabIds; index: number; windowId?: number }
    output: { tabs: TabPlacement[] }
  }
  groupTabs: { input: { tabIds: TabIds } & GroupTarget; output: { groupId: number } }
  ungroupTabs: { input: { tabIds: TabIds }; output: { tabIds: number[] } }
  updateGroup: {
    input: { groupId: number; title?: string; color?: GroupColor; collapsed?: boolean }
    output: { groupId: number; title?: string; color?: GroupColor }
  }
  discardTab: {
    input: { tabId: number }
    output: { tabId: number; previousTabId: number; changed: boolean }
  }
  focusTab: { input: { tabId: number }; output: { tabId: number; windowId: number } }
  createWindow: {
    input: { urls: string[]; focused: boolean }
    output: { windowId?: number; focused: boolean; tabs: { tabId: number; url: string }[] }
  }
  createTab: {
    input: { url: string; windowId?: number; index?: number; active?: boolean }
    output: { tabId: number; windowId: number; index: number; url: string }
  }
}

export type OperatorName = keyof OperatorMap
export type OperatorInput<N extends OperatorName> = OperatorMap[N]['input']
export type OperatorOutput<N extends OperatorName> = OperatorMap[N]['output']

export type Operators = {
  [N in OperatorName]: (input: OperatorInput<N>) => Promise<OperatorOutput<N>>
}
