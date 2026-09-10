import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { chmod, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { compiled } from '../session/config'
import {
  DOWNLOAD_BASE_URL,
  DOWNLOAD_TIMEOUT_MS,
  LATEST_URL,
  REPOSITORY,
  REQUEST_TIMEOUT_MS,
  VERSION,
} from './config'

export { VERSION } from './config'

export class UpdateError extends Error {
  override name = 'UpdateError'
}

export type UpdateInfo = { current: string; latest: string; updateAvailable: boolean }

// GitHub rejects requests without a User-Agent.
const headers = { 'User-Agent': `tabbrew-cli/${VERSION}` }

export const isCompiledBinary = (): boolean => compiled

// Symlinks resolved, so the swap replaces the file the link points at.
export const currentBinaryPath = (): string => realpathSync(process.execPath)

export function assetName(platform = process.platform, arch = process.arch): string {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
  if (!os || !cpu) {
    throw new UpdateError(
      `no prebuilt binary for ${platform}-${arch}; releases cover macOS and Linux on arm64/x64. ` +
        `See https://github.com/${REPOSITORY}/releases/latest or build from source`,
    )
  }
  return `tabbrew-${os}-${cpu}`
}

const normalizeVersion = (version: string): string => version.trim().replace(/^v/, '')

function parseTriple(version: string): [number, number, number] | null {
  const core = normalizeVersion(version).split(/[-+]/)[0] ?? ''
  const parts = core.split('.').map(Number)
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

// -1 / 0 / 1, or NaN when either side is not major.minor.patch, so a version
// we cannot parse is never reported as newer.
export function compareSemver(a: string, b: string): number {
  const left = parseTriple(a)
  const right = parseTriple(b)
  if (!left || !right) return normalizeVersion(a) === normalizeVersion(b) ? 0 : Number.NaN
  for (let i = 0; i < 3; i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

async function get(url: string, timeoutMs: number, redirect: RequestInit['redirect'] = 'follow') {
  try {
    return await fetch(url, { headers, redirect, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new UpdateError(`could not reach ${url}: ${err instanceof Error ? err.message : err}`)
  }
}

// releases/latest answers with a 302 to releases/tag/vX.Y.Z: no API call, no rate limit.
export async function resolveLatest(): Promise<string> {
  const res = await get(LATEST_URL, REQUEST_TIMEOUT_MS, 'manual')
  const location = res.headers.get('location')
  const match = location?.match(/\/tag\/([^/?#]+)/)
  if (!match?.[1]) {
    throw new UpdateError(
      `could not determine the latest version (HTTP ${res.status} from ${LATEST_URL}` +
        `${location ? `, redirect to ${location}` : ', no redirect'})`,
    )
  }
  return normalizeVersion(match[1])
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = normalizeVersion(VERSION)
  const latest = await resolveLatest()
  return { current, latest, updateAvailable: compareSemver(latest, current) > 0 }
}

export async function downloadAndVerify(asset: string): Promise<Uint8Array> {
  const binaryUrl = `${DOWNLOAD_BASE_URL}/${asset}`
  const binaryRes = await get(binaryUrl, DOWNLOAD_TIMEOUT_MS)
  if (!binaryRes.ok)
    throw new UpdateError(`download failed (HTTP ${binaryRes.status}): ${binaryUrl}`)
  const bytes = new Uint8Array(await binaryRes.arrayBuffer())

  const checksumsUrl = `${DOWNLOAD_BASE_URL}/checksums.txt`
  const checksumsRes = await get(checksumsUrl, REQUEST_TIMEOUT_MS)
  if (!checksumsRes.ok) {
    throw new UpdateError(
      `could not fetch checksums (HTTP ${checksumsRes.status}): ${checksumsUrl}`,
    )
  }
  // One "<sha256>  <asset>" per line, as install.sh reads it.
  const line = (await checksumsRes.text())
    .split('\n')
    .find((entry) => entry.trimEnd().endsWith(` ${asset}`))
  const expected = line?.trim().split(/\s+/)[0]
  if (!expected) throw new UpdateError(`no checksum for ${asset} in checksums.txt`)
  const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new UpdateError(
      `checksum mismatch for ${asset} (expected ${expected}, got ${actual}); nothing was changed`,
    )
  }
  return bytes
}

// Write next to the target and rename over it: atomic, same filesystem, and
// safe while the old binary is still running (it keeps its inode).
export async function replaceBinary(target: string, bytes: Uint8Array): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}-${randomUUID()}`)
  try {
    await writeFile(temp, bytes)
    await chmod(temp, 0o755)
    await rename(temp, target)
  } catch (err) {
    await unlink(temp).catch(() => {})
    const code = (err as { code?: string }).code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new UpdateError(
        `cannot write ${target}: permission denied; re-run with the right permissions or reinstall with install.sh`,
      )
    }
    throw err
  }
}

export async function performUpdate(): Promise<{ info: UpdateInfo; replaced: boolean }> {
  const info = await checkForUpdate()
  if (!info.updateAvailable) return { info, replaced: false }
  const bytes = await downloadAndVerify(assetName())
  await replaceBinary(currentBinaryPath(), bytes)
  return { info, replaced: true }
}
