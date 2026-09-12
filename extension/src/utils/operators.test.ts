import { describe, expect, test } from 'bun:test'
import { type Browser, browser } from 'wxt/browser'
import type { OperatorInput } from '../../../src/core/operators/contract'
import { type ChromeApi, createOperators } from './operators'

// The panel hands `browser` in; keep it assignable.
const _panelChrome: ChromeApi = browser

const aTab = (overrides: Partial<Browser.tabs.Tab> = {}): Browser.tabs.Tab => ({
  id: 1,
  windowId: 10,
  index: 0,
  url: 'https://a.example/',
  title: 'A',
  pinned: false,
  active: false,
  highlighted: false,
  selected: false,
  incognito: false,
  discarded: false,
  autoDiscardable: true,
  frozen: false,
  groupId: -1,
  lastAccessed: 1_000,
  ...overrides,
})

const aWindow = (overrides: Partial<Browser.windows.Window> = {}): Browser.windows.Window => ({
  id: 10,
  focused: false,
  alwaysOnTop: false,
  incognito: false,
  state: 'normal',
  ...overrides,
})

const aGroup = (
  overrides: Partial<Browser.tabGroups.TabGroup> = {},
): Browser.tabGroups.TabGroup => ({
  id: 100,
  windowId: 10,
  title: 'Docs',
  color: 'blue',
  collapsed: false,
  shared: false,
  ...overrides,
})

type Call = [method: string, ...args: unknown[]]
type FakeChrome = ChromeApi & { calls: Call[] }
type Overrides = { [N in keyof ChromeApi]?: Partial<ChromeApi[N]> }

const defaults = (): ChromeApi => ({
  windows: {
    getAll: async () => [aWindow()],
    getLastFocused: async () => aWindow(),
    update: async (windowId) => aWindow({ id: windowId, focused: true }),
    create: async (data) => aWindow({ id: 20, focused: !!data.focused, tabs: [] }),
    remove: async () => {},
  },
  tabGroups: {
    query: async () => [],
    move: async (groupId, properties) => aGroup({ id: groupId, windowId: properties.windowId }),
    update: async (groupId, properties) =>
      aGroup({
        id: groupId,
        title: properties.title,
        color: properties.color ?? 'blue',
        collapsed: properties.collapsed ?? false,
      }),
  },
  tabs: {
    query: async () => [aTab()],
    remove: async () => {},
    update: async (tabId, properties) =>
      aTab({ id: tabId, index: 3, pinned: !!properties.pinned, active: !!properties.active }),
    move: async (tabIds, properties) =>
      tabIds.map((id, offset) =>
        aTab({ id, index: properties.index + offset, windowId: properties.windowId ?? 10 }),
      ),
    group: async () => 100,
    ungroup: async () => {},
    discard: async (tabId) => aTab({ id: tabId + 1000, discarded: true }),
    reload: async () => {},
    create: async (properties) =>
      aTab({
        id: 50,
        url: properties.url,
        windowId: properties.windowId ?? 10,
        index: properties.index ?? 0,
        active: !!properties.active,
      }),
  },
})

// Every method records its call, so a test can assert what reached Chrome and
// in what order.
const fakeChrome = (overrides: Overrides = {}): FakeChrome => {
  const calls: Call[] = []
  const recording = <T extends object>(namespace: string, methods: T): T => {
    const wrapped: Record<string, unknown> = {}
    for (const [name, method] of Object.entries(methods)) {
      wrapped[name] = (...args: unknown[]) => {
        calls.push([`${namespace}.${name}`, ...args])
        return (method as (...args: unknown[]) => unknown)(...args)
      }
    }
    return wrapped as T
  }
  const base = defaults()
  return {
    calls,
    windows: recording('windows', { ...base.windows, ...overrides.windows }),
    tabGroups: recording('tabGroups', { ...base.tabGroups, ...overrides.tabGroups }),
    tabs: recording('tabs', { ...base.tabs, ...overrides.tabs }),
  }
}

const focusedWindowId = async (chrome: ChromeApi): Promise<number | undefined> =>
  (await createOperators(chrome).readSnapshot({})).windows.find((w) => w.focused)?.id

