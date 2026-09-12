#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json'
import { groups } from './commands/groups'
import { init } from './commands/init'
import { session } from './commands/session'
import { tabs } from './commands/tabs'
import { update } from './commands/update'
import { windows } from './commands/windows'

const program = new Command()
  .name('tabbrew')
  .description('TabBrew CLI')
  .version(pkg.version)
  .addHelpText(
    'after',
    '\ntabs, windows and groups need a connected session; run "tabbrew session start" first.',
  )

program.addCommand(session)
program.addCommand(tabs)
program.addCommand(windows)
program.addCommand(groups)
program.addCommand(init)
program.addCommand(update)

await program.parseAsync()
