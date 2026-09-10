import { Command } from 'commander'
import { open } from './open'
import { run } from './run'
import { start } from './start'
import { status } from './status'
import { stop } from './stop'

export const session = new Command('session')
  .description(
    'The connection between this CLI and the TabBrew extension in Chrome that lets you manage tabs from the terminal',
  )
  .addCommand(start)
  .addCommand(open)
  .addCommand(stop)
  .addCommand(status)
  .addCommand(run)
