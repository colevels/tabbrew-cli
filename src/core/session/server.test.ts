import { afterEach, describe, expect, test } from 'bun:test'
import { SERVICE, VERSION } from './config'
import type { OperatorRequest } from './protocol'
import { createServer, type ServerOptions, type SessionServer } from './server'

const servers: SessionServer[] = []
const up = (options: ServerOptions = {}) => {
  const server = createServer(0, options)
  servers.push(server)
  return server
}
const url = (server: SessionServer, path: string) => `http://127.0.0.1:${server.port}${path}`
const fromBrowser = { headers: { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors' } }

const call = (server: SessionServer, name: string, input: unknown = {}) =>
  fetch(url(server, `/operators/${name}`), { method: 'POST', body: JSON.stringify(input) })
const poll = (server: SessionServer, init: RequestInit = {}) =>
  fetch(url(server, '/requests/next'), { ...fromBrowser, ...init })
const answer = (server: SessionServer, id: string, result: unknown) =>
  fetch(url(server, `/requests/${id}/result`), {
    method: 'POST',
    body: JSON.stringify(result),
    ...fromBrowser,
  })
const delivered = async (response: Promise<Response>): Promise<OperatorRequest> => {
  const res = await response
  expect(res.status).toBe(200)
  return (await res.json()) as OperatorRequest
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop('test teardown')))
})

describe('session server', () => {
  test('GET /health identifies the session', async () => {
    const server = up()
    const res = await fetch(url(server, '/health'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-tabbrew-version')).toBe(VERSION)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      service: SERVICE,
      version: VERSION,
      pid: process.pid,
      port: server.port,
    })
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0)
  })

  test('unknown routes are 404', async () => {
    const server = up()
    const res = await fetch(url(server, '/nope'))
    expect(res.status).toBe(404)
  })

  test('POST /stop from a browser is refused', async () => {
    const server = up()
    const res = await fetch(url(server, '/stop'), { method: 'POST', ...fromBrowser })
    expect(res.status).toBe(403)
    expect((await fetch(url(server, '/health'))).status).toBe(200)
  })

  test('POST /stop from a local process stops the server', async () => {
    let reason = ''
    const { promise: stopped, resolve } = Promise.withResolvers<void>()
    const server = up({
      onStop(why) {
        reason = why
        resolve()
      },
    })
    const res = await fetch(url(server, '/stop'), { method: 'POST' })
    expect(res.status).toBe(200)
    await stopped
    expect(reason).toBe('stop requested')
    await expect(fetch(url(server, '/health'))).rejects.toThrow()
  })

  test('an idle server stops itself', async () => {
    const stopped = new Promise<string>((resolve) => up({ idleMs: 60, onStop: resolve }))
    expect(await stopped).toContain('idle')
  })

  test('browser health polls keep an idle server alive', async () => {
    let reason = ''
    const { promise: stopped, resolve } = Promise.withResolvers<void>()
    const server = up({
      idleMs: 300,
      onStop(why) {
        reason = why
        resolve()
      },
    })
    // Twice the idle window, polling well inside it.
    for (let i = 0; i < 10; i++) {
      expect((await fetch(url(server, '/health'), fromBrowser)).status).toBe(200)
      await Bun.sleep(60)
    }
    expect(reason).toBe('')
    await stopped
    expect(reason).toContain('idle')
  })

  test('shell health polls do not keep an idle server alive', async () => {
    let reason = ''
    const { promise: stopped, resolve } = Promise.withResolvers<void>()
    const server = up({
      idleMs: 300,
      onStop(why) {
        reason = why
        resolve()
      },
    })
    const poll = setInterval(() => void fetch(url(server, '/health')).catch(() => {}), 60)
    await stopped
    clearInterval(poll)
    expect(reason).toContain('idle')
  })
})

