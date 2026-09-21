// Test helpers. Bun's fetch looks like a shell to the session: no Origin, no
// Sec-Fetch-*. These make a request look like an extension page's instead.

import { COMMANDS_PATH } from './protocol'

export const fromBrowser = { headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors' } }

// Only the requests a page makes are stamped, so one process can play the
// extension and the shell at once. Returns the way back.
export function asExtension(extensionId: string): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((...sent: ConstructorParameters<typeof Request>) => {
    const request = new Request(...sent)
    const { pathname } = new URL(request.url)
    if (
      pathname.startsWith('/requests/') ||
      (request.method === 'POST' && pathname === COMMANDS_PATH)
    ) {
      request.headers.set('origin', `chrome-extension://${extensionId}`)
      request.headers.set('sec-fetch-site', 'none')
    }
    return original(request)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
