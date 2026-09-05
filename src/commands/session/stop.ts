import { Command } from 'commander'
import { discover, HOST, stopSession } from '../../core/session'

export const stop = new Command('stop').description('Stop the running session').action(async () => {
  const session = await discover()
  if (!session) {
    console.log('no session running')
    return
  }
  const where = `${HOST}:${session.port} · pid ${session.pid}`
  if (!(await stopSession(session))) {
    console.error(`session on ${where} did not stop`)
    process.exitCode = 1
    return
  }
  console.log(`session stopped on ${where}`)
})
