import { Command } from 'commander'
import { list } from './list'

export const groups = new Command('groups').description('Tab groups in Chrome').addCommand(list)
