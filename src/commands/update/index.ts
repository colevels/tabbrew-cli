import { Command } from 'commander'
import {
  checkForUpdate,
  isCompiledBinary,
  performUpdate,
  UpdateError,
  VERSION,
} from '../../core/update'

export const update = new Command('update')
  .description('Update the installed tabbrew binary to the latest release')
  .option('--check', 'report whether a newer release exists; change nothing')
  .option('--json', 'machine-readable output')
  .action(async (opts: { check?: boolean; json?: boolean }) => {
    try {
      if (opts.check) {
        const info = await checkForUpdate()
        if (opts.json) console.log(JSON.stringify(info))
        else if (info.updateAvailable) {
          console.log(`update available: ${info.current} → ${info.latest}; run "tabbrew update"`)
        } else console.log(`tabbrew is up to date (${info.current})`)
        return
      }
      if (!isCompiledBinary()) {
        console.error(
          `tabbrew ${VERSION} is running from npm or a source checkout, which "tabbrew update" cannot replace.\n` +
            'npm: npm install -g tabbrew-cli@latest\nsource: git pull && bun run build',
        )
        process.exitCode = 1
        return
      }
      const { info, replaced } = await performUpdate()
      if (opts.json) {
        console.log(JSON.stringify({ ...info, replaced }))
        return
      }
      if (!replaced) {
        console.log(`tabbrew is up to date (${info.current})`)
        return
      }
      console.log(`updated tabbrew ${info.current} → ${info.latest}`)
      console.log(
        'next: tabbrew session stop, then tabbrew session start; ' +
          'and load the matching tabbrew-extension.zip from the release in chrome://extensions',
      )
    } catch (err) {
      if (!(err instanceof UpdateError)) throw err
      console.error(err.message)
      process.exitCode = 1
    }
  })
