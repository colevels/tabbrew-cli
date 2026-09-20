// operators -> chrome.*

import type {
  GroupColor,
  Operators,
  TabSnapshot,
  TabStatus,
  WindowState,
} from '../../src/core/operators/contract'
import type { ChromeApi, ChromeTab } from './chrome-api'

export type { Operators } from '../../src/core/operators/contract'

// An optional field the CLI left out must reach Chrome as absent, not as
// `key: undefined`.
const omitUndefined = <T extends object>(object: T): T => {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) kept[key] = value
  }
  return kept as T
}

const tabUrl = (tab: ChromeTab): string => tab.url || tab.pendingUrl || ''

const requireTabId = (tab: ChromeTab | undefined): number => {
  if (tab?.id === undefined) throw new Error('Chrome returned a tab without an id')
  return tab.id
}

const toTabSnapshot = (tab: ChromeTab, id: number): TabSnapshot => ({
  id,
  windowId: tab.windowId,
  index: tab.index,
  url: tabUrl(tab),
  title: tab.title ?? '',
  pinned: tab.pinned,
  audible: !!tab.audible,
  muted: !!tab.mutedInfo?.muted,
  discarded: tab.discarded,
  active: tab.active,
  // ChromeApi reads Chrome's unions as strings; what Chrome said goes through
  // as it is, a value newer than the contract included.
  status: tab.status as TabStatus | undefined,
  groupId: tab.groupId,
  lastAccessed: tab.lastAccessed,
})

