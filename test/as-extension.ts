// Bun's fetch looks like a shell to the session: no Origin, no Sec-Fetch-*.
// This stamps the requests an extension page makes (declaring, polling,
// answering) the way Chrome would, and leaves the shell's calls alone.
export function asExtension(extensionId: string): () => void {
  const plain = globalThis.fetch
  const stamped = (input: string | URL | Request, init: RequestInit = {}) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input)
    const fromPage =
      pathname.startsWith('/requests/') || (pathname === '/commands' && init.method === 'POST')
    if (!fromPage) return plain(input, init)
    const headers = new Headers(init.headers)
    headers.set('origin', `chrome-extension://${extensionId}`)
    headers.set('sec-fetch-site', 'cross-site')
    return plain(input, { ...init, headers })
  }
  globalThis.fetch = Object.assign(stamped, plain)
  return () => {
    globalThis.fetch = plain
  }
}
