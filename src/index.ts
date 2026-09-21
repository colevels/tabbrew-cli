#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json'
import { groups } from './commands/groups'
import { helpSections, installHelp } from './commands/help'
import { init } from './commands/init'
import { addPluginCommands, plugin } from './commands/plugin'
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
  .addCommand(plugin)
  .commandsGroup('ADDITIONAL COMMANDS')
  .addCommand(init)
  .addCommand(update)
  .addCommand(uninstall)

helpSections(program, {
  examples: ['tabbrew session start', 'tabbrew tabs list', 'tabbrew init'],
  note: 'tabs, windows and groups need a connected session; run `tabbrew session start` first.',
})

const [, , first, second, third] = process.argv
const requested =
  first === 'plugin' ? second : first === 'help' && second === 'plugin' ? third : null
const running = requested === null ? null : await addPluginCommands()
installHelp(program)

// gh prints help for a bare invocation; Commander would send it to stderr with exit 1.
if (process.argv.length <= 2) program.outputHelp()
else if (
  requested &&
  !requested.startsWith('-') &&
  requested !== 'help' &&
  !plugin.commands.some((command) => command.name() === requested)
) {
  // Commander would call it an unknown command, which says nothing about why.
  console.error(
    running
      ? `unknown plugin "${requested}"; run "tabbrew plugin list"`
      : 'no session running; run "tabbrew session start"',
  )
  process.exitCode = 1
} else {
  await program.parseAsync()
  // Skip `update` itself so the check never doubles up with `--check`'s own output.
  if (program.args[0] !== 'update') {
    const { notifyIfUpdateAvailable } = await import('./core/update/notify')
    await notifyIfUpdateAvailable()
  }
}
