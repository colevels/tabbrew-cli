import { Command } from 'commander'
import { callOperator, discover, OperatorCallError } from '../../core/session'

// Chrome reports -1 for an ungrouped tab, so a group id is always positive.
const parseGroupId = (raw: string): number | null =>
  /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null

export function collapsedVerb(name: string, collapsed: boolean): Command {
  const action = collapsed ? 'Collapse' : 'Expand'
  return new Command(name)
    .description(`${action} tab groups (needs the TabBrew panel open in Chrome)`)
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
      const session = await discover()
      if (!session) {
        console.error('no session running; run "tabbrew session start"')
        process.exitCode = 1
        return
      }
      try {
        const results: { groupId: number; collapsed: boolean }[] = []
        // In order, one at a time: the first failure stops and the rest stay untouched.
        for (const groupId of groupIds) {
          const output = await callOperator(session, 'updateGroup', { groupId, collapsed })
          results.push({ groupId: output.groupId, collapsed })
        }
        if (opts.json) console.log(JSON.stringify(results))
      } catch (error) {
        console.error(error instanceof OperatorCallError ? error.message : String(error))
        process.exitCode = 1
      }
    })
}

export const collapse = collapsedVerb('collapse', true)
