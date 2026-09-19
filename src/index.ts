#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json'
import { groups } from './commands/groups'
import { helpSections, installHelp } from './commands/help'
import { init } from './commands/init'
import { plugins } from './commands/plugins'
import { buildPluginCommands, PLUGIN_COMMANDS } from './commands/plugins/build'
import { session } from './commands/session'
import { tabs } from './commands/tabs'
import { uninstall } from './commands/uninstall'
import { update } from './commands/update'
import { windows } from './commands/windows'

const program = new Command()
  .name('tabbrew')
  .description('Manage Chrome tabs, windows and tab groups from the command line.')
  .version(pkg.version, '-V, --version', 'show tabbrew version')

program
  .commandsGroup('CORE COMMANDS')
  .addCommand(session)
  .addCommand(tabs)
  .addCommand(windows)
  .addCommand(groups)
  .commandsGroup('ADDITIONAL COMMANDS')
  .addCommand(init)
  .addCommand(plugins)
  .addCommand(update)
  .addCommand(uninstall)

// Only an invocation no built-in command answers pays for the lookup; with no
// session up there is nothing to add and the help reads as it always has.
const requested = process.argv[2]
if (!requested || !program.commands.some((command) => command.name() === requested)) {
  const { discover, readCommands } = await import('./core/session')
  const session = await discover()
  if (session) {
    program.commandsGroup(PLUGIN_COMMANDS)
    for (const command of buildPluginCommands(await readCommands(session))) {
      program.addCommand(command)
    }
  }
}

helpSections(program, {
  examples: ['tabbrew session start', 'tabbrew tabs list', 'tabbrew init'],
  note: 'tabs, windows and groups need a connected session; run `tabbrew session start` first.',
})
installHelp(program)

// gh prints help for a bare invocation; Commander would send it to stderr with exit 1.
if (process.argv.length <= 2) program.outputHelp()
else {
  await program.parseAsync()
  // Skip `update` itself so the check never doubles up with `--check`'s own output.
  if (program.args[0] !== 'update') {
    const { notifyIfUpdateAvailable } = await import('./core/update/notify')
    await notifyIfUpdateAvailable()
  }
}
