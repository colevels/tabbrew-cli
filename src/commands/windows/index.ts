import { browserGroup } from '../browser-group'
import { create } from './create'
import { list } from './list'

export const windows = browserGroup('windows', 'Windows open in Chrome', [
  'tabbrew windows list',
  'tabbrew windows create https://example.com --focus',
])
  .addCommand(list)
  .addCommand(create)
