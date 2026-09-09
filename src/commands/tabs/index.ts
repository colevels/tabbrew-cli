import { Command } from 'commander'
import { create } from './create'
import { discard } from './discard'
import { group } from './group'
import { list } from './list'
import { move } from './move'

export const tabs = new Command('tabs')
  .description('Tabs open in Chrome')
  .addCommand(create)
  .addCommand(list)
  .addCommand(move)
  .addCommand(discard)
  .addCommand(group)
