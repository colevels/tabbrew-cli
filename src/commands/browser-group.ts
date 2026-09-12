import { Command } from 'commander'
import { helpSections } from './help'

export const browserGroup = (name: string, description: string, examples: string[]): Command =>
  helpSections(new Command(name).description(description), {
    examples,
    note: `All ${name} commands need a connected session; run \`tabbrew session start\` first.`,
  })
