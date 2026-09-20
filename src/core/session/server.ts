import {
  type CommandDeclaration,
  type DeclareResponse,
  parseDeclaration,
  RESERVED_NAMESPACES,
  type Registry,
} from '../commands/declaration'
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
import { createWindowLabels } from './labels'
import {
  COMMANDS_PATH,
  matchCommandPath,
  matchOperatorPath,
  matchResultPath,
  NEXT_REQUEST_PATH,
  type OperatorFailureCode,
  OWNER_PARAMETER,
  type SessionRequest,
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
  // Every time a declaration changes what the plugins offer.
  onRegistryChange?: (registry: Registry) => void
}

type Timer = ReturnType<typeof setTimeout>

// Without an owner a poller or a claimer is a page that never declared: the
// Store extension and every SDK before plugins.
interface PendingRequest {
  request: SessionRequest
  timeoutMs: number
  settle: (response: Response) => void
  timer?: Timer
  claimer?: string
}

interface Poller {
  owner?: string
  deliver: (response: Response) => void
}

// What one page declared. Two pages of one extension that declare the same
// thing share one; pages that declare different things each keep their own, so
// neither evicts the other.
interface Registration {
  owner: string
  extensionId: string
  fingerprint: string
  operators: string[]
  namespaces: Map<string, string[]>
}

