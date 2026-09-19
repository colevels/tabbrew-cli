import { Command } from 'commander'
import { readCommands, withSession } from '../../core/session'
import { cell, renderTable } from '../../core/table'
import { helpSections } from '../help'

const list = new Command('list')
  .description('List the plugins that added commands to this session')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) =>
    withSession(async (session) => {
      const registry = await readCommands(session)
      if (opts.json) return console.log(JSON.stringify(registry))
      const rows = Object.entries(registry).map(([namespace, entry]) => [
        namespace,
        entry.extensionId,
        entry.connected ? 'yes' : 'no',
        cell(Object.keys(entry.commands).join(', ')),
      ])
      if (rows.length)
        console.log(renderTable(['PLUGIN', 'CHROME EXTENSION', 'CONNECTED', 'COMMANDS'], rows))
    }),
  )

export const plugins = helpSections(
  new Command('plugins').description('Commands that other Chrome extensions add to tabbrew'),
  {
    examples: ['tabbrew plugins list'],
    note: 'A plugin is a Chrome extension that declares commands when its page connects; they then run as `tabbrew <plugin> <command>`.',
  },
).addCommand(list)
