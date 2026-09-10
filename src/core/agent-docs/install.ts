import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { inject, remove } from './block'
import { type Agent, discover, header, resolveTargets, type Targets } from './targets'

export type InstallOptions = { agent?: Agent; paths?: string[] }

export function install(cwd: string, block: string, options: InstallOptions = {}): string[] {
  const targets = options.paths?.length
    ? explicit(cwd, options.paths)
    : resolveTargets(cwd, options.agent)
  for (const rel of targets.inject) write(cwd, rel, inject(read(cwd, rel), block))
  for (const rel of targets.create) write(cwd, rel, inject(header(rel), block))
  return [...targets.inject, ...targets.create]
}

export type Removal = { removed: string[]; deleted: string[] }

export function uninstall(cwd: string): Removal {
  const result: Removal = { removed: [], deleted: [] }
  for (const rel of discover(cwd)) {
    const rest = remove(read(cwd, rel))
    if (rest === null) continue
    // A file that only ever held our header and block was ours to begin with.
    if (rest.trim() === '' || rest.trim() === header(rel)) {
      unlinkSync(join(cwd, rel))
      result.deleted.push(rel)
    } else {
      write(cwd, rel, rest)
      result.removed.push(rel)
    }
  }
  return result
}

// --path may point anywhere inside the project but never outside it: an
// absolute path or `..` would silently re-root the write. Every path is
// checked before anything is written so a rejected run leaves no trace.
function explicit(cwd: string, paths: string[]): Targets {
  const targets: Targets = { inject: [], create: [] }
  for (const p of paths) {
    const rel = relative(cwd, resolve(cwd, p))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`agent docs path must stay inside ${cwd}: ${p}`)
    }
    const list = existsSync(join(cwd, rel)) ? targets.inject : targets.create
    list.push(rel)
  }
  return targets
}

function read(cwd: string, rel: string): string {
  return readFileSync(join(cwd, rel), 'utf8')
}

function write(cwd: string, rel: string, content: string): void {
  const path = join(cwd, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
