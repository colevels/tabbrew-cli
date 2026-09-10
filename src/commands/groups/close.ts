import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'
import { parseGroupId } from './collapse'

export const close = new Command('close')
  .description(
    'Close tab groups; Chrome keeps them in its saved groups (needs a connected session; see tabbrew session open)',
  )
  .argument('<group...>', 'group ids, as shown by "groups list"')
  .option('--json', 'machine-readable output')
  .action(async (raws: string[], opts: { json?: boolean }) => {
    const groupIds: number[] = []
    for (const raw of raws) {
      const groupId = parseGroupId(raw)
      if (groupId === null) {
        console.error(`group id must be a positive integer: ${raw}`)
        process.exitCode = 1
        return
      }
      groupIds.push(groupId)
    }
    await withSession(async (session) => {
      const results: { groupId: number; tabIds: number[] }[] = []
      // In order, one at a time: the first failure stops and the rest stay open.
      for (const groupId of groupIds) {
        results.push(await callOperator(session, 'closeGroup', { groupId }))
      }
      if (opts.json) console.log(JSON.stringify(results))
    })
  })
