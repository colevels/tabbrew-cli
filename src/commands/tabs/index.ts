import { Command } from 'commander'
import { list } from './list'

export const tabs = new Command('tabs').description('Tabs open in Chrome').addCommand(list)
