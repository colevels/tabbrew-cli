import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { type ServedEvent, serveOperators } from '../utils/channel'
import { createOperators } from '../utils/operators'
import { discover, formatUptime, HOST, PORTS, type SessionInfo } from '../utils/session'

// Well inside the session's idle window, so an open panel keeps it alive.
const POLL_MS = 3_000

const operators = createOperators(browser)

type Checked = { at: number; session: SessionInfo | null }

const Missing = () => (
  <section>
    <p>
      No session on {PORTS.map((port) => `${HOST}:${port}`).join(', ')}. Start one from a terminal:
    </p>
    <pre>tabbrew session start</pre>
    <p className="muted">This panel checks again every few seconds.</p>
  </section>
)

const describeServed = (served: ServedEvent, now: number): string => {
  const outcome = served.error ? `failed: ${served.error}` : 'ok'
  return `last: ${served.operator} ${outcome} · ${Math.round((now - served.at) / 1000)}s ago`
}

const Connected = ({
  session,
  served,
  now,
}: {
  session: SessionInfo
  served: ServedEvent | null
  now: number
}) => {
  const mine = browser.runtime.getManifest().version
  return (
    <section>
      <dl>
        <dt>Address</dt>
        <dd>
          {HOST}:{session.port}
        </dd>
        <dt>PID</dt>
        <dd>{session.pid}</dd>
        <dt>CLI</dt>
        <dd>v{session.version}</dd>
        <dt>Uptime</dt>
        <dd>{formatUptime(session.uptimeMs)}</dd>
      </dl>
      {session.version !== mine && (
        <p className="muted">
          This panel is v{mine}; the session was started by tabbrew v{session.version}.
        </p>
      )}
      <p className="muted">{served ? describeServed(served, now) : 'listening for commands'}</p>
      <p className="muted">The session stays alive while this page is open.</p>
    </section>
  )
}

// onLost fires once a session this page was serving stops answering.
export const App = ({ onLost }: { onLost?: () => void }) => {
  const [checked, setChecked] = useState<Checked | null>(null)
  const [served, setServed] = useState<ServedEvent | null>(null)
  const [now, setNow] = useState(Date.now())
  const [wasServing, setWasServing] = useState(false)

  const session = checked?.session ?? null
  const port = session?.port

  // Closing the page is how polling stops.
  useEffect(() => {
    const refresh = async () => setChecked({ at: Date.now(), session: await discover() })
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (port !== undefined) setWasServing(true)
    else if (wasServing) onLost?.()
  }, [port, wasServing, onLost])

  // Keyed on the port, not the session: every poll hands back a fresh object
  // and the channel must outlive them.
  useEffect(() => {
    if (port === undefined) return
    const controller = new AbortController()
    void serveOperators({ port, operators, signal: controller.signal, onServed: setServed })
    return () => controller.abort()
  }, [port])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <h1>
        <span className={session ? 'dot on' : 'dot'} />
        TabBrew CLI Harness
      </h1>
      <p className="muted">Development harness for the tabbrew CLI. Not the product extension.</p>

      {checked &&
        (session ? <Connected session={session} served={served} now={now} /> : <Missing />)}

      {checked && <p className="muted">checked {Math.round((now - checked.at) / 1000)}s ago</p>}
    </>
  )
}
