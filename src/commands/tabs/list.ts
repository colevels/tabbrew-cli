import { Command } from 'commander'
import { callOperator, discover, OperatorCallError } from '../../core/session'
import { formatTabTable } from '../../core/tabs'

export const list = new Command('list')
  .description('List every open tab (needs the TabBrew panel open in Chrome)')
  .option('--json', 'machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const session = await discover()
    if (!session) {
      console.error('no session running; run "tabbrew session start"')
      process.exitCode = 1
      return
    }
    try {
      const snapshot = await callOperator(session, 'readSnapshot', {})
      console.log(opts.json ? JSON.stringify(snapshot) : formatTabTable(snapshot))
    } catch (error) {
      console.error(error instanceof OperatorCallError ? error.message : String(error))
      process.exitCode = 1
    }
  })
