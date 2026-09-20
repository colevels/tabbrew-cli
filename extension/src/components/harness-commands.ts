// The harness's own commands, reached as `tabbrew plugin harness …`. They are
// what the plugin tests drive in a real Chrome: every view, typed parameters,
// and two namespaces from one page.

import type { ChromeApi, NamespaceDefinition } from '../../../sdk/src/index'

export const harnessCommands = (
  chrome: ChromeApi,
  version: string,
): Record<string, NamespaceDefinition> => ({
  harness: {
    description: 'Sample commands served by the TabBrew CLI Harness',
    commands: {
      echo: {
        description: 'Say it back',
        arguments: [{ name: 'text', type: 'string' }],
        options: { times: { type: 'number', default: 1, description: 'how many times' } },
        view: { message: '{text}' },
        examples: ['tabbrew plugin harness echo brewed --times 2'],
        run: ({ text, times }) => ({ text: Array(Number(times)).fill(text).join(' ') }),
      },
      'tabs-by-host': {
        description: 'Count the open tabs of every host',
        view: { rows: 'hosts', columns: ['tabs', 'host'] },
        async run() {
          const counts = new Map<string, number>()
          for (const tab of await chrome.tabs.query({})) {
            const host = URL.canParse(tab.url ?? '') ? new URL(tab.url ?? '').host : '-'
            counts.set(host || '-', (counts.get(host || '-') ?? 0) + 1)
          }
          return {
            hosts: [...counts]
              .map(([host, tabs]) => ({ host, tabs }))
              .sort((a, b) => b.tabs - a.tabs || a.host.localeCompare(b.host)),
          }
        },
      },
    },
  },
  'harness-build': {
    description: 'What this build of the harness is',
    commands: {
      show: {
        description: 'Show the harness version',
        view: { fields: ['name', 'version'] },
        run: () => ({ name: 'TabBrew CLI Harness', version }),
      },
    },
  },
})
