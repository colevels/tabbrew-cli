import { browserCommand } from '../help'
import { create } from './create'
import { list } from './list'

export const windows = browserCommand('windows', 'Windows open in Chrome', [
  'tabbrew windows list',
  'tabbrew windows create https://example.com --focus',
])
  .addCommand(list)
  .addCommand(create)