describe('operator channel', () => {
  test('a shell call reaches a waiting panel and its result answers the call', async () => {
    const server = up()
    const waiting = poll(server)
    const calling = call(server, 'readSnapshot', {})
    const request = await delivered(waiting)
    expect(request).toMatchObject({ operator: 'readSnapshot', input: {} })
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/)

    expect((await answer(server, request.id, { output: { tabs: [] } })).status).toBe(200)
    const res = await calling
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: { tabs: [] } })
  })

  test('readSnapshot windows are labelled, and a label outlives the window it named', async () => {
    const server = up()
    const snapshot = async (ids: number[]) => {
      const calling = call(server, 'readSnapshot', {})
      const request = await delivered(poll(server))
      await answer(server, request.id, { output: { windows: ids.map((id) => ({ id })) } })
      const { output } = (await (await calling).json()) as {
        output: { windows: { id: number; label: string }[] }
      }
      return output.windows.map((window) => `${window.label}=${window.id}`)
    }
    expect(await snapshot([20, 10])).toEqual(['B=20', 'A=10'])
    expect(await snapshot([20, 30])).toEqual(['B=20', 'C=30'])

    const calling = call(server, 'focusTab', { tabId: 1 })
    const request = await delivered(poll(server))
    await answer(server, request.id, { output: { windows: [{ id: 40 }] } })
    expect(await (await calling).json()).toEqual({ output: { windows: [{ id: 40 }] } })
  })

  test('calls are served in order, one per poll', async () => {
    const server = up()
    const first = call(server, 'focusTab', { tabId: 1 })
    await Bun.sleep(20)
    const second = call(server, 'focusTab', { tabId: 2 })
    await Bun.sleep(20)

    const a = await delivered(poll(server))
    const b = await delivered(poll(server))
    expect(a.input).toEqual({ tabId: 1 })
    expect(b.input).toEqual({ tabId: 2 })
    expect(a.id).not.toBe(b.id)

    await answer(server, a.id, { output: 'a' })
    await answer(server, b.id, { output: 'b' })
    expect(await (await first).json()).toEqual({ output: 'a' })
    expect(await (await second).json()).toEqual({ output: 'b' })
  })

  test('a call from a browser is refused', async () => {
    const server = up()
    const res = await fetch(url(server, '/operators/readSnapshot'), {
      method: 'POST',
      body: '{}',
      ...fromBrowser,
    })
    expect(res.status).toBe(403)
  })

  test('an unknown operator or a body that is not JSON is rejected', async () => {
    const server = up()
    const unknown = await call(server, 'nope')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'unknown_operator' })

    const bad = await fetch(url(server, '/operators/readSnapshot'), { method: 'POST', body: '{' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'bad_request' })
  })

  test('a call nobody claims fails as no_panel', async () => {
    const server = up({ claimWaitMs: 50 })
    const res = await call(server, 'readSnapshot')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no_panel' })
  })

  test('a claimed call with no result times out, and the late result is refused', async () => {
    const server = up({ operatorTimeoutMs: 100 })
    const waiting = poll(server)
    const calling = call(server, 'readSnapshot')
    const request = await delivered(waiting)

    const res = await calling
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'timeout' })

    const late = await answer(server, request.id, { output: {} })
    expect(late.status).toBe(404)
    expect(await late.json()).toEqual({ error: 'unknown_request' })
  })

  test('an error from the panel is reported with its detail', async () => {
    const server = up()
    const waiting = poll(server)
    const calling = call(server, 'focusTab', { tabId: 9 })
    const request = await delivered(waiting)
    await answer(server, request.id, { error: 'tab 9 not found' })

    const res = await calling
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'operator_failed', detail: 'tab 9 not found' })
  })

  test('a malformed result is refused and fails the call', async () => {
    const server = up()
    const waiting = poll(server)
    const calling = call(server, 'readSnapshot')
    const request = await delivered(waiting)

    const refused = await answer(server, request.id, 'nonsense')
    expect(refused.status).toBe(400)
    const res = await calling
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'operator_failed', detail: 'malformed result' })
  })

  test('a poll with nothing to serve is released empty after the hold', async () => {
    const server = up({ longPollMs: 30 })
    const res = await poll(server)
    expect(res.status).toBe(204)
  })

  test('a result for an unknown request is 404', async () => {
    const server = up()
    const res = await answer(server, 'nope', { output: {} })
    expect(res.status).toBe(404)
  })

  test('stopping releases held polls and fails pending calls', async () => {
    const server = up({ longPollMs: 5_000, claimWaitMs: 5_000, operatorTimeoutMs: 5_000 })
    const first = poll(server)
    await Bun.sleep(20)
    const calling = call(server, 'readSnapshot')
    await delivered(first)
    const second = poll(server)
    await Bun.sleep(20)

    const started = Date.now()
    await server.stop('test')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect((await second).status).toBe(204)
    const res = await calling
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'stopping' })
  })

  test('a poll the panel abandoned is forgotten', async () => {
    const server = up({ longPollMs: 5_000, claimWaitMs: 200 })
    const abandoned = new AbortController()
    const gone = poll(server, { signal: abandoned.signal })
    await Bun.sleep(20)
    abandoned.abort()
    await expect(gone).rejects.toThrow()
    await Bun.sleep(20)

    const waiting = poll(server)
    await Bun.sleep(20)
    const calling = call(server, 'readSnapshot')
    const request = await delivered(waiting)
    await answer(server, request.id, { output: 1 })
    expect((await calling).status).toBe(200)
  })

  test('held polls keep an idle server alive', async () => {
    let reason = ''
    const { promise: stopped, resolve } = Promise.withResolvers<void>()
    const server = up({
      idleMs: 300,
      longPollMs: 30,
      onStop(why) {
        reason = why
        resolve()
      },
    })
    for (let i = 0; i < 10; i++) {
      expect((await poll(server)).status).toBe(204)
      await Bun.sleep(30)
    }
    expect(reason).toBe('')
    await stopped
    expect(reason).toContain('idle')
  })

  test('a call queued behind a busy panel waits instead of failing', async () => {
    const server = up({ claimWaitMs: 50, operatorTimeoutMs: 1_000 })
    const waiting = poll(server)
    const first = call(server, 'focusTab', { tabId: 1 })
    const busy = await delivered(waiting)
    const second = call(server, 'focusTab', { tabId: 2 })

    await Bun.sleep(150)
    await answer(server, busy.id, { output: 1 })
    expect((await first).status).toBe(200)

    const next = await delivered(poll(server))
    expect(next.input).toEqual({ tabId: 2 })
    await answer(server, next.id, { output: 2 })
    expect(await (await second).json()).toEqual({ output: 2 })
  })

  test(
    'a call held past ten seconds is still answered',
    async () => {
      const server = up({ operatorTimeoutMs: 11_000 })
      const waiting = poll(server)
      const calling = call(server, 'readSnapshot')
      const request = await delivered(waiting)
      await Bun.sleep(10_500)
      await answer(server, request.id, { output: 'late but fine' })
      const res = await calling
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ output: 'late but fine' })
    },
    { timeout: 15_000 },
  )
})
