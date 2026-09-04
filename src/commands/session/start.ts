import { Command } from "commander"
import { discover, spawnDetached, waitForSession } from "../../session/client"
import { HOST, LOG_PATH, PORTS, SPAWN_WAIT_MS } from "../../session/config"
import { describe } from "../../session/format"

export const start = new Command("start")
  .description("Start the session in the background (no-op if one is running)")
  .action(async () => {
    const existing = await discover()
    if (existing) {
      console.log(describe(existing, "already running"))
      return
    }

    spawnDetached()
    const session = await waitForSession()
    if (!session) {
      console.error(
        `session did not answer on ${HOST}:${PORTS.join("/")} within ${SPAWN_WAIT_MS}ms\n` +
          `see ${LOG_PATH}, or run it in the foreground: tabbrew session run`,
      )
      process.exitCode = 1
      return
    }
    console.log(describe(session, "started"))
  })
