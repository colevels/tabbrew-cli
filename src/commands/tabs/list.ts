import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'
import { formatTabTable } from '../../core/tabs'

export const list = new Command('list')
  .description('List every open tab')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) =>
    withSession(async (session) => {
      const snapshot = await callOperator(session, 'readSnapshot', {})
      console.log(opts.json ? JSON.stringify(snapshot) : formatTabTable(snapshot))
    }),
  )