describe('readSnapshot', () => {
  test('the focused window wins', async () => {
    const chrome = fakeChrome({
      windows: {
        getAll: async () => [aWindow({ id: 1 }), aWindow({ id: 2, focused: true })],
        getLastFocused: async () => aWindow({ id: 1 }),
      },
    })
    const { windows } = await createOperators(chrome).readSnapshot({})
    expect(windows.map((w) => [w.id, w.focused])).toEqual([
      [1, false],
      [2, true],
    ])
  })

  test('falls back to the last focused window, then to the first', async () => {
    const twoUnfocused = async () => [aWindow({ id: 1 }), aWindow({ id: 2 })]
    const lastFocused = fakeChrome({
      windows: { getAll: twoUnfocused, getLastFocused: async () => aWindow({ id: 2 }) },
    })
    expect(await focusedWindowId(lastFocused)).toBe(2)

    const noneFocused = fakeChrome({
      windows: {
        getAll: twoUnfocused,
        getLastFocused: async () => {
          throw new Error('no window')
        },
      },
    })
    expect(await focusedWindowId(noneFocused)).toBe(1)
  })

  test('no windows is an empty answer, not an error', async () => {
    const chrome = fakeChrome({
      windows: {
        getAll: async () => [],
        getLastFocused: async () => {
          throw new Error('no window')
        },
      },
      tabs: { query: async () => [] },
    })
    expect(await createOperators(chrome).readSnapshot({})).toMatchObject({
      windows: [],
      groups: [],
      tabs: [],
    })
  })

  test('passes groupId -1 through, keeps a missing lastAccessed undefined, reads pendingUrl', async () => {
    const chrome = fakeChrome({
      tabs: {
        query: async () => [
          aTab({
            id: 7,
            groupId: -1,
            lastAccessed: undefined,
            url: '',
            pendingUrl: 'https://p.example/',
          }),
        ],
      },
    })
    const [tab] = (await createOperators(chrome).readSnapshot({})).tabs
    expect(tab).toMatchObject({ id: 7, groupId: -1, url: 'https://p.example/' })
    expect(tab?.lastAccessed).toBeUndefined()
  })

  test('maps groups and windows, with an untitled group as an empty title', async () => {
    const chrome = fakeChrome({
      windows: {
        getAll: async () => [aWindow({ id: 1, incognito: true, state: 'minimized' })],
        getLastFocused: async () => aWindow({ id: 1 }),
      },
      tabGroups: { query: async () => [aGroup({ id: 5, title: undefined, color: 'red' })] },
    })
    const { windows, groups } = await createOperators(chrome).readSnapshot({})
    expect(windows).toEqual([{ id: 1, focused: true, incognito: true, state: 'minimized' }])
    expect(groups).toEqual([{ id: 5, windowId: 10, title: '', color: 'red', collapsed: false }])
  })

  test('skips a tab without an id and reads each source once', async () => {
    const chrome = fakeChrome({
      tabs: { query: async () => [aTab({ id: undefined }), aTab({ id: 8 })] },
    })
    const { tabs } = await createOperators(chrome).readSnapshot({})
    expect(tabs.map((t) => t.id)).toEqual([8])
    expect(chrome.calls.map(([method]) => method).sort()).toEqual([
      'tabGroups.query',
      'tabs.query',
      'windows.getAll',
      'windows.getLastFocused',
    ])
  })
})

describe('closeTabs', () => {
  test('removes the whole set in one call', async () => {
    const chrome = fakeChrome()
    expect(await createOperators(chrome).closeTabs({ tabIds: [1, 2, 3] })).toEqual({
      tabIds: [1, 2, 3],
    })
    expect(chrome.calls).toEqual([['tabs.remove', [1, 2, 3]]])
  })
})

describe('updateTab', () => {
  test('forwards the changes and reports the new index', async () => {
    const chrome = fakeChrome({
      tabs: { update: async (tabId) => aTab({ id: tabId, index: 4 }) },
    })
    expect(
      await createOperators(chrome).updateTab({ tabId: 7, changes: { pinned: true } }),
    ).toEqual({
      tabId: 7,
      index: 4,
    })
    expect(chrome.calls).toStrictEqual([['tabs.update', 7, { pinned: true }]])
  })

  test('echoes the tabId when Chrome returns nothing', async () => {
    const chrome = fakeChrome({ tabs: { update: async () => undefined } })
    expect(await createOperators(chrome).updateTab({ tabId: 7, changes: { muted: true } })).toEqual(
      {
        tabId: 7,
      },
    )
  })
})