export const createOperators = (chrome: ChromeApi): Operators => ({
  // One read, one instant, one answer: an overview that fetched windows and
  // groups in a second round trip would describe a different Chrome than the
  // tabs came from.
  readSnapshot: async () => {
    const [windows, groups, tabs, lastFocused] = await Promise.all([
      chrome.windows.getAll(),
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
      chrome.windows.getLastFocused().catch(() => undefined),
    ])
    // While the user is in the terminal Chrome is not the frontmost app and no
    // window reports focused, which would make window:current match nothing at
    // exactly the moment it is most likely to be used. Last focused is the
    // question the agent is actually asking.
    const focusedId = windows.find((w) => w.focused)?.id ?? lastFocused?.id ?? windows[0]?.id
    return {
      takenAt: Date.now(),
      // Windows and tabs without an id cannot be addressed by any operator.
      windows: windows.flatMap((w) =>
        w.id === undefined
          ? []
          : [
              {
                id: w.id,
                focused: w.id === focusedId,
                incognito: w.incognito,
                state: w.state as WindowState | undefined,
              },
            ],
      ),
      groups: groups.map((g) => ({
        id: g.id,
        windowId: g.windowId,
        title: g.title ?? '',
        color: g.color as GroupColor,
        collapsed: g.collapsed,
      })),
      tabs: tabs.flatMap((t) => (t.id === undefined ? [] : [toTabSnapshot(t, t.id)])),
    }
  },

  // One call for the whole set: closing one by one shifts the strip mid-batch
  // and leaves nobody able to say how many actually closed.
  closeTabs: async ({ tabIds }) => {
    await chrome.tabs.remove(tabIds)
    return { tabIds }
  },

  updateTab: async ({ tabId, changes }) => {
    const tab = await chrome.tabs.update(tabId, omitUndefined(changes))
    return { tabId: tab?.id ?? tabId, index: tab?.index }
  },

  // Chrome answers a one-id list with a single Tab, not a list of one.
  moveTabs: async ({ tabIds, index, windowId }) => {
    const moved = await chrome.tabs.move(tabIds, omitUndefined({ index, windowId }))
    return {
      tabs: (Array.isArray(moved) ? moved : [moved]).map((tab) => ({
        tabId: requireTabId(tab),
        windowId: tab.windowId,
        index: tab.index,
      })),
    }
  },

  // The one guard in this module. Without a window named, Chrome does not
  // group the tabs where they are: it creates the group in the caller's
  // window, which is the serving page's, and drags them there.
  groupTabs: async ({ tabIds, groupId, windowId }) => {
    if (groupId === undefined && windowId === undefined) {
      throw new Error(
        'groupTabs needs a windowId or an existing groupId: ' +
          "without one Chrome moves the tabs into the serving page's window",
      )
    }
    const target = groupId === undefined ? { createProperties: { windowId } } : { groupId }
    return { groupId: await chrome.tabs.group({ tabIds, ...target }) }
  },

  ungroupTabs: async ({ tabIds }) => {
    if (tabIds.length === 0) throw new Error('ungroupTabs needs at least one tabId')
    await chrome.tabs.ungroup(tabIds)
    return { tabIds }
  },

  updateGroup: async ({ groupId, title, color, collapsed }) => {
    const group = await chrome.tabGroups.update(groupId, omitUndefined({ title, color, collapsed }))
    return {
      groupId: group?.id ?? groupId,
      title: group?.title,
      color: group?.color as GroupColor | undefined,
    }
  },

  // Removing the tabs would drop the group from Chrome's saved groups; closing
  // a whole window keeps it saved on the profile. So the group is moved into a
  // scratch window and that window is closed, taking the group with it.
  closeGroup: async ({ groupId }) => {
    const tabIds = (await chrome.tabs.query({ groupId })).map(requireTabId)
    if (tabIds.length === 0) throw new Error(`No group with id: ${groupId}`)
    const scratch = await chrome.windows.create({ focused: false })
    if (scratch?.id === undefined) throw new Error('Chrome returned a window without an id')
    try {
      await chrome.tabGroups.move(groupId, { windowId: scratch.id, index: -1 })
    } finally {
      // A failed move must not leave the scratch window standing.
      await chrome.windows.remove(scratch.id)
    }
    return { groupId, tabIds }
  },

  // The one operator that destroys an id: Chrome replaces the tab, and
  // whatever runs next is still holding the old one.
  discardTab: async ({ tabId }) => {
    const tab = await chrome.tabs.discard(tabId)
    return {
      tabId: tab?.id ?? tabId,
      previousTabId: tabId,
      changed: tab?.id !== undefined && tab.id !== tabId,
    }
  },

  // bypassCache always travels explicitly, for the same reason createWindow
  // always sends focused.
  reloadTab: async ({ tabId, bypassCache = false }) => {
    await chrome.tabs.reload(tabId, { bypassCache })
    return { tabId }
  },

  // Selecting the tab inside its window is not enough when that window sits
  // behind three others.
  focusTab: async ({ tabId }) => {
    const tab = await chrome.tabs.update(tabId, { active: true })
    if (!tab) throw new Error(`tab ${tabId} not found`)
    await chrome.windows.update(tab.windowId, { focused: true })
    return { tabId: tab.id ?? tabId, windowId: tab.windowId }
  },

  // Every url in one call: a loop could leave a half-built window standing when
  // the third url is the bad one, and there is no verb yet to take it back.
  // `focused` always travels explicitly; Chrome defaults it to true, and a
  // default that differs from the CLI's is how "it opened behind everything"
  // becomes a bug nobody can locate.
  createWindow: async ({ urls, focused }) => {
    const created = await chrome.windows.create({ ...(urls.length ? { url: urls } : {}), focused })
    return {
      windowId: created?.id,
      // What Chrome did, not what was asked: Chrome itself may be behind
      // another application, and the tabs come back normalised.
      focused: !!created?.focused,
      tabs: (created?.tabs ?? []).map((tab) => ({ tabId: requireTabId(tab), url: tabUrl(tab) })),
    }
  },

  createTab: async ({ url, windowId, index, active = false }) => {
    // Without a windowId Chrome uses the caller's window: the one the serving
    // page happens to live in, which with a side panel host is arbitrary from
    // the CLI's point of view. The last-focused window is what the user means.
    const target = windowId ?? (await chrome.windows.getLastFocused()).id
    const tab = await chrome.tabs.create(omitUndefined({ url, windowId: target, index, active }))
    return { tabId: requireTabId(tab), windowId: tab.windowId, index: tab.index, url: tabUrl(tab) }
  },
})
