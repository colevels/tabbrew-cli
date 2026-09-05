import type { SessionInfo } from './client'
import { HOST, VERSION } from './config'
import { formatUptime } from './protocol'

export function describe(session: SessionInfo, state: string): string {
  const line = `session ${state} on ${HOST}:${session.port} · pid ${session.pid} · v${session.version} · up ${formatUptime(session.uptimeMs)}`
  if (session.version === VERSION) return line
  return `${line}\nnote: this binary is v${VERSION}; run "tabbrew session stop" then "start" to upgrade`
}
