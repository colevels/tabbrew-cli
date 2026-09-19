// The harness's own commands: the first consumer of serveSession, and what the
// e2e suite drives to prove an extension can add to tabbrew.

import type { Browser } from 'wxt/browser'
import type { Command } from '../sdk'

export interface HarnessChrome {
  tabs: { query(info: Browser.tabs.QueryInfo): Promise<Browser.tabs.Tab[]> }
}

export const HARNESS_NAMESPACE = 'harness'
export const HARNESS_DESCRIPTION = 'Sample commands served by the TabBrew CLI Harness'

const host = (url: string | undefined): string => {
  try {
    return new URL(url ?? '').host || '-'
  } catch {
    return '-'
  }
}

export const createHarnessCommands = (chrome: HarnessChrome): Record<string, Command> => ({
  echo: {
    description: 'Send text through the extension and back',
    arguments: [{ name: 'text', type: 'string', description: 'text to echo' }],
    options: { times: { type: 'number', description: 'repeat the text', default: 1 } },
    view: { message: '{text}' },
    run: async ({ text, times }: { text: string; times: number }) => ({
      text: Array.from({ length: times }, () => text).join(' '),
    }),
  },
  'tabs-by-host': {
    description: 'Count open tabs per host',
    view: { rows: 'hosts', columns: ['tabs', 'host'] },
    run: async () => {
      const counts = new Map<string, number>()
      for (const tab of await chrome.tabs.query({})) {
        const name = host(tab.url || tab.pendingUrl)
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      const hosts = [...counts].map(([name, tabs]) => ({ host: name, tabs }))
      return { hosts: hosts.sort((a, b) => b.tabs - a.tabs || a.host.localeCompare(b.host)) }
    },
  },
})
