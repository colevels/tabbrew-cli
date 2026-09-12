import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'

export const create = new Command('create')
  .description('Open a new Chrome window')
  .argument('[url...]', 'URLs to open in the new window (default: a new tab)')
  .option('--focus', 'focus the new window')
  .option('--json', 'machine-readable output')
  .action(async (urls: string[], opts: { focus?: boolean; json?: boolean }) => {
    await withSession(async (session) => {
      const output = await callOperator(session, 'createWindow', {
        urls,
        focused: !!opts.focus,
      })
      if (opts.json) {
        console.log(JSON.stringify(output))
      } else {
        const tabWord = output.tabs.length === 1 ? 'tab' : 'tabs'
        console.log(`created window ${output.windowId} (${output.tabs.length} ${tabWord})`)
      }
    })
  })
