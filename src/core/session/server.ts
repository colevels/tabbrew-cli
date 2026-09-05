import { HOST, IDLE_EXIT_MS, SERVICE, VERSION } from './config'

export interface SessionServer {
  port: number
  stop(reason: string): Promise<void>
}

export interface ServerOptions {
  idleMs?: number
  onStop?: (reason: string) => void
}

// A browser stamps Sec-Fetch-* on every request and page script cannot strip
// them, so their absence means a local process. Only those may stop us.
const fromShell = (req: Request): boolean =>
  !req.headers.has('sec-fetch-site') && req.headers.get('origin') === null

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'x-tabbrew-version': VERSION } })

export function createServer(
  port: number,
  { idleMs = IDLE_EXIT_MS, onStop }: ServerOptions = {},
): SessionServer {
  const startedAt = Date.now()
  let lastUsed = startedAt
  let stopped = false

  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch(req, self): Response {
      const { pathname } = new URL(req.url)

      if (req.method === 'GET' && pathname === '/health') {
        // A shell `status` poll must not keep a session nobody needs alive;
        // an open extension panel polling from the browser is someone using it.
        if (!fromShell(req)) lastUsed = Date.now()
        return json({
          service: SERVICE,
          version: VERSION,
          pid: process.pid,
          port: self.port,
          uptimeMs: Date.now() - startedAt,
        })
      }

      if (req.method === 'POST' && pathname === '/stop') {
        if (!fromShell(req)) return json({ error: 'forbidden' }, 403)
        setTimeout(() => void stop('stop requested'), 0)
        return json({ ok: true })
      }

      lastUsed = Date.now()
      return json({ error: 'not_found' }, 404)
    },
  })

  const tick = Math.max(10, Math.min(5_000, idleMs / 2))
  const janitor = setInterval(() => {
    if (Date.now() - lastUsed > idleMs) void stop(`idle for ${idleMs}ms`)
  }, tick)

  async function stop(reason: string): Promise<void> {
    if (stopped) return
    stopped = true
    clearInterval(janitor)
    // Close keep-alive connections too, or a client reusing one still gets answers.
    await server.stop(true)
    onStop?.(reason)
  }

  return { port: server.port ?? port, stop }
}

const isAddrInUse = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'EADDRINUSE'

export function listen(ports: readonly number[], options: ServerOptions = {}): SessionServer {
  for (const port of ports) {
    try {
      return createServer(port, options)
    } catch (e) {
      if (!isAddrInUse(e)) throw e
    }
  }
  throw new Error(`every port is taken: ${ports.map((p) => `${HOST}:${p}`).join(', ')}`)
}
