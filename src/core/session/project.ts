import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PROJECT_CONFIG = '.tabbrew.json'

// Chrome extension ids are 32 letters a-p (hex digits shifted by 'a').
export const CHROME_EXTENSION_ID = /^[a-p]{32}$/

export function findProjectConfig(cwd: string): string | null {
  let dir = cwd
  for (;;) {
    const path = join(dir, PROJECT_CONFIG)
    if (existsSync(path)) return path
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// A stale or hand-edited file must never keep a session from starting, so
// anything unreadable reads as "no preference".
export function readProjectExtensionId(cwd = process.cwd()): string | null {
  const path = findProjectConfig(cwd)
  if (!path) return null
  const id = parse(path).extensionId
  return typeof id === 'string' && CHROME_EXTENSION_ID.test(id) ? id : null
}

// `null` clears the key and removes a file that has nothing else in it.
export function writeProjectExtensionId(cwd: string, id: string | null): void {
  const path = join(cwd, PROJECT_CONFIG)
  const config = existsSync(path) ? parse(path) : {}
  if (id) {
    config.extensionId = id
  } else {
    delete config.extensionId
    if (Object.keys(config).length === 0) {
      if (existsSync(path)) unlinkSync(path)
      return
    }
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
}

function parse(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
