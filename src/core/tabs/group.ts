import type { OperatorInput, Snapshot, TabIds } from '../operators/contract'

export type GroupPlan =
  | { ok: true; input: OperatorInput<'groupTabs'> }
  | { ok: false; message: string }

export function planGroup(
  snapshot: Snapshot,
  tabIds: TabIds,
  explicit: { groupId?: number; windowId?: number },
): GroupPlan {
  for (const tabId of tabIds) {
    if (!snapshot.tabs.some((tab) => tab.id === tabId)) {
      return { ok: false, message: `no tab ${tabId}; run "tabbrew tabs list"` }
    }
  }
  if (explicit.groupId !== undefined) {
    if (!snapshot.groups.some((group) => group.id === explicit.groupId)) {
      return { ok: false, message: `no group ${explicit.groupId}; run "tabbrew groups list"` }
    }
    return { ok: true, input: { tabIds, groupId: explicit.groupId } }
  }
  if (explicit.windowId !== undefined) {
    if (!snapshot.windows.some((window) => window.id === explicit.windowId)) {
      return { ok: false, message: `no window ${explicit.windowId}; run "tabbrew windows list"` }
    }
    return { ok: true, input: { tabIds, windowId: explicit.windowId } }
  }
  // Neither given: group in place, alongside the first tab (already validated above).
  const windowId = snapshot.tabs.find((tab) => tab.id === tabIds[0])?.windowId as number
  return { ok: true, input: { tabIds, windowId } }
}
