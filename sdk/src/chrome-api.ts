// The slice of chrome.* the operators use, in promise form.
//
// Structural and deliberately loose: `chrome` typed by any @types/chrome, and
// `browser` from wxt, both have to fit without a cast, and a test can hand in a
// plain object. Strings Chrome may widen later (status, color, state) are read
// as strings here and narrowed where the operators build the contract's shapes.

import type { GroupColor, TabIds } from '../../src/core/operators/contract'

export interface ChromeTab {
  id?: number
  windowId: number
  index: number
  url?: string
  pendingUrl?: string
  title?: string
  pinned: boolean
  audible?: boolean
  mutedInfo?: { muted: boolean }
  discarded: boolean
  active: boolean
  status?: string
  groupId: number
  // Chrome 121; older typings and older browsers leave it out.
  lastAccessed?: number
}

export interface ChromeWindow {
  id?: number
  focused: boolean
  incognito: boolean
  state?: string
  tabs?: ChromeTab[]
}

export interface ChromeTabGroup {
  id: number
  windowId: number
  title?: string
  color: string
  collapsed: boolean
}

export interface ChromeApi {
  windows: {
    getAll(): Promise<ChromeWindow[]>
    getLastFocused(): Promise<ChromeWindow>
    update(windowId: number, info: { focused: boolean }): Promise<ChromeWindow | undefined>
    create(data: { url?: string[]; focused: boolean }): Promise<ChromeWindow | undefined>
    remove(windowId: number): Promise<void>
  }
  tabGroups: {
    query(info: object): Promise<ChromeTabGroup[]>
    update(
      groupId: number,
      properties: { title?: string; color?: GroupColor; collapsed?: boolean },
    ): Promise<ChromeTabGroup | undefined>
    move(
      groupId: number,
      properties: { windowId: number; index: number },
    ): Promise<ChromeTabGroup | undefined>
  }
  tabs: {
    query(info: { groupId?: number }): Promise<ChromeTab[]>
    remove(tabIds: number[]): Promise<void>
    update(
      tabId: number,
      properties: { pinned?: boolean; muted?: boolean; url?: string; active?: boolean },
    ): Promise<ChromeTab | undefined>
    // Chrome answers a one-id list with a single Tab, not a list of one.
    move(
      tabIds: number[],
      properties: { index: number; windowId?: number },
    ): Promise<ChromeTab | ChromeTab[]>
    group(options: {
      tabIds: TabIds
      groupId?: number
      createProperties?: { windowId?: number }
    }): Promise<number>
    ungroup(tabIds: TabIds): Promise<void>
    discard(tabId: number): Promise<ChromeTab | undefined>
    reload(tabId: number, properties: { bypassCache?: boolean }): Promise<void>
    create(properties: {
      url?: string
      windowId?: number
      index?: number
      active?: boolean
    }): Promise<ChromeTab>
  }
}
