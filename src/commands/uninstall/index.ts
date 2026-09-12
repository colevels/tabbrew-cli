import { Command } from 'commander'
import { HOST } from '../../core/session'
import { describeUninstall, performUninstall, type UninstallPlan } from '../../core/uninstall'
import { UpdateError } from '../../core/update'
import { helpSections } from '../help'

const NPM_OR_SOURCE =
  'binary: skipped, tabbrew is running from npm or a source checkout\n' +
  '  npm: npm uninstall -g tabbrew-cli\n  source: bun unlink'

function describe(plan: UninstallPlan, dryRun: boolean): string[] {
  const stop = dryRun ? 'would stop' : 'stopped'
  const remove = dryRun ? 'would remove' : 'removed'
  return [
    plan.session
      ? `session: ${stop} ${HOST}:${plan.session.port} · pid ${plan.session.pid}`
      : 'session: none running',
    `state: ${remove} ${plan.stateDirectory}`,
    plan.binary ? `binary: ${remove} ${plan.binary}` : NPM_OR_SOURCE,
    '',
    'still to do by hand:',
    '  - remove the TabBrew extension in chrome://extensions',
    dryRun
      ? '  - run `tabbrew init --remove` in repos that carry the cheat sheet, before uninstalling'
      : '  - strip the cheat sheet from repos that carry it: `bunx tabbrew-cli init --remove`, or delete the TABBREW block by hand',
  ]
}

export const uninstall = new Command('uninstall')
  .description('Remove the session state and the installed tabbrew binary')
  .option('--dry-run', 'show what would be removed; change nothing')
  .option('--json', 'machine-readable output')
  .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
    const plan = await describeUninstall()
    try {
      if (!opts.dryRun) await performUninstall(plan)
    } catch (err) {
      if (!(err instanceof UpdateError)) throw err
      console.error(err.message)
      process.exitCode = 1
      return
    }
    if (opts.json) {
      console.log(JSON.stringify({ ...plan, removed: !opts.dryRun }))
      return
    }
    console.log(describe(plan, Boolean(opts.dryRun)).join('\n'))
  })

helpSections(uninstall, {
  examples: ['tabbrew uninstall --dry-run', 'tabbrew uninstall'],
  note: 'npm and source installs keep their binary: remove those with npm uninstall -g tabbrew-cli or bun unlink.',
})
