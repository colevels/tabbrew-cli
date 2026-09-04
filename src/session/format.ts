import type { SessionInfo } from "./client"
import { HOST, VERSION } from "./config"

export function describe(session: SessionInfo, state: string): string {
  const line = `session ${state} on ${HOST}:${session.port} · pid ${session.pid} · v${session.version} · up ${uptime(session.uptimeMs)}`
  if (session.version === VERSION) return line
  return `${line}\nnote: this binary is v${VERSION}; run "tabbrew session stop" then "start" to upgrade`
}

function uptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
