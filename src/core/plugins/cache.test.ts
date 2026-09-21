import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Registry } from '../commands/declaration'
import { forgetPlugin, mergeKnownPlugins, readKnownPlugins } from './cache'

const QUICKNOTES = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)
const DAY_MS = 24 * 60 * 60_000

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tabbrew-cache-'))
})

afterEach(() => {
  chmodSync(directory, 0o700)
  rmSync(directory, { recursive: true, force: true })
})

const read = (now = Date.now()) => readKnownPlugins(now, directory)
const merge = (live: Registry, now: number) => mergeKnownPlugins(live, now, directory)

const entry = (extensionId: string, commands = ['list']): Registry[string] => ({
  extensionId,
  page: 'cli.html',
  description: 'Notes',
  connected: true,
  commands: Object.fromEntries(commands.map((name) => [name, { description: name }])),
})

describe('known plugins', () => {
  test('nothing is known before anything was declared', () => {
    expect(read()).toEqual({})
  })

  test('what a session declared is known afterwards, as not connected', () => {
    merge({ notes: entry(QUICKNOTES) }, 1_000)
    expect(read(2_000)).toEqual({
      notes: { ...entry(QUICKNOTES), connected: false, seenAt: 1_000 },
    })
    expect(statSync(join(directory, 'plugins.json')).mode & 0o777).toBe(0o600)
  })

  test('a new session adds to what is known and updates what it declares again', () => {
    merge({ notes: entry(QUICKNOTES) }, 1_000)
    merge({ bookmarks: entry(OTHER) }, 2_000)
    merge({ notes: entry(QUICKNOTES, ['list', 'add']) }, 3_000)
    const known = read(4_000)
    expect(Object.keys(known).sort()).toEqual(['bookmarks', 'notes'])
    expect(Object.keys(known.notes?.commands ?? {})).toEqual(['list', 'add'])
    expect(known.notes?.seenAt).toBe(3_000)
  })

  test('a plugin not seen for a month is forgotten', () => {
    merge({ notes: entry(QUICKNOTES) }, 0)
    expect(read(29 * DAY_MS)).toHaveProperty('notes')
    expect(read(31 * DAY_MS)).toEqual({})
  })

  test('a namespace that changed hands remembers who held it', () => {
    merge({ notes: entry(QUICKNOTES) }, 1_000)
    merge({ notes: entry(OTHER) }, 2_000)
    merge({ notes: entry(OTHER) }, 3_000)
    expect(read(4_000).notes).toMatchObject({
      extensionId: OTHER,
      previousExtensionId: QUICKNOTES,
    })
  })

  test('forgetting removes one plugin', () => {
    merge({ notes: entry(QUICKNOTES), bookmarks: entry(OTHER) }, Date.now())
    expect(forgetPlugin('notes', directory)).toBe(true)
    expect(forgetPlugin('notes', directory)).toBe(false)
    expect(Object.keys(read())).toEqual(['bookmarks'])
  })

  test.each([
    ['not json', '{'],
    ['not an object', '"plugins"'],
    ['an entry without a time', JSON.stringify({ notes: entry(QUICKNOTES) })],
  ])('a file that is %s is no plugins', (_, content) => {
    writeFileSync(join(directory, 'plugins.json'), content)
    expect(read()).toEqual({})
  })

  test('a hostile file is held to the rules of a declaration', () => {
    writeFileSync(
      join(directory, 'plugins.json'),
      JSON.stringify({
        notes: { ...entry(QUICKNOTES), page: 'cli.html" & calc', seenAt: Date.now() },
        list: { ...entry(QUICKNOTES), seenAt: Date.now() },
        elsewhere: { ...entry('https://evil.example'), seenAt: Date.now() },
        previous: { ...entry(QUICKNOTES), previousExtensionId: '$(id)', seenAt: Date.now() },
      }),
    )
    const known = read()
    expect(Object.keys(known).sort()).toEqual(['notes', 'previous'])
    expect(known.notes?.page).toBeUndefined()
    expect(known.previous?.previousExtensionId).toBeUndefined()
  })

  test('a directory that cannot be written costs the cache and nothing else', () => {
    chmodSync(directory, 0o500)
    expect(() => merge({ notes: entry(QUICKNOTES) }, 1_000)).not.toThrow()
    chmodSync(directory, 0o700)
    expect(() => readFileSync(join(directory, 'plugins.json'))).toThrow()
  })
})
