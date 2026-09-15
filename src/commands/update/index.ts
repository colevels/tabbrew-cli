import { homedir } from 'node:os'
import { Command } from 'commander'
import { discover } from '../../core/session'
import {
  checkForUpdate,
  HOMEBREW_UPGRADE_HINT,
  installedViaHomebrew,
  isCompiledBinary,
  performUpdate,
  REPOSITORY,
  UpdateError,
  VERSION,
} from '../../core/update'

const step = (text: string) => console.log(`==> ${text.replace(homedir(), '~')}`)
const latest = (version: string) => `tabbrew ${version} is the latest release`

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
          const upgrade = installedViaHomebrew() ? 'brew upgrade tabbrew' : 'tabbrew update'
          console.log(`A new release of tabbrew is available: ${info.current} → ${info.latest}`)
          console.log(`To upgrade, run: ${upgrade}`)
          console.log(`https://github.com/${REPOSITORY}/releases/tag/v${info.latest}`)
        } else console.log(latest(info.current))
        return
      }
      if (installedViaHomebrew()) {
        console.error(HOMEBREW_UPGRADE_HINT)
        process.exitCode = 1
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
      const { info, replaced } = await performUpdate(opts.json ? undefined : step)
      if (opts.json) {
        console.log(JSON.stringify({ ...info, replaced }))
        return
      }
      if (!replaced) {
        console.log(latest(info.current))
        return
      }
      console.log(`🍵  tabbrew ${info.current} → ${info.latest}`)
      // The running session keeps serving the old binary until it restarts.
      if (await discover()) {
        console.log('')
        console.log('==> Next steps')
        console.log('  A session is still running on the old version. Restart it:')
        console.log('    tabbrew session stop && tabbrew session start')
      }
    } catch (err) {
      if (!(err instanceof UpdateError)) throw err
      console.error(err.message)
      process.exitCode = 1
    }
  })