describe('moveTabs', () => {
  test('forwards index and window and returns where the tabs landed', async () => {
    const chrome = fakeChrome()
    const { tabs } = await createOperators(chrome).moveTabs({
      tabIds: [1, 2],
      index: 3,
      windowId: 20,
    })
    expect(chrome.calls).toStrictEqual([['tabs.move', [1, 2], { index: 3, windowId: 20 }]])
    expect(tabs).toEqual([
      { tabId: 1, windowId: 20, index: 3 },
      { tabId: 2, windowId: 20, index: 4 },
    ])
  })

  test('leaves windowId out when it was not given', async () => {
    const chrome = fakeChrome()
    await createOperators(chrome).moveTabs({ tabIds: [1], index: 0 })
    expect(chrome.calls).toStrictEqual([['tabs.move', [1], { index: 0 }]])
  })
})

describe('groupTabs', () => {
  test('refuses to group without a window or an existing group', async () => {
    const chrome = fakeChrome()
    // Wire input is JSON; the type cannot stop this shape from arriving.
    const input = JSON.parse('{"tabIds":[1]}') as OperatorInput<'groupTabs'>
    await expect(createOperators(chrome).groupTabs(input)).rejects.toThrow('windowId')
    expect(chrome.calls).toEqual([])
  })

  test('creates the group in the named window', async () => {
    const chrome = fakeChrome()
    expect(await createOperators(chrome).groupTabs({ tabIds: [1, 2], windowId: 10 })).toEqual({
      groupId: 100,
    })
    expect(chrome.calls).toStrictEqual([
      ['tabs.group', { tabIds: [1, 2], createProperties: { windowId: 10 } }],
    ])
  })

  test('joins an existing group without createProperties', async () => {
    const chrome = fakeChrome()
    await createOperators(chrome).groupTabs({ tabIds: [1], groupId: 5 })
    expect(chrome.calls).toStrictEqual([['tabs.group', { tabIds: [1], groupId: 5 }]])
  })
})

describe('ungroupTabs', () => {
  test('passes the list through', async () => {
    const chrome = fakeChrome()
    expect(await createOperators(chrome).ungroupTabs({ tabIds: [1, 2] })).toEqual({
      tabIds: [1, 2],
    })
    expect(chrome.calls).toEqual([['tabs.ungroup', [1, 2]]])
  })

  test('rejects an empty list before Chrome sees it', async () => {
    const chrome = fakeChrome()
    const input = JSON.parse('{"tabIds":[]}') as OperatorInput<'ungroupTabs'>
    await expect(createOperators(chrome).ungroupTabs(input)).rejects.toThrow('at least one')
    expect(chrome.calls).toEqual([])
  })
})

describe('updateGroup', () => {
  test('forwards only the fields given and echoes the updated group', async () => {
    const chrome = fakeChrome()
    const result = await createOperators(chrome).updateGroup({
      groupId: 100,
      title: 'Reading',
      color: 'red',
    })
    expect(chrome.calls).toStrictEqual([
      ['tabGroups.update', 100, { title: 'Reading', color: 'red' }],
    ])
    expect(result).toEqual({ groupId: 100, title: 'Reading', color: 'red' })
  })
})

describe('closeGroup', () => {
  const grouped = async () => [aTab({ id: 1, groupId: 100 }), aTab({ id: 2, groupId: 100 })]

  test('moves the group into a scratch window and closes that window', async () => {
    const chrome = fakeChrome({ tabs: { query: grouped } })
    const result = await createOperators(chrome).closeGroup({ groupId: 100 })
    expect(chrome.calls).toStrictEqual([
      ['tabs.query', { groupId: 100 }],
      ['windows.create', { focused: false }],
      ['tabGroups.move', 100, { windowId: 20, index: -1 }],
      ['windows.remove', 20],
    ])
    expect(result).toEqual({ groupId: 100, tabIds: [1, 2] })
  })

  test('refuses an empty group before opening a window', async () => {
    const chrome = fakeChrome({ tabs: { query: async () => [] } })
    await expect(createOperators(chrome).closeGroup({ groupId: 100 })).rejects.toThrow(
      'No group with id: 100',
    )
    expect(chrome.calls).toStrictEqual([['tabs.query', { groupId: 100 }]])
  })

  test('closes the scratch window even when the move fails', async () => {
    const chrome = fakeChrome({
      tabs: { query: grouped },
      tabGroups: {
        move: async () => {
          throw new Error('cannot move')
        },
      },
    })
    await expect(createOperators(chrome).closeGroup({ groupId: 100 })).rejects.toThrow(
      'cannot move',
    )
    expect(chrome.calls.at(-1)).toEqual(['windows.remove', 20])
  })
})

