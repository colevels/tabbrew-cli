import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { YAML } from 'bun'

// The config module reads these at import time, so the fixture and state dir
// must exist first — and every test file in this process shares the same
// config module instance, so this is the only file that may set them.
const dir = mkdtempSync(join(tmpdir(), 'tabbrew-update-'))
let fail = false
const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/latest') {
      if (fail) return new Response('boom', { status: 500 })
      return new Response(null, { status: 302, headers: { location: `${latestTag}` } })
    }
    if (pathname === '/download/tabbrew-darwin-arm64') return new Response(assetBytes)
    if (pathname === '/download/checksums.txt') return new Response(checksums)
    return new Response('not found', { status: 404 })
  },
})
const base = `http://127.0.0.1:${fixture.port}`
process.env.TABBREW_UPDATE_LATEST_URL = `${base}/latest`
process.env.TABBREW_UPDATE_DOWNLOAD_BASE_URL = `${base}/download/`
process.env.TABBREW_SESSION_DIR = dir

const assetBytes = new TextEncoder().encode('#!/bin/sh\necho new\n')
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
let latestTag = '/colevels/tabbrew-cli/releases/tag/v9.9.9'
let checksums = `${sha256(assetBytes)}  tabbrew-darwin-arm64\n`

const update = await import('./index')
const notify = await import('./notify')

// noUpdateCheck() reads live, but other test files in this shared process
// spawn subprocesses that inherit process.env — mutating it here must not
// leak past this file, or a later suite's subprocess would skip its own
// disable and let the notifier recreate a directory that command just removed.
const previousNoUpdateCheck = process.env.TABBREW_NO_UPDATE_CHECK
beforeAll(() => {
  delete process.env.TABBREW_NO_UPDATE_CHECK
})
afterAll(async () => {
  if (previousNoUpdateCheck === undefined) delete process.env.TABBREW_NO_UPDATE_CHECK
  else process.env.TABBREW_NO_UPDATE_CHECK = previousNoUpdateCheck
  rmSync(dir, { recursive: true, force: true })
  await fixture.stop(true)
})

describe('compareSemver', () => {
  test('orders major.minor.patch and ignores a v prefix', () => {
    expect(update.compareSemver('v1.2.3', '1.2.3')).toBe(0)
    expect(update.compareSemver('0.10.0', '0.9.0')).toBe(1)
    expect(update.compareSemver('0.9.0', '0.9.1')).toBe(-1)
    expect(update.compareSemver('1.0.0-beta', '1.0.0')).toBe(0)
  })
  test('never calls an unparsable version newer', () => {
    expect(update.compareSemver('main', '0.9.0')).toBeNaN()
    expect(update.compareSemver('main', 'main')).toBe(0)
  })
})

describe('assetName', () => {
  test('maps supported platforms', () => {
    expect(update.assetName('darwin', 'arm64')).toBe('tabbrew-darwin-arm64')
    expect(update.assetName('linux', 'x64')).toBe('tabbrew-linux-x64')
  })
  test('refuses platforms without a release', () => {
    expect(() => update.assetName('win32', 'x64')).toThrow(update.UpdateError)
  })
})

describe('isHomebrewKeg', () => {
  test('recognises a keg under any Homebrew prefix', () => {
    expect(update.isHomebrewKeg('/opt/homebrew/Cellar/tabbrew/0.9.4/bin/tabbrew')).toBe(true)
    expect(
      update.isHomebrewKeg('/home/linuxbrew/.linuxbrew/Cellar/tabbrew/0.9.4/bin/tabbrew'),
    ).toBe(true)
    expect(update.isHomebrewKeg('/Users/me/.local/bin/tabbrew')).toBe(false)
    expect(update.isHomebrewKeg('/opt/homebrew/Cellar/bun/1.3.5/bin/bun')).toBe(false)
  })
})

describe('resolveLatest', () => {
  test('reads the version from the releases/latest redirect', async () => {
    expect(await update.resolveLatest()).toBe('9.9.9')
    const info = await update.checkForUpdate()
    expect(info).toEqual({ current: update.VERSION, latest: '9.9.9', updateAvailable: true })
  })
  test('fails when the redirect is not a tag page', async () => {
    latestTag = '/somewhere/else'
    await expect(update.resolveLatest()).rejects.toBeInstanceOf(update.UpdateError)
    latestTag = '/colevels/tabbrew-cli/releases/tag/v9.9.9'
  })
})

