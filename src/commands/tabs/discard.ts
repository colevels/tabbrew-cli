import { Command } from 'commander'
import type { OperatorOutput } from '../../core/operators'
import { callOperator, withSession } from '../../core/session'
import { parseTabId, reject } from './tab-ids'

export const discard = new Command('discard')
  .description(
    'Unload tabs from memory, keeping them on the tab strip (needs the TabBrew panel open in Chrome)',
  )
  .argument('<tab...>', 'tab ids, as shown by "tabs list"')
  .option('--json', 'machine-readable output')
  .action(async (raws: string[], opts: { json?: boolean }) => {
    const tabIds: number[] = []
    for (const raw of raws) {
      const tabId = parseTabId(raw)
      if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
      tabIds.push(tabId)
    }
    await withSession(async (session) => {
      const results: OperatorOutput<'discardTab'>[] = []
      // In order, one at a time: the first failure stops and the rest stay untouched.
      for (const tabId of tabIds) {
        results.push(await callOperator(session, 'discardTab', { tabId }))
      }
      if (opts.json) console.log(JSON.stringify(results))
    })
  })
