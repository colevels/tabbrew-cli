import { Command } from 'commander'
import {
  connect,
  describe,
  discover,
  explainNotConnected,
  HOST,
  LOG_PATH,
  PORTS,
  SPAWN_WAIT_MS,
  spawnDetached,
  waitForSession,
} from '../../core/session'
import type { SessionInfo } from '../../core/session/protocol'

async function report(session: SessionInfo, state: string, open: boolean): Promise<void> {
  if (!open) {
    console.log(describe(session, state))
    return
  }
  const connected = await connect(session)
  if (connected) {
    console.log(describe(connected, `${state}, connected`))
    return
  }
  console.log(describe(session, state))
  console.error(explainNotConnected())
  process.exitCode = 1
}

export const start = new Command('start')
  .description(
    'Start the session in the background and connect Chrome to it (no-op if one is running)',
  )
  .option('--no-open', 'do not open the connection page in Chrome')
  .action(async (opts: { open: boolean }) => {
    const existing = await discover()
    if (existing) {
      await report(existing, 'already running', opts.open)
      return
    }

    spawnDetached()
    const session = await waitForSession()
    if (!session) {
      console.error(
        `session did not answer on ${HOST}:${PORTS.join('/')} within ${SPAWN_WAIT_MS}ms\n` +
          `see ${LOG_PATH}, or run it in the foreground: tabbrew session run`,
      )
      process.exitCode = 1
      return
    }
    await report(session, 'started', opts.open)
  })
