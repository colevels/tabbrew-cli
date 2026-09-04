import { Command } from "commander"
import { discover } from "../../session/client"
import { HOST, PORTS, VERSION } from "../../session/config"
import { describe } from "../../session/format"

export const status = new Command("status")
  .description("Show whether a session is running (exit 1 if not)")
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const session = await discover()

    if (opts.json) {
      console.log(
        JSON.stringify(
          session ? { running: true, ...session, cli: VERSION } : { running: false, cli: VERSION },
        ),
      )
    } else if (session) {
      console.log(describe(session, "running"))
    } else {
      console.log(`no session running (checked ${HOST}:${PORTS.join(", ")})`)
    }

    process.exitCode = session ? 0 : 1
  })
