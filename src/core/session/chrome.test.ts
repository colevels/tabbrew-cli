import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionUrl, extensionId, openInChrome } from './chrome'
import { CONNECTION_PAGE } from './config'

const dirs: string[] = []
afterEach(() => {
  delete process.env.TABBREW_CHROME
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// A launcher that only records what it was asked to open.
export function recordingLauncher(): { path: string; opened: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'tabbrew-chrome-'))
  dirs.push(dir)
  const log = join(dir, 'opened')
  const path = join(dir, 'chrome')
  writeFileSync(path, `#!/bin/sh\necho "$1" >> "${log}"\n`, { mode: 0o755 })
  return {
    path,
    opened: () => {
      try {
        return readFileSync(log, 'utf8').trim().split('\n')
      } catch {
        return []
      }
    },
  }
}

describe('chrome', () => {
  test("extensionId matches Chrome's derivation for an unpacked path", () => {
    // Chrome hashes the absolute directory of an unkeyed unpacked build the same way.
    const key = Buffer.from(
      '/Users/colevels/Projects/tabbrew-workspace/tabbrew-cli/extension/dist/chrome-mv3',
    ).toString('base64')
    expect(extensionId(key)).toBe('codoepemapijbcompelcemabmgngjgco')
  })

  test('connectionUrl addresses the pinned extension', () => {
    expect(connectionUrl()).toMatch(new RegExp(`^chrome-extension://[a-p]{32}/${CONNECTION_PAGE}$`))
  })

  test('openInChrome hands the URL to TABBREW_CHROME', async () => {
    const launcher = recordingLauncher()
    process.env.TABBREW_CHROME = launcher.path
    openInChrome('chrome-extension://test/page.html')
    const until = Date.now() + 2000
    while (launcher.opened().length === 0 && Date.now() < until) await Bun.sleep(20)
    expect(launcher.opened()).toEqual(['chrome-extension://test/page.html'])
  })
})
