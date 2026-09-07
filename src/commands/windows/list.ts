import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'
import { formatWindowTable, summarizeWindows } from '../../core/windows'

export const list = new Command('list')
  .description('List every open Chrome window (needs the TabBrew panel open in Chrome)')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) =>
    withSession(async (session) => {
      const snapshot = await callOperator(session, 'readSnapshot', {})
      console.log(
        opts.json ? JSON.stringify(summarizeWindows(snapshot)) : formatWindowTable(snapshot),
      )
    }),
  )
