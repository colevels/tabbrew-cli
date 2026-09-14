import { rmSync, unlinkSync } from 'node:fs'
import { discover, HOST, STATE_DIR, stopSession } from '../session'
import type { SessionInfo } from '../session/protocol'
import { currentBinaryPath, installedViaHomebrew, isCompiledBinary, UpdateError } from '../update'

// Only install-script binaries are ours to delete; brew, npm and bun own the others.
export type BinaryManager = 'install-script' | 'homebrew' | 'npm-or-source'

export type UninstallPlan = {
  session: SessionInfo | null
  stateDirectory: string
  binaryManager: BinaryManager
  // The path only when binaryManager is install-script.
  binary: string | null
}

export async function describeUninstall(): Promise<UninstallPlan> {
  const binaryManager: BinaryManager = !isCompiledBinary()
    ? 'npm-or-source'
    : installedViaHomebrew()
      ? 'homebrew'
      : 'install-script'
  return {
    session: await discover(),
    stateDirectory: STATE_DIR,
    binaryManager,
    binary: binaryManager === 'install-script' ? currentBinaryPath() : null,
  }
}

// Stops the session first so nothing is left writing into the state
// directory; a session that will not stop aborts before anything is removed.
export async function performUninstall(plan: UninstallPlan): Promise<void> {
  if (plan.session && !(await stopSession(plan.session))) {
    throw new UpdateError(
      `session on ${HOST}:${plan.session.port} · pid ${plan.session.pid} did not stop; nothing was removed`,
    )
  }
  rmSync(plan.stateDirectory, { recursive: true, force: true })
  if (!plan.binary) return
  try {
    unlinkSync(plan.binary)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') return
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new UpdateError(
        `cannot remove ${plan.binary}: permission denied; re-run with the right permissions or delete it by hand`,
      )
    }
    throw err
  }
}