// The first extension to declare a namespace holds it for the life of the
// session, its page open or not: a namespace that changed hands when a page
// closed would send the next call to whoever asked second.
interface Plugin {
  extensionId: string
  page?: string
  description: string
  commands: Record<string, CommandDeclaration>
}

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/
const MAX_DECLARATION_BYTES = 256 * 1024
const MAX_REGISTRATIONS_PER_EXTENSION = 8

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
    onRegistryChange,
  }: ServerOptions = {},
): SessionServer {
  const startedAt = Date.now()
  let lastUsed = startedAt
  let stopped = false

  const queue: PendingRequest[] = []
  const claimed = new Map<string, PendingRequest>()
  const pollers: Poller[] = []
  const registrations = new Map<string, Registration>()
  const plugins = new Map<string, Plugin>()
  const labels = createWindowLabels()

  const remove = <T>(list: T[], item: T): void => {
    const at = list.indexOf(item)
    if (at !== -1) list.splice(at, 1)
  }

  function canServe(owner: string | undefined, request: SessionRequest): boolean {
    const registration = owner === undefined ? undefined : registrations.get(owner)
    if ('namespace' in request) {
      return (
        registration !== undefined &&
        plugins.get(request.namespace)?.extensionId === registration.extensionId &&
        registration.namespaces.get(request.namespace)?.includes(request.command) === true
      )
    }
    return registration ? registration.operators.includes(request.operator) : owner === undefined
  }

  // The pages here right now: a registration outlives its page, a poll or a
  // claim does not.
  const present = (): (string | undefined)[] => [
    ...pollers.map((poller) => poller.owner),
    ...[...claimed.values()].map((pending) => pending.claimer),
  ]

  const servesOperators = (owner: string | undefined): boolean =>
    owner === undefined || (registrations.get(owner)?.operators.length ?? 0) > 0

  const registry = (): Registry =>
    Object.fromEntries(
      [...plugins].map(([namespace, plugin]) => [
        namespace,
        {
          ...plugin,
          connected: present().some((owner) => {
            const registration = owner === undefined ? undefined : registrations.get(owner)
            return (
              registration?.extensionId === plugin.extensionId &&
              registration.namespaces.has(namespace)
            )
          }),
        },
      ]),
    )

  function claim(pending: PendingRequest, claimer: string | undefined): Response {
    clearTimeout(pending.timer)
    lastUsed = Date.now()
    pending.claimer = claimer
    claimed.set(pending.request.id, pending)
    pending.timer = setTimeout(() => {
      claimed.delete(pending.request.id)
      pending.settle(failure('timeout', 504))
    }, pending.timeoutMs)
    return json(pending.request)
  }

  function enqueue(request: SessionRequest, timeoutMs: number): Promise<Response> {
    const { promise, resolve } = Promise.withResolvers<Response>()
    const pending: PendingRequest = { request, timeoutMs, settle: resolve }
    const poller = pollers.find((candidate) => canServe(candidate.owner, request))
    if (poller) {
      poller.deliver(claim(pending, poller.owner))
      return promise
    }
    queue.push(pending)
    const giveUp = (response: Response) => {
      remove(queue, pending)
      pending.settle(response)
    }
    // A page busy with an earlier request is not polling; give it an operator's
    // time before answering, and then say busy rather than absent. A command
    // may run far longer than that, and one page serves one request at a time.
    pending.timer = setTimeout(() => {
      const busy = [...claimed.values()].some((earlier) => canServe(earlier.claimer, request))
      if (!busy) return giveUp(failure('no_panel', 503))
      pending.timer = setTimeout(() => giveUp(failure('timeout', 504, 'busy')), operatorTimeoutMs)
    }, claimWaitMs)
    return promise
  }

  async function call(name: string, req: Request, holder: RequestHolder): Promise<Response> {
    if (!fromShell(req)) return failure('forbidden', 403)
    if (!isOperatorName(name)) return failure('unknown_operator', 404)
    const input: unknown = await req.json().catch(() => undefined)
    if (input === undefined) return failure('bad_request', 400)
    lastUsed = Date.now()
    const request = { id: crypto.randomUUID(), operator: name, input }
    // Every page here said what it serves and none serves this: waiting for a
    // claim would end in a timeout that says nothing.
    const serving = present().filter(servesOperators)
    if (serving.length > 0 && !serving.some((owner) => canServe(owner, request))) {
      return failure('unknown_operator', 404, 'not served by the connected extension')
    }
    holder.timeout(req, holdSeconds(claimWaitMs + 2 * operatorTimeoutMs))
    return enqueue(request, operatorTimeoutMs)
  }

  async function callCommand(
    namespace: string,
    command: string,
    req: Request,
    holder: RequestHolder,
  ): Promise<Response> {
    if (!fromShell(req)) return failure('forbidden', 403)
    const commands = plugins.get(namespace)?.commands
    // The names came over the wire, and `constructor` is a name.
    if (!commands || !Object.hasOwn(commands, command)) return failure('unknown_operator', 404)
    const input: unknown = await req.json().catch(() => undefined)
    if (input === undefined) return failure('bad_request', 400)
    lastUsed = Date.now()
    const timeoutMs = commands[command]?.timeoutMs ?? operatorTimeoutMs
    holder.timeout(req, holdSeconds(claimWaitMs + operatorTimeoutMs + timeoutMs))
    return enqueue({ id: crypto.randomUUID(), namespace, command, input }, timeoutMs)
  }

  async function declare(req: Request): Promise<Response> {
    const extensionId = EXTENSION_ORIGIN.exec(req.headers.get('origin') ?? '')?.[1]
    if (!extensionId) return failure('forbidden', 403)
    lastUsed = Date.now()
    if (Number(req.headers.get('content-length') ?? 0) > MAX_DECLARATION_BYTES) {
      return failure('bad_commands', 400)
    }
    const body = await req.text().catch(() => '')
    if (body.length > MAX_DECLARATION_BYTES) return failure('bad_commands', 400)
    let raw: unknown
    try {
      raw = JSON.parse(body)
    } catch {
      return failure('bad_commands', 400)
    }
    const parsed = parseDeclaration(raw)
    if (!parsed) return failure('bad_commands', 400)
    const { declaration, invalidNamespaces, dropped } = parsed

    const rejected: DeclareResponse['rejected'] = Object.fromEntries(
      invalidNamespaces.map((namespace) => [namespace, 'bad_commands']),
    )
    const namespaces = new Map<string, string[]>()
    let changed = false
    for (const [namespace, { description, commands }] of Object.entries(declaration.namespaces)) {
      const holder = plugins.get(namespace)
      if (RESERVED_NAMESPACES.includes(namespace)) rejected[namespace] = 'reserved'
      else if (holder && holder.extensionId !== extensionId) rejected[namespace] = 'namespace_taken'
      else {
        const plugin: Plugin = { extensionId, page: declaration.page, description, commands }
        changed ||= JSON.stringify(holder) !== JSON.stringify(plugin)
        plugins.set(namespace, plugin)
        namespaces.set(namespace, Object.keys(commands))
      }
    }

    const fingerprint = String(Bun.hash(JSON.stringify(declaration)))
    const own = [...registrations.values()].filter((known) => known.extensionId === extensionId)
    let registration = own.find((known) => known.fingerprint === fingerprint)
    if (!registration) {
      // An extension that keeps declaring something new must not grow the
      // session without bound; a page still here keeps its token.
      const here = present()
      const idle = own.filter((known) => !here.includes(known.owner))
      if (own.length >= MAX_REGISTRATIONS_PER_EXTENSION && idle[0]) {
        registrations.delete(idle[0].owner)
      }
      registration = {
        owner: crypto.randomUUID(),
        extensionId,
        fingerprint,
        operators: declaration.operators,
        namespaces,
      }
      registrations.set(registration.owner, registration)
    }
    registration.namespaces = namespaces

    if (changed) onRegistryChange?.(registry())
    return json({
      owner: registration.owner,
      commandsVersion: declaration.commandsVersion,
      accepted: [...namespaces.keys()],
      rejected,
      dropped: dropped.filter((path) => namespaces.has(path.slice(0, path.indexOf('.')))),
    } satisfies DeclareResponse)
  }

  function poll(req: Request, holder: RequestHolder): Response | Promise<Response> {
    lastUsed = Date.now()
    const owner = new URL(req.url).searchParams.get(OWNER_PARAMETER) ?? undefined
    // A token this process never issued: the session restarted, and only
    // declaring again helps.
    if (owner !== undefined && !registrations.has(owner)) return failure('unknown_owner', 410)
    const next = queue.find((pending) => canServe(owner, pending.request))
    if (next) {
      remove(queue, next)
      return claim(next, owner)
    }

    holder.timeout(req, holdSeconds(longPollMs))
    const { promise, resolve } = Promise.withResolvers<Response>()
    const poller: Poller = {
      owner,
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
      const output =
        'operator' in pending.request && pending.request.operator === 'readSnapshot'
          ? labels.stamp(body.output)
          : body.output
      pending.settle(json({ output }))
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
          // A page that only adds commands cannot answer `tabs list`.
          listening: present().some(servesOperators),
        })
      }

      if (req.method === 'POST' && pathname === '/stop') {
        if (!fromShell(req)) return json({ error: 'forbidden' }, 403)
        setTimeout(() => void stop('stop requested'), 0)
        return json({ ok: true })
      }

      if (req.method === 'GET' && pathname === NEXT_REQUEST_PATH) return poll(req, self)

      if (req.method === 'POST' && pathname === COMMANDS_PATH) return declare(req)
      if (req.method === 'GET' && pathname === COMMANDS_PATH) {
        return fromShell(req) ? json(registry()) : failure('forbidden', 403)
      }

      const operator = matchOperatorPath(pathname)
      if (req.method === 'POST' && operator !== null) return call(operator, req, self)

      const plugin = matchCommandPath(pathname)
      if (req.method === 'POST' && plugin !== null) {
        return callCommand(plugin.namespace, plugin.command, req, self)
      }

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
