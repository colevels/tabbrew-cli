import type { OperatorInput, Snapshot, TabIds } from '../operators/contract'

export type MoveTarget = { after: number; before?: never } | { before: number; after?: never }

export type MovePlan =
  | { ok: true; input: OperatorInput<'moveTabs'> }
  | { ok: false; message: string }

const missing = (tabId: number): MovePlan => ({
  ok: false,
  message: `no tab ${tabId}; run "tabbrew tabs list"`,
})

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
