import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'
import { parseTabId, reject } from './tab-ids'

export const focus = new Command('focus')
  .description(
    'Bring a tab to the front, raising its window (needs a connected session; see tabbrew session open)',
  )
  .argument('<tab>', 'tab id, as shown by "tabs list"')
  .option('--json', 'machine-readable output')
  .action(async (raw: string, opts: { json?: boolean }) => {
    const tabId = parseTabId(raw)
    if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
    await withSession(async (session) => {
      const focused = await callOperator(session, 'focusTab', { tabId })
      if (opts.json) console.log(JSON.stringify(focused))
    })
  })
