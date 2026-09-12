import { Command } from 'commander'
import type { OperatorOutput } from '../../core/operators'
import { callOperator, withSession } from '../../core/session'
import { parseTabId, reject } from './tab-ids'

export const reload = new Command('reload')
  .description('Reload tabs in place')
  .argument('<tab...>', 'tab ids, as shown by "tabs list"')
  .option('--hard', 'bypass the cache, like a hard reload')
  .option('--json', 'machine-readable output')
  .action(async (raws: string[], opts: { hard?: boolean; json?: boolean }) => {
    const tabIds: number[] = []
    for (const raw of raws) {
      const tabId = parseTabId(raw)
      if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
      tabIds.push(tabId)
    }
    await withSession(async (session) => {
      const results: OperatorOutput<'reloadTab'>[] = []
      // In order, one at a time: the first failure stops and the rest stay untouched.
      for (const tabId of tabIds) {
        results.push(await callOperator(session, 'reloadTab', { tabId, bypassCache: !!opts.hard }))
      }
      if (opts.json) console.log(JSON.stringify(results))
    })
  })
