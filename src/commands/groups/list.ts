import { Command } from 'commander'
import { formatGroupTable, summarizeGroups } from '../../core/groups'
import { callOperator, withSession } from '../../core/session'

export const list = new Command('list')
  .description('List every tab group in Chrome (needs the TabBrew panel open in Chrome)')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) =>
    withSession(async (session) => {
      const snapshot = await callOperator(session, 'readSnapshot', {})
      console.log(
        opts.json ? JSON.stringify(summarizeGroups(snapshot)) : formatGroupTable(snapshot),
      )
    }),
  )
