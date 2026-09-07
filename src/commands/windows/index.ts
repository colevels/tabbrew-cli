import { Command } from 'commander'
import { create } from './create'
import { list } from './list'

export const windows = new Command('windows')
  .description('Windows open in Chrome')
  .addCommand(list)
  .addCommand(create)
