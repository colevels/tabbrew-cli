import { Command } from 'commander'
import { run } from './run'
import { start } from './start'
import { status } from './status'
import { stop } from './stop'

export const session = new Command('session')
  .description(
    'The connection between this CLI and the TabBrew side panel in Chrome that lets you manage tabs from the terminal',
  )
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status)
  .addCommand(run)
