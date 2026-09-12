import { browserGroup } from '../browser-group'
import { close } from './close'
import { create } from './create'
import { discard } from './discard'
import { focus } from './focus'
import { group } from './group'
import { list } from './list'
import { move } from './move'

export const tabs = browserGroup('tabs', 'Tabs open in Chrome')
  .addCommand(create)
  .addCommand(list)
  .addCommand(focus)
  .addCommand(move)
  .addCommand(discard)
  .addCommand(close)
  .addCommand(group)
