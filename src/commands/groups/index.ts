import { browserGroup } from '../browser-group'
import { close } from './close'
import { collapse } from './collapse'
import { list } from './list'
import { uncollapse } from './uncollapse'

export const groups = browserGroup('groups', 'Tab groups in Chrome')
  .addCommand(list)
  .addCommand(collapse)
  .addCommand(uncollapse)
  .addCommand(close)
