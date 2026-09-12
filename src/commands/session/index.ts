import { Command } from 'commander'
import { helpSections } from '../help'
import { open } from './open'
import { run } from './run'
import { start } from './start'
import { status } from './status'
import { stop } from './stop'

export const session = new Command('session')
  .summary('Connect this CLI to the TabBrew extension in Chrome')
  .description(
    'The connection between this CLI and the TabBrew extension in Chrome that lets you manage tabs from the terminal',
  )
  .addCommand(start)
  .addCommand(open)
  .addCommand(stop)
  .addCommand(status)
  .addCommand(run)

helpSections(session, {
  examples: ['tabbrew session start', 'tabbrew session status', 'tabbrew session stop'],
})
