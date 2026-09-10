import { Command } from 'commander'
import type { TabIds } from '../../core/operators'
import { callOperator, withSession } from '../../core/session'
import { type MoveTarget, planMove } from '../../core/tabs'
import { parseTabId, reject } from './tab-ids'

export const move = new Command('move')
  .description(
    'Move tabs next to another tab (needs a connected session; see tabbrew session open)',
  )
  .argument('<tab...>', 'tab ids, as shown by "tabs list"')
  .option('--after <tab>', 'place them right after this tab')
  .option('--before <tab>', 'place them right before this tab')
  .option('--json', 'machine-readable output')
  .action(async (raws: string[], opts: { after?: string; before?: string; json?: boolean }) => {
    if ((opts.after === undefined) === (opts.before === undefined)) {
      return reject('give exactly one of --after, --before')
    }
    const ids: number[] = []
    for (const raw of [...raws, opts.after ?? opts.before ?? '']) {
      const tabId = parseTabId(raw)
      if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
      ids.push(tabId)
    }
    const anchorId = ids.pop() as number
    if (ids.includes(anchorId)) return reject(`a tab cannot be moved next to itself: ${anchorId}`)
    const target: MoveTarget = opts.after === undefined ? { before: anchorId } : { after: anchorId }
    await withSession(async (session) => {
      const snapshot = await callOperator(session, 'readSnapshot', {})
      const plan = planMove(snapshot, ids as TabIds, target)
      if (!plan.ok) return reject(plan.message)
      const output = await callOperator(session, 'moveTabs', plan.input)
      if (opts.json) console.log(JSON.stringify(output.tabs))
    })
  })
