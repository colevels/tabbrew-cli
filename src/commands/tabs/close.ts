import { Command } from 'commander'
import type { TabIds } from '../../core/operators'
import { callOperator, withSession } from '../../core/session'
import { parseTabId, reject } from './tab-ids'

export const close = new Command('close')
  .description('Close tabs')
  .argument('<tab...>', 'tab ids, as shown by "tabs list"')
  .option('--json', 'machine-readable output')
  .action(async (raws: string[], opts: { json?: boolean }) => {
    const ids: number[] = []
    for (const raw of raws) {
      const tabId = parseTabId(raw)
      if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
      // Chrome refuses a list that names the same tab twice.
      if (!ids.includes(tabId)) ids.push(tabId)
    }
    await withSession(async (session) => {
      // One call takes the whole set, so an id Chrome does not know would fail
      // the batch and leave the rest open: name it before anything closes.
      const snapshot = await callOperator(session, 'readSnapshot', {})
      for (const tabId of ids) {
        if (!snapshot.tabs.some((tab) => tab.id === tabId)) {
          return reject(`no tab ${tabId}; run "tabbrew tabs list"`)
        }
      }
      const output = await callOperator(session, 'closeTabs', { tabIds: ids as TabIds })
      if (opts.json) console.log(JSON.stringify(output.tabIds))
    })
  })
