import { Command } from 'commander'
import type { GroupColor } from '../../core/operators'
import { callOperator, withSession } from '../../core/session'
import { planGroup } from '../../core/tabs'
import { parseTabId, reject } from './tab-ids'

const COLORS: GroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
]
const isGroupColor = (value: string): value is GroupColor => (COLORS as string[]).includes(value)

export const group = new Command('group')
  .description(
    'Group tabs together, joining an existing group or creating one (needs a connected session; see tabbrew session open)',
  )
  .argument('<tab...>', 'tab ids, as shown by "tabs list"')
  .option('--to <group>', 'join this existing group')
  .option('--window <window>', 'create a new group in this window')
  .option('--title <title>', 'set the group title')
  .option('--color <color>', `set the group color (${COLORS.join('|')})`)
  .option('--collapse', 'collapse the group')
  .option('--expand', 'expand the group')
  .option('--json', 'machine-readable output')
  .action(
    async (
      raws: string[],
      opts: {
        to?: string
        window?: string
        title?: string
        color?: string
        collapse?: boolean
        expand?: boolean
        json?: boolean
      },
    ) => {
      if (opts.to !== undefined && opts.window !== undefined) {
        return reject('give at most one of --to, --window')
      }
      if (opts.collapse && opts.expand) return reject('give at most one of --collapse, --expand')
      const tabIds: number[] = []
      for (const raw of raws) {
        const tabId = parseTabId(raw)
        if (tabId === null) return reject(`tab id must be a positive integer: ${raw}`)
        tabIds.push(tabId)
      }
      let groupId: number | undefined
      if (opts.to !== undefined) {
        groupId = parseTabId(opts.to) ?? undefined
        if (groupId === undefined) return reject(`group id must be a positive integer: ${opts.to}`)
      }
      let windowId: number | undefined
      if (opts.window !== undefined) {
        windowId = parseTabId(opts.window) ?? undefined
        if (windowId === undefined) {
          return reject(`window id must be a positive integer: ${opts.window}`)
        }
      }
      if (opts.color !== undefined && !isGroupColor(opts.color)) {
        return reject(`color must be one of ${COLORS.join(', ')}: ${opts.color}`)
      }
      const color = opts.color as GroupColor | undefined
      const collapsed = opts.collapse ? true : opts.expand ? false : undefined
      await withSession(async (session) => {
        const snapshot = await callOperator(session, 'readSnapshot', {})
        const plan = planGroup(snapshot, tabIds as [number, ...number[]], { groupId, windowId })
        if (!plan.ok) return reject(plan.message)
        const grouped = await callOperator(session, 'groupTabs', plan.input)
        let output: { groupId: number; title?: string; color?: GroupColor } = grouped
        if (opts.title !== undefined || color !== undefined || collapsed !== undefined) {
          output = await callOperator(session, 'updateGroup', {
            groupId: grouped.groupId,
            title: opts.title,
            color,
            collapsed,
          })
        }
        if (opts.json) console.log(JSON.stringify(output))
      })
    },
  )
