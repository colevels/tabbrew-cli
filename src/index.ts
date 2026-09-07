#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json'
import { init } from './commands/init'
import { session } from './commands/session'
import { tabs } from './commands/tabs'
import { windows } from './commands/windows'

const program = new Command().name('tabbrew').description('TabBrew CLI').version(pkg.version)

program.addCommand(session)
program.addCommand(tabs)
program.addCommand(windows)
program.addCommand(init)

await program.parseAsync()
