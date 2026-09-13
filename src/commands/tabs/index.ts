import { browserCommand } from '../help'
import { close } from './close'
import { create } from './create'
import { discard } from './discard'
import { focus } from './focus'
import { group } from './group'
import { list } from './list'
import { move } from './move'
import { reload } from './reload'
import { ungroup } from './ungroup'

export const tabs = browserCommand('tabs', 'Tabs open in Chrome', [
  'tabbrew tabs list',
  'tabbrew tabs focus 42',
  'tabbrew tabs group 42 43 --title Docs --color blue',
])
  .addCommand(create)
  .addCommand(list)
  .addCommand(focus)
  .addCommand(move)
  .addCommand(discard)
  .addCommand(reload)
  .addCommand(close)
  .addCommand(group)
  .addCommand(ungroup)
