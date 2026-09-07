import { Command } from 'commander'
import { list } from './list'
import { move } from './move'

export const tabs = new Command('tabs')
  .description('Tabs open in Chrome')
  .addCommand(list)
  .addCommand(move)
