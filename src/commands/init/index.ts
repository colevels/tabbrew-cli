import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command, Option } from 'commander'
import { AGENTS, type Agent, install, render, uninstall } from '../../core/agent-docs'
import {
  CHROME_EXTENSION_ID,
  extensionId,
  PROJECT_CONFIG,
  writeProjectExtensionId,
} from '../../core/session'

type Opts = {
  agent?: Agent
  path?: string[]
  remove?: boolean
  print?: boolean
  extension?: string
}

// `store` clears the project's choice so the Web Store build is opened again.
function resolveExtension(value: string): string | null {
  if (value === 'store') return null
  if (value === 'harness') return extensionId()
  if (CHROME_EXTENSION_ID.test(value)) return value
  throw new Error(`extension must be store, harness or a 32-letter Chrome extension id: ${value}`)
}

export const init = new Command('init')
  .description('Write the TabBrew cheat sheet for AI coding agents (CLAUDE.md by default)')
  .addOption(new Option('--agent <tool>', "which tool's file to target").choices(AGENTS))
  .option('--path <file...>', 'explicit file(s) to write, relative to the current directory')
  .option(
    '--extension <store|harness|id>',
    `which extension build "session start" opens from this project, kept in ${PROJECT_CONFIG}`,
  )
  .option('--remove', 'remove the managed block from every known agent doc file')
  .option('--print', 'print the block to stdout instead of writing files')
  .action((opts: Opts, cmd: Command) => {
    const cwd = process.cwd()
    const program = cmd.parent ?? cmd
    try {
      if (opts.extension !== undefined && (opts.print || opts.remove)) {
        throw new Error('--extension cannot be combined with --print or --remove')
      }
      const extension = opts.extension === undefined ? undefined : resolveExtension(opts.extension)
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
      if (extension !== undefined) {
        const had = existsSync(join(cwd, PROJECT_CONFIG))
        writeProjectExtensionId(cwd, extension)
        if (extension === null) {
          console.log(
            `extension → Web Store (default); ${had ? 'removed from' : 'nothing to remove in'} ${PROJECT_CONFIG}`,
          )
        } else {
          const label = opts.extension === 'harness' ? `harness (${extension})` : extension
          console.log(`extension → ${label} in ${PROJECT_CONFIG}`)
        }
      }
      console.log('next: tabbrew session start')
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    }
  })
