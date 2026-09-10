import { Command } from 'commander'
import { callOperator, withSession } from '../../core/session'
import { type CreateTarget, planCreate } from '../../core/tabs'
import { parseTabId, reject } from './tab-ids'

// A bare host resolves against the extension's own origin, so "example.com"
// would open chrome-extension://…/example.com instead of the site.
const absolute = (url: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`

export const create = new Command('create')
  .description(
    'Open a new tab in the background (needs a connected session; see tabbrew session open)',
  )
  .argument('[url]', 'URL to open (default: a new tab page)')
  .option('--window <window>', 'open it in this window')
  .option('--after <tab>', 'place it right after this tab')
  .option('--before <tab>', 'place it right before this tab')
  .option('--group <group>', 'add it to this group')
  .option('--json', 'machine-readable output')
  .action(
    async (
      url: string | undefined,
      opts: {
        window?: string
        after?: string
        before?: string
        group?: string
        json?: boolean
      },
    ) => {
      const placements = [opts.window, opts.after, opts.before].filter(
        (value) => value !== undefined,
      )
      if (placements.length > 1) return reject('give at most one of --window, --after, --before')
      const target: CreateTarget = {}
      for (const [flag, raw, key] of [
        ['--window', opts.window, 'windowId'],
        ['--after', opts.after, 'after'],
        ['--before', opts.before, 'before'],
        ['--group', opts.group, 'groupId'],
      ] as const) {
        if (raw === undefined) continue
        const id = parseTabId(raw)
        if (id === null) return reject(`${flag} must be a positive integer: ${raw}`)
        target[key] = id
      }
      await withSession(async (session) => {
        const snapshot = await callOperator(session, 'readSnapshot', {})
        const plan = planCreate(snapshot, target)
        if (!plan.ok) return reject(plan.message)
        const created = await callOperator(session, 'createTab', {
          ...plan.input,
          ...(url === undefined ? {} : { url: absolute(url) }),
        })
        if (plan.groupId !== undefined) {
          await callOperator(session, 'groupTabs', {
            tabIds: [created.tabId],
            groupId: plan.groupId,
          })
        }
        if (opts.json) {
          console.log(
            JSON.stringify({ ...created, ...(plan.groupId ? { groupId: plan.groupId } : {}) }),
          )
        } else {
          const label = snapshot.windows.find((window) => window.id === created.windowId)?.label
          console.log(
            `created tab ${created.tabId} in window ${label ?? created.windowId} at index ${created.index}`,
          )
        }
      })
    },
  )
