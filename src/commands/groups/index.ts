import { browserGroup } from '../browser-group'
import { close } from './close'
import { collapse } from './collapse'
import { list } from './list'
import { uncollapse } from './uncollapse'

export const groups = browserGroup('groups', 'Tab groups in Chrome', [
  'tabbrew groups list',
  'tabbrew groups collapse 7',
  'tabbrew groups close 7 9',
])
  .addCommand(list)
  .addCommand(collapse)
  .addCommand(uncollapse)
  .addCommand(close)
