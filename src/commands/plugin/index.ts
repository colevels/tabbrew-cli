import { Command } from 'commander'
import { discover, readCommands, withSession } from '../../core/session'
import type { SessionInfo } from '../../core/session/protocol'
import { renderTable } from '../../core/table'
import { helpSections } from '../help'
import { buildPluginCommands, PLUGINS } from './build'

const list = new Command('list')
  .description('List the plugins this session knows')
  .option('--json', 'machine-readable output')
  .action((options: { json?: boolean }) =>
    withSession(async (session) => {
      const registry = await readCommands(session)
      if (options.json) return console.log(JSON.stringify(registry))
      const rows = Object.entries(registry).map(([namespace, entry]) => [
        namespace,
        entry.extensionId,
        entry.connected ? 'yes' : 'no',
        Object.keys(entry.commands).join(', '),
      ])
      if (rows.length > 0) {
        console.log(renderTable(['PLUGIN', 'CHROME EXTENSION', 'CONNECTED', 'COMMANDS'], rows))
      }
    }),
  )

export const plugin = helpSections(
  new Command('plugin').description('Commands added by other Chrome extensions'),
  {
    examples: ['tabbrew plugin list', 'tabbrew plugin <plugin> --help'],
    note: 'A plugin is written and served by the Chrome extension that declares it, not by TabBrew; its page has to be connected to the session.',
  },
)
  .commandsGroup('MANAGE')
  .addCommand(list)
  .commandsGroup(PLUGINS)

// What the plugins offer is only known at run time, so their commands are
// added when `tabbrew plugin` is what was asked for, and no other invocation
// pays for the lookup. Must run before installHelp.
export async function addPluginCommands(): Promise<SessionInfo | null> {
  const session = await discover()
  if (session) {
    for (const command of buildPluginCommands(await readCommands(session))) {
      plugin.addCommand(command)
    }
  }
  return session
}
