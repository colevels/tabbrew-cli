import { Command } from 'commander'
import { forgetPlugin, readKnownPlugins } from '../../core/plugins/cache'
import { connectPlugin, explainNotConnected } from '../../core/plugins/connect'
import { discover, readCommands, withSession } from '../../core/session'
import type { SessionInfo } from '../../core/session/protocol'
import { renderTable } from '../../core/table'
import { helpSections } from '../help'
import { buildPluginCommands, type KnownEntry, PLUGINS } from './build'

// Filled by addPluginCommands before anything is parsed.
let known: Record<string, KnownEntry> = {}

const unknown = (namespace: string): void => {
  console.error(`unknown plugin "${namespace}"; run "tabbrew plugin list"`)
  process.exitCode = 1
}

const list = new Command('list')
  .description('List known plugins')
  .option('--json', 'machine-readable output')
  .action((options: { json?: boolean }) => {
    if (options.json) return console.log(JSON.stringify(known))
    const rows = Object.entries(known).map(([namespace, entry]) => [
      namespace,
      entry.extensionId,
      entry.connected ? 'yes' : 'no',
      Object.keys(entry.commands).join(', '),
    ])
    if (rows.length > 0) {
      console.log(renderTable(['PLUGIN', 'CHROME EXTENSION', 'CONNECTED', 'COMMANDS'], rows))
    }
  })

const open = new Command('open')
  .description("Open a plugin's page in Chrome so the session can reach it")
  .argument('<plugin>', 'as `tabbrew plugin list` names it')
  .action((namespace: string) =>
    withSession(async (session) => {
      const entry = Object.hasOwn(known, namespace) ? known[namespace] : undefined
      if (!entry) return unknown(namespace)
      if (!(await connectPlugin(session, namespace, entry))) {
        console.error(explainNotConnected(namespace, entry))
        process.exitCode = 1
      }
    }),
  )

const forget = new Command('forget')
  .description('Forget a plugin seen in an earlier session')
  .argument('<plugin>', 'as `tabbrew plugin list` names it')
  .action((namespace: string) => {
    if (!forgetPlugin(namespace)) unknown(namespace)
  })

export const plugin = helpSections(
  new Command('plugin').description('Commands added by other Chrome extensions'),
  {
    examples: ['tabbrew plugin list', 'tabbrew plugin <plugin> --help'],
    note: 'A plugin is written and served by the Chrome extension that declares it, not by TabBrew; its page has to be connected to the session.',
  },
)
  .commandsGroup('MANAGE')
  .addCommand(list)
  .addCommand(open)
  .addCommand(forget)
  .commandsGroup(PLUGINS)

// What the plugins offer is only known at run time, so their commands are
// added when `tabbrew plugin` is what was asked for, and no other invocation
// pays for the lookup. Must run before installHelp.
//
// The session knows what was declared since it started, the file what earlier
// sessions saw: a plugin whose page is closed is still a command, and one the
// CLI can open the page of.
export async function addPluginCommands(): Promise<SessionInfo | null> {
  const session = await discover()
  const remembered = readKnownPlugins()
  known = { ...remembered }
  for (const [namespace, entry] of Object.entries(session ? await readCommands(session) : {})) {
    const before = remembered[namespace]
    known[namespace] = {
      ...entry,
      previousExtensionId:
        before && before.extensionId !== entry.extensionId
          ? before.extensionId
          : before?.previousExtensionId,
    }
  }
  for (const command of buildPluginCommands(known)) plugin.addCommand(command)
  return session
}
