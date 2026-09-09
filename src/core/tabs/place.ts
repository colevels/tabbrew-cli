import type { OperatorInput, Snapshot, TabIds } from '../operators/contract'

export type MoveTarget = { after: number; before?: never } | { before: number; after?: never }

export type MovePlan =
  | { ok: true; input: OperatorInput<'moveTabs'> }
  | { ok: false; message: string }

const missing = (tabId: number): { ok: false; message: string } => ({
  ok: false,
  message: `no tab ${tabId}; run "tabbrew tabs list"`,
})

export type CreateTarget = {
  windowId?: number
  after?: number
  before?: number
  groupId?: number
}

export type CreatePlan =
  | { ok: true; input: { windowId?: number; index?: number }; groupId?: number }
  | { ok: false; message: string }

// Not planMove: its index arithmetic compensates for tabs leaving the strip,
// and a tab that does not exist yet displaces nothing.
export function planCreate(snapshot: Snapshot, target: CreateTarget): CreatePlan {
  const input: { windowId?: number; index?: number } = {}
  const anchorId = target.after ?? target.before
  if (anchorId !== undefined) {
    const anchor = snapshot.tabs.find((tab) => tab.id === anchorId)
    if (!anchor) return missing(anchorId)
    input.windowId = anchor.windowId
    input.index = anchor.index + (target.after === undefined ? 0 : 1)
  } else if (target.windowId !== undefined) {
    if (!snapshot.windows.some((window) => window.id === target.windowId)) {
      return { ok: false, message: `no window ${target.windowId}; run "tabbrew windows list"` }
    }
    input.windowId = target.windowId
  }
  if (target.groupId === undefined) return { ok: true, input }
  const group = snapshot.groups.find((candidate) => candidate.id === target.groupId)
  if (!group) return { ok: false, message: `no group ${target.groupId}; run "tabbrew groups list"` }
  // Joining the group moves the tab into the group's window, which would undo
  // the placement rather than combine with it.
  if (input.windowId !== undefined && input.windowId !== group.windowId) {
    return { ok: false, message: `group ${group.id} is in window ${group.windowId}` }
  }
  // Born where it will end up, instead of created elsewhere and yanked across.
  return { ok: true, input: { ...input, windowId: group.windowId }, groupId: group.id }
}

export function planMove(snapshot: Snapshot, tabIds: TabIds, target: MoveTarget): MovePlan {
  const anchorId = target.after ?? target.before
  const anchor = snapshot.tabs.find((tab) => tab.id === anchorId)
  if (!anchor) return missing(anchorId)
  const moving = new Set(tabIds)
  for (const tabId of tabIds) {
    if (!snapshot.tabs.some((tab) => tab.id === tabId)) return missing(tabId)
  }
  // Chrome's index is the anchor's final position: tabs leaving the strip from
  // ahead of the anchor pull it back by one each.
  const ahead = snapshot.tabs.filter(
    (tab) => moving.has(tab.id) && tab.windowId === anchor.windowId && tab.index < anchor.index,
  ).length
  const index = anchor.index - ahead + (target.after === undefined ? 0 : 1)
  return { ok: true, input: { tabIds, index, windowId: anchor.windowId } }
}
