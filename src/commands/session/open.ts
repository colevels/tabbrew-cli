import { Command } from 'commander'
import { connect, connectionUrl, describe, discover } from '../../core/session'

export const open = new Command('open')
  .description('Open the connection page in Chrome so the session can drive it')
  .action(async () => {
    const session = await discover()
    if (!session) {
      console.error('no session running; run "tabbrew session start"')
      process.exitCode = 1
      return
    }
    const connected = await connect(session)
    if (!connected) {
      console.error(
        `the connection page did not answer; open ${connectionUrl()} in the Chrome profile where the harness is loaded`,
      )
      process.exitCode = 1
      return
    }
    console.log(describe(connected, 'connected'))
  })
