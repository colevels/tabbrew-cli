import { isOperatorName } from '../operators/contract'
import {
  CLAIM_WAIT_MS,
  HOST,
  IDLE_EXIT_MS,
  LONG_POLL_MS,
  OPERATOR_TIMEOUT_MS,
  SERVICE,
  VERSION,
} from './config'
import {
  matchOperatorPath,
  matchResultPath,
  NEXT_REQUEST_PATH,
  type OperatorFailureCode,
  type OperatorRequest,
} from './protocol'

export interface SessionServer {
  port: number
  stop(reason: string): Promise<void>
}

export interface ServerOptions {
  idleMs?: number
  claimWaitMs?: number
  operatorTimeoutMs?: number
  longPollMs?: number
  onStop?: (reason: string) => void
}

type Timer = ReturnType<typeof setTimeout>

interface PendingRequest {
  request: OperatorRequest
  settle: (response: Response) => void
  timer?: Timer
}

interface Poller {
  deliver: (response: Response) => void
}

// The one thing a held route needs from Bun's server.
interface RequestHolder {
  timeout(request: Request, seconds: number): void
}

// A browser stamps Sec-Fetch-* on every request and page script cannot strip
// them, so their absence means a local process. Only those may stop us or
// drive Chrome: a page can fire a no-preflight POST at loopback.
const fromShell = (req: Request): boolean =>
  !req.headers.has('sec-fetch-site') && req.headers.get('origin') === null

const headers = { 'x-tabbrew-version': VERSION }

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers })

const empty = (status: number): Response => new Response(null, { status, headers })

const failure = (error: OperatorFailureCode, status: number, detail?: string): Response =>
  json(detail === undefined ? { error } : { error, detail }, status)

// Bun drops a handler still pending after its 10s idle timeout; a held route
// must ask for more, with slack for the answer to travel.
const holdSeconds = (ms: number): number => Math.ceil(ms / 1000) + 5

export function createServer(
  port: number,
  {
    idleMs = IDLE_EXIT_MS,
    claimWaitMs = CLAIM_WAIT_MS,
    operatorTimeoutMs = OPERATOR_TIMEOUT_MS,
    longPollMs = LONG_POLL_MS,
    onStop,
  }: ServerOptions = {},
): SessionServer {
  const startedAt = Date.now()
  let lastUsed = startedAt
  let stopped = false

  const queue: PendingRequest[] = []
  const claimed = new Map<string, PendingRequest>()
  const pollers: Poller[] = []

  const remove = <T>(list: T[], item: T): void => {
    const at = list.indexOf(item)
    if (at !== -1) list.splice(at, 1)
  }

  function claim(pending: PendingRequest): Response {
    clearTimeout(pending.timer)
    lastUsed = Date.now()
    claimed.set(pending.request.id, pending)
    pending.timer = setTimeout(() => {
      claimed.delete(pending.request.id)
      pending.settle(failure('timeout', 504))
    }, operatorTimeoutMs)
    return json(pending.request)
  }

  function enqueue(request: OperatorRequest): Promise<Response> {
    const { promise, resolve } = Promise.withResolvers<Response>()
    const pending: PendingRequest = { request, settle: resolve }
    const poller = pollers.shift()
    if (poller) {
      poller.deliver(claim(pending))
      return promise
    }
    queue.push(pending)
    const giveUp = () => {
      remove(queue, pending)
      pending.settle(failure('no_panel', 503))
    }
    // A panel busy with an earlier request is not polling; give it that
    // request's own time before calling it absent.
    pending.timer = setTimeout(() => {
      if (claimed.size > 0) pending.timer = setTimeout(giveUp, operatorTimeoutMs)
      else giveUp()
    }, claimWaitMs)
    return promise
  }

  async function call(name: string, req: Request, holder: RequestHolder): Promise<Response> {
    if (!fromShell(req)) return failure('forbidden', 403)
    if (!isOperatorName(name)) return failure('unknown_operator', 404)
    const input: unknown = await req.json().catch(() => undefined)
    if (input === undefined) return failure('bad_request', 400)
    lastUsed = Date.now()
    holder.timeout(req, holdSeconds(claimWaitMs + 2 * operatorTimeoutMs))
    return enqueue({ id: crypto.randomUUID(), operator: name, input })
  }

  function poll(req: Request, holder: RequestHolder): Response | Promise<Response> {
    lastUsed = Date.now()
    const next = queue.shift()
    if (next) return claim(next)

    holder.timeout(req, holdSeconds(longPollMs))
    const { promise, resolve } = Promise.withResolvers<Response>()
    const poller: Poller = {
      deliver(response) {
        clearTimeout(timer)
        remove(pollers, poller)
        resolve(response)
      },
    }
    const timer = setTimeout(() => poller.deliver(empty(204)), longPollMs)
    // A panel that closed mid-hold must not stay first in line.
    req.signal.addEventListener('abort', () => poller.deliver(empty(204)))
    pollers.push(poller)
    return promise
  }

  async function result(id: string, req: Request): Promise<Response> {
    lastUsed = Date.now()
    const pending = claimed.get(id)
    if (!pending) return failure('unknown_request', 404)
    clearTimeout(pending.timer)
    claimed.delete(id)

    const raw: unknown = await req.json().catch(() => null)
    const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null
    if (body && 'output' in body) {
      pending.settle(json({ output: body.output }))
      return json({ ok: true })
    }
    if (typeof body?.error === 'string') {
      pending.settle(failure('operator_failed', 502, body.error))
      return json({ ok: true })
    }
    pending.settle(failure('operator_failed', 502, 'malformed result'))
    return failure('bad_request', 400)
  }

  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch(req, self): Response | Promise<Response> {
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

      if (req.method === 'GET' && pathname === NEXT_REQUEST_PATH) return poll(req, self)

      const operator = matchOperatorPath(pathname)
      if (req.method === 'POST' && operator !== null) return call(operator, req, self)

      const requestId = matchResultPath(pathname)
      if (req.method === 'POST' && requestId !== null) return result(requestId, req)

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
    // stop(true) drops sockets but never settles a handler still awaiting,
    // and a timer left behind keeps the process alive.
    for (const poller of pollers.splice(0)) poller.deliver(empty(204))
    for (const pending of [...queue.splice(0), ...claimed.values()]) {
      clearTimeout(pending.timer)
      pending.settle(failure('stopping', 503))
    }
    claimed.clear()
    // The settled answers need a tick to leave before their sockets go.
    await Bun.sleep(0)
    // Close keep-alive connections too, or a client reusing one still gets answers.
    await server.stop(true)
    onStop?.(reason)
  }

  return { port: server.port ?? port, stop }
}

export function listen(ports: readonly number[], options: ServerOptions = {}): SessionServer {
  for (const port of ports) {
    try {
      return createServer(port, options)
    } catch (e) {
      if (typeof e !== 'object' || e === null || (e as { code?: string }).code !== 'EADDRINUSE') {
        throw e
      }
    }
  }
  throw new Error(`every port is taken: ${ports.map((p) => `${HOST}:${p}`).join(', ')}`)
}
