import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import {
  createOperators,
  DEFAULT_PORTS,
  formatUptime,
  HOST,
  type ServedEvent,
  type SessionInfo,
  type SessionStatus,
  serveSession,
} from '../../../sdk/src/index'

const operators = createOperators(browser)

const Missing = () => (
  <section>
    <p>
      No session on {DEFAULT_PORTS.map((port) => `${HOST}:${port}`).join(', ')}. Start one from a
      terminal:
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
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [served, setServed] = useState<ServedEvent | null>(null)
  const [now, setNow] = useState(Date.now())

  const session = status?.state === 'connected' ? status.session : null

  // Closing the page is how serving stops.
  useEffect(() => {
    const controller = new AbortController()
    void serveSession({
      operators,
      signal: controller.signal,
      onStatus: setStatus,
      onServed: setServed,
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (status?.state === 'lost') onLost?.()
  }, [status, onLost])

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

      {status &&
        (session ? <Connected session={session} served={served} now={now} /> : <Missing />)}

      {status && <p className="muted">checked {Math.round((now - status.at) / 1000)}s ago</p>}
    </>
  )
}
