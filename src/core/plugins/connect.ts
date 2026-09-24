import type { RegistryEntry } from '../commands/declaration'
import { readCommands } from '../session/call'
import { openInChrome } from '../session/chrome'
import { CONNECT_WAIT_MS } from '../session/config'
import type { SessionInfo } from '../session/protocol'

// What `session start` does for the extension, for a plugin: open the page it
// declared and wait for it to show up in the session.
export async function connectPlugin(
  session: SessionInfo,
  namespace: string,
  entry: RegistryEntry,
): Promise<boolean> {
  if (entry.connected) return true
  if (!entry.page) return false
  openInChrome(`chrome-extension://${entry.extensionId}/${entry.page}`)
  const until = Date.now() + CONNECT_WAIT_MS
  while (Date.now() < until) {
    if ((await readCommands(session))[namespace]?.connected) return true
    await Bun.sleep(100)
  }
  return false
}

export const explainNotConnected = (namespace: string, entry: RegistryEntry): string =>
  entry.page
    ? `the "${namespace}" plugin did not connect; is Chrome extension ${entry.extensionId} installed and enabled in the Chrome profile you use?`
    : `the "${namespace}" plugin is not connected; open its Chrome extension's page and retry`
