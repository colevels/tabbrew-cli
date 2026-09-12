import { Command } from 'commander'

// afterAll reaches every verb's help too, so the note appears once per screen
// instead of once per verb line.
export const browserGroup = (name: string, description: string): Command =>
  new Command(name)
    .description(description)
    .addHelpText(
      'afterAll',
      `\nAll ${name} commands need a connected session; run "tabbrew session start" first.`,
    )