describe('downloadAndVerify', () => {
  test('returns the bytes when the checksum matches', async () => {
    expect(await update.downloadAndVerify('tabbrew-darwin-arm64')).toEqual(assetBytes)
  })
  test('rejects a checksum mismatch', async () => {
    checksums = `${'0'.repeat(64)}  tabbrew-darwin-arm64\n`
    await expect(update.downloadAndVerify('tabbrew-darwin-arm64')).rejects.toThrow(
      /checksum mismatch/,
    )
    checksums = `${sha256(assetBytes)}  tabbrew-darwin-arm64\n`
  })
  test('rejects an asset the release does not carry', async () => {
    await expect(update.downloadAndVerify('tabbrew-linux-x64')).rejects.toThrow(/HTTP 404/)
  })
})

describe('replaceBinary', () => {
  test('swaps the file in place and marks it executable', async () => {
    const target = join(dir, 'tabbrew')
    writeFileSync(target, 'old')
    chmodSync(target, 0o644)
    await update.replaceBinary(target, assetBytes)
    expect(readFileSync(target, 'utf8')).toBe('#!/bin/sh\necho new\n')
    expect(statSync(target).mode & 0o111).toBe(0o111)
  })
  test('leaves no temp file behind when the directory is not writable', async () => {
    const locked = join(dir, 'locked')
    mkdirSync(locked)
    const target = join(locked, 'tabbrew')
    writeFileSync(target, 'old')
    chmodSync(locked, 0o555)
    try {
      await expect(update.replaceBinary(target, assetBytes)).rejects.toThrow(/permission denied/)
      expect(readFileSync(target, 'utf8')).toBe('old')
    } finally {
      chmodSync(locked, 0o755)
    }
  })
})

describe('checkForUpdateThrottled', () => {
  beforeEach(() => {
    rmSync(notify.STATE_PATH, { force: true })
  })

  test('checks and writes state when nothing was recorded yet', async () => {
    const info = await notify.checkForUpdateThrottled()
    expect(info).toEqual({ current: update.VERSION, latest: '9.9.9', updateAvailable: true })
    const state = YAML.parse(readFileSync(notify.STATE_PATH, 'utf8')) as {
      lastCheckedAt: number
      lastKnownLatest: string
    }
    expect(state.lastKnownLatest).toBe('9.9.9')
    expect(state.lastCheckedAt).toBeGreaterThan(0)
  })

  test('is throttled by a fresh lastCheckedAt', async () => {
    writeFileSync(notify.STATE_PATH, YAML.stringify({ lastCheckedAt: Date.now() }))
    expect(await notify.checkForUpdateThrottled()).toBeNull()
  })

  test('checks again once the interval has elapsed', async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000
    writeFileSync(notify.STATE_PATH, YAML.stringify({ lastCheckedAt: stale }))
    const info = await notify.checkForUpdateThrottled()
    expect(info?.latest).toBe('9.9.9')
  })

  test('treats a corrupt state file as never checked', async () => {
    writeFileSync(notify.STATE_PATH, '{{{not yaml')
    expect(await notify.checkForUpdateThrottled()).not.toBeNull()
  })

  test('returns null and skips the network when disabled', async () => {
    process.env.TABBREW_NO_UPDATE_CHECK = '1'
    try {
      expect(await notify.checkForUpdateThrottled()).toBeNull()
    } finally {
      delete process.env.TABBREW_NO_UPDATE_CHECK
    }
  })

  test('backs off on a network failure without reporting an update', async () => {
    fail = true
    try {
      const info = await notify.checkForUpdateThrottled()
      expect(info).toBeNull()
      const state = YAML.parse(readFileSync(notify.STATE_PATH, 'utf8')) as {
        lastCheckedAt: number
      }
      expect(state.lastCheckedAt).toBeGreaterThan(0)
    } finally {
      fail = false
    }
  })
})

describe('notifyIfUpdateAvailable', () => {
  const originalError = console.error
  let lines: string[]
  beforeEach(() => {
    rmSync(notify.STATE_PATH, { force: true })
    lines = []
    console.error = (...args: unknown[]) => {
      lines.push(args.join(' '))
    }
  })
  afterEach(() => {
    console.error = originalError
  })

  test('prints a one-line notice when a newer release exists', async () => {
    await notify.notifyIfUpdateAvailable()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`${update.VERSION} → 9.9.9`)
    expect(lines[0]).toContain('tabbrew update')
  })

  test('prints nothing when throttled', async () => {
    writeFileSync(notify.STATE_PATH, YAML.stringify({ lastCheckedAt: Date.now() }))
    await notify.notifyIfUpdateAvailable()
    expect(lines).toHaveLength(0)
  })
})
