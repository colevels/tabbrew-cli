import { Command } from 'commander'
import { list } from './list'

export const windows = new Command('windows').description('Windows open in Chrome').addCommand(list)
