import { Command } from 'commander'
import { collapse } from './collapse'
import { list } from './list'
import { uncollapse } from './uncollapse'

export const groups = new Command('groups')
  .description('Tab groups in Chrome')
  .addCommand(list)
  .addCommand(collapse)
  .addCommand(uncollapse)
