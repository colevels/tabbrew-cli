import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

// The config module reads these at import time, so the fixture must exist first.
const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/latest') {
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

const assetBytes = new TextEncoder().encode('#!/bin/sh\necho new\n')
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
let latestTag = '/colevels/tabbrew-cli/releases/tag/v9.9.9'
let checksums = `${sha256(assetBytes)}  tabbrew-darwin-arm64\n`

const update = await import('./index')

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabbrew-update-'))
})
afterAll(async () => {
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
