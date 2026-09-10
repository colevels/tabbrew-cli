import { Command, Option } from 'commander'
import { AGENTS, type Agent, install, render, uninstall } from '../../core/agent-docs'

type Opts = { agent?: Agent; path?: string[]; remove?: boolean; print?: boolean }

export const init = new Command('init')
  .description('Write the TabBrew cheat sheet for AI coding agents (CLAUDE.md by default)')
  .addOption(new Option('--agent <tool>', "which tool's file to target").choices(AGENTS))
  .option('--path <file...>', 'explicit file(s) to write, relative to the current directory')
  .option('--remove', 'remove the managed block from every known agent doc file')
  .option('--print', 'print the block to stdout instead of writing files')
  .action((opts: Opts, cmd: Command) => {
    const cwd = process.cwd()
    const program = cmd.parent ?? cmd
    try {
      if (opts.print) {
        console.log(render(program))
        return
      }
      if (opts.remove) {
        const { removed, deleted } = uninstall(cwd)
        for (const rel of removed) console.log(`agent docs removed from ${rel}`)
        for (const rel of deleted) console.log(`removed empty ${rel}`)
        if (!removed.length && !deleted.length) console.log('no agent docs found')
        return
      }
      const written = install(cwd, render(program), { agent: opts.agent, paths: opts.path })
      console.log(`agent docs written → ${written.join(', ')}`)
      console.log('next: tabbrew session start')
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    }
  })