describe('discardTab', () => {
  test('reports the replacement id', async () => {
    const chrome = fakeChrome()
    expect(await createOperators(chrome).discardTab({ tabId: 7 })).toEqual({
      tabId: 1007,
      previousTabId: 7,
      changed: true,
    })
  })

  test('reports no change when Chrome returns nothing', async () => {
    const chrome = fakeChrome({ tabs: { discard: async () => undefined } })
    expect(await createOperators(chrome).discardTab({ tabId: 7 })).toEqual({
      tabId: 7,
      previousTabId: 7,
      changed: false,
    })
  })
})

describe('reloadTab', () => {
  test('reloads the tab and sends bypassCache explicitly', async () => {
    const chrome = fakeChrome()
    expect(await createOperators(chrome).reloadTab({ tabId: 7 })).toEqual({ tabId: 7 })
    expect(chrome.calls).toEqual([['tabs.reload', 7, { bypassCache: false }]])
  })

  test('passes bypassCache through', async () => {
    const chrome = fakeChrome()
    await createOperators(chrome).reloadTab({ tabId: 7, bypassCache: true })
    expect(chrome.calls).toEqual([['tabs.reload', 7, { bypassCache: true }]])
  })
})

describe('focusTab', () => {
  test('activates the tab, then raises its window', async () => {
    const chrome = fakeChrome({
      tabs: { update: async (tabId) => aTab({ id: tabId, windowId: 30, active: true }) },
    })
    expect(await createOperators(chrome).focusTab({ tabId: 7 })).toEqual({ tabId: 7, windowId: 30 })
    expect(chrome.calls).toEqual([
      ['tabs.update', 7, { active: true }],
      ['windows.update', 30, { focused: true }],
    ])
  })

  test('rejects when the tab is gone and touches no window', async () => {
    const chrome = fakeChrome({ tabs: { update: async () => undefined } })
    await expect(createOperators(chrome).focusTab({ tabId: 7 })).rejects.toThrow('not found')
    expect(chrome.calls).toEqual([['tabs.update', 7, { active: true }]])
  })
})

describe('createWindow', () => {
  test('sends no url for an empty list, and focused explicitly', async () => {
    const chrome = fakeChrome()
    await createOperators(chrome).createWindow({ urls: [], focused: false })
    expect(chrome.calls).toStrictEqual([['windows.create', { focused: false }]])
  })

  test('reports what Chrome did, not what was asked', async () => {
    const chrome = fakeChrome({
      windows: {
        create: async () =>
          aWindow({
            id: 20,
            focused: false,
            tabs: [
              aTab({ id: 21, url: '', pendingUrl: 'https://a.example/' }),
              aTab({ id: 22, url: 'https://b.example/' }),
            ],
          }),
      },
    })
    const result = await createOperators(chrome).createWindow({ urls: ['a', 'b'], focused: true })
    expect(chrome.calls).toStrictEqual([['windows.create', { url: ['a', 'b'], focused: true }]])
    expect(result).toEqual({
      windowId: 20,
      focused: false,
      tabs: [
        { tabId: 21, url: 'https://a.example/' },
        { tabId: 22, url: 'https://b.example/' },
      ],
    })
  })
})

describe('createTab', () => {
  test('is inactive unless asked, and sends only the keys given', async () => {
    const chrome = fakeChrome()
    await createOperators(chrome).createTab({ url: 'https://a.example/' })
    expect(chrome.calls).toStrictEqual([
      ['tabs.create', { url: 'https://a.example/', active: false }],
    ])
  })

  test('returns the tab as Chrome placed it', async () => {
    const chrome = fakeChrome({
      tabs: {
        create: async () => aTab({ id: 50, windowId: 20, index: 2, url: 'https://a.example/' }),
      },
    })
    const result = await createOperators(chrome).createTab({
      url: 'https://a.example/',
      windowId: 20,
      index: 2,
      active: true,
    })
    expect(chrome.calls).toStrictEqual([
      ['tabs.create', { url: 'https://a.example/', windowId: 20, index: 2, active: true }],
    ])
    expect(result).toEqual({ tabId: 50, windowId: 20, index: 2, url: 'https://a.example/' })
  })
})
