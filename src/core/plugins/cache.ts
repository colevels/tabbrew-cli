// The plugins this machine has seen, kept beside the session log. A session
// forgets what was declared when it exits, ten idle minutes after its last
// use; without this a plugin's commands would be unknown to the next one until
// its page happened to be open again, and the CLI could not open that page.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegistry, type Registry, type RegistryEntry } from '../commands/declaration'
import { STATE_DIR } from '../session/config'

const FILE = 'plugins.json'

const EXPIRES_MS = 30 * 24 * 60 * 60_000

export interface KnownPlugin extends RegistryEntry {
  seenAt: number
  // The extension that served this namespace before another one declared it.
  previousExtensionId?: string
}

// The file is anyone's to write, so it is held to the rules of a declaration
// and never trusted; one that cannot be read is no plugins at all.
export function readKnownPlugins(
  now = Date.now(),
  directory = STATE_DIR,
): Record<string, KnownPlugin> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(directory, FILE), 'utf8'))
  } catch {
    return {}
  }
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const known: Record<string, KnownPlugin> = {}
  for (const [namespace, entry] of Object.entries(parseRegistry(raw))) {
    const { seenAt, previousExtensionId } = stored[namespace] as Record<string, unknown>
    if (typeof seenAt !== 'number' || now - seenAt > EXPIRES_MS) continue
    known[namespace] = {
      ...entry,
      connected: false,
      seenAt,
      previousExtensionId:
        typeof previousExtensionId === 'string' && /^[a-p]{32}$/.test(previousExtensionId)
          ? previousExtensionId
          : undefined,
    }
  }
  return known
}

function write(known: Record<string, KnownPlugin>, directory: string): void {
  try {
    mkdirSync(directory, { recursive: true })
    // A reader never sees half a file.
    const file = join(directory, FILE)
    writeFileSync(`${file}.tmp`, JSON.stringify(known, null, 2), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  } catch {
    // A read-only home loses the cache, not the session.
  }
}

// Merged, not replaced: a new session starts with no plugins and would
// otherwise erase every other one on its first declaration.
export function mergeKnownPlugins(live: Registry, now = Date.now(), directory = STATE_DIR): void {
  const known = readKnownPlugins(now, directory)
  for (const [namespace, entry] of Object.entries(live)) {
    const before = known[namespace]
    known[namespace] = {
      ...entry,
      connected: false,
      seenAt: now,
      previousExtensionId:
        before && before.extensionId !== entry.extensionId
          ? before.extensionId
          : before?.previousExtensionId,
    }
  }
  write(known, directory)
}

export function forgetPlugin(namespace: string, directory = STATE_DIR): boolean {
  const known = readKnownPlugins(Date.now(), directory)
  if (!Object.hasOwn(known, namespace)) return false
  delete known[namespace]
  write(known, directory)
  return true
}
