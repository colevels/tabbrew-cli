import { Command } from 'commander'
import { describe, discover, HOST, listen, PORTS, VERSION } from '../../core/session'

export const run = new Command('run')
  .description('Run the session in the foreground (what `start` launches)')
  .action(async () => {
    const existing = await discover()
    if (existing) {
      console.error(describe(existing, 'already running'))
      process.exitCode = 1
      return
    }

    const server = listen(PORTS, {
      onStop(reason) {
        console.log(`session stopped (${reason})`)
        process.exit(0)
      },
    })

    // tabbrew-desktop watches stdout for this line to know the bridge is up.
    console.log(`session ready on ${HOST}:${server.port} (pid ${process.pid}, v${VERSION})`)

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => void server.stop(signal))
    }
  })
