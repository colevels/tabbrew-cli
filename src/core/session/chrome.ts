import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  CONNECT_WAIT_MS,
  CONNECTION_PAGE,
  EXTENSION_KEY,
  PRODUCT_EXTENSION_ID,
  PRODUCT_STORE_URL,
} from './config'
import { probe } from './lifecycle'
import { PROJECT_CONFIG, readProjectExtensionId } from './project'
import type { SessionInfo } from './protocol'

// Chrome's id for a keyed extension: sha256 of the DER key, first 128 bits, hex digits shifted to a-p.
export const extensionId = (key = EXTENSION_KEY): string =>
  createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + Number.parseInt(c, 16)))

export interface ResolvedExtension {
  id: string
  source: 'env' | 'project' | 'store'
}

// Another build of the extension (the harness, extensionId(), or an unpacked
// product checkout) is reached through TABBREW_EXTENSION_ID, else the
// project's .tabbrew.json written by `tabbrew init --extension`.
export function resolveExtension(): ResolvedExtension {
  const env = process.env.TABBREW_EXTENSION_ID
  if (env) return { id: env, source: 'env' }
  const project = readProjectExtensionId()
  if (project) return { id: project, source: 'project' }
  return { id: PRODUCT_EXTENSION_ID, source: 'store' }
}

export const connectionUrl = (): string =>
  `chrome-extension://${resolveExtension().id}/${CONNECTION_PAGE}`

// A silent connection page almost always means the extension is not in the
// profile Chrome opened. The Store is only the right answer for the Store id;
// an overridden id is a developer's choice.
export function explainNotConnected(): string {
  const { id, source } = resolveExtension()
  if (source === 'store') {
    return `TabBrew extension is not installed or not enabled in Chrome; install it from ${PRODUCT_STORE_URL}, then run "tabbrew session start" again`
  }
  const via = source === 'env' ? 'TABBREW_EXTENSION_ID' : PROJECT_CONFIG
  return `the connection page did not answer; ${via} points at ${id}, so load that build unpacked at chrome://extensions in the Chrome profile you use, or run "tabbrew init --extension store"`
}

// TABBREW_CHROME names a launcher that takes the URL as its only argument;
// tests point it at a script and a user can point it at a specific browser.
function launcher(url: string): [string, ...string[]] {
  const custom = process.env.TABBREW_CHROME
  if (custom) return [custom, url]
  switch (process.platform) {
    case 'darwin':
      return ['open', '-a', 'Google Chrome', url]
    case 'win32':
      return ['cmd', '/c', 'start', '', 'chrome', url]
    default:
      return ['google-chrome', url]
  }
}

export function openInChrome(url: string): void {
  const [cmd, ...args] = launcher(url)
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

export async function waitForListening(
  session: SessionInfo,
  ms = CONNECT_WAIT_MS,
): Promise<SessionInfo | null> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const found = await probe(session.port)
    if (found?.listening) return found
    await Bun.sleep(100)
  }
  return null
}

// Opens the connection page and reports whether the session ended up connected.
export async function connect(session: SessionInfo): Promise<SessionInfo | null> {
  if (session.listening) return session
  openInChrome(connectionUrl())
  return waitForListening(session)
}
