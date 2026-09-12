import { browserGroup } from '../browser-group'
import { create } from './create'
import { list } from './list'

export const windows = browserGroup('windows', 'Windows open in Chrome')
  .addCommand(list)
  .addCommand(create)
