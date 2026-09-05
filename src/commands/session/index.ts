import { Command } from 'commander'
import { run } from './run'
import { start } from './start'
import { status } from './status'
import { stop } from './stop'

export const session = new Command('session')
  .description('The background process that links this terminal to Chrome')
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status)
  .addCommand(run)
